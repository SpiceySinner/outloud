import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { converseResponseJsonSchema, converseResponseSchema } from "@/lib/converse-schema";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";
import { retrievalVariationSchema } from "@/lib/practice-schema";
import { rescueResponseSchema } from "@/lib/rescue-schema";
import { createSession, deleteSession, loadSession, saveSession } from "@/lib/session-store";
import type { ConverseResponse } from "@/lib/types";

type ConversationState = {
  originalText: string;
  scenarioContext?: string | null;
  context: {
    who: string;
    dialect: string;
    tone: string;
  };
  rescue: z.infer<typeof rescueResponseSchema>;
  transferPrompt?: z.infer<typeof retrievalVariationSchema> | null;
  pressureMode: boolean;
  turns: Array<{
    turnIndex: number;
    characterLineEs: string;
    userAttempt?: string;
    isRepairTurn?: boolean;
  }>;
  /**
   * `turnIndex` of the most recently generated character turn (the one currently on screen /
   * awaiting the user's reply). Repair turns are pinned to this same value instead of advancing
   * it -- see the `respond` handler below -- so `turns.length` (which grows by one on every
   * push, repair or not) is no longer a safe proxy for turn number once repair exists.
   */
  currentTurnIndex: number;
};

const configuredMaxTurns = Number(process.env.MAX_CONVERSATION_TURNS ?? 5);
const MAX_TURN_INDEX = Math.max(3, Math.min(7, Number.isFinite(configuredMaxTurns) ? configuredMaxTurns - 1 : 4));

const requestSchema = z.object({
  action: z.enum(["start", "respond", "close"]),
  conversationId: z.string().optional(),
  turnIndex: z.number().int().min(0).max(7).optional(),
  userAttempt: z.string().max(1600).optional(),
  /**
   * Computed client-side by `shouldTriggerRepair` (lib/repair-loop.ts) from the real
   * `/api/evaluate` result for this reply. The server trusts this rather than re-deriving it --
   * same division of responsibility as Pressure Mode/timing: client owns "when" from real
   * evaluated data, server owns "how to phrase it in character."
   */
  repairRequested: z.boolean().optional(),
  originalText: z.string().min(4).max(1600).optional(),
  scenarioContext: z.string().max(1600).nullable().optional(),
  context: z
    .object({
      who: z.string().min(1),
      dialect: z.string().min(1),
      tone: z.string().min(1),
    })
    .optional(),
  rescue: rescueResponseSchema.optional(),
  transferPrompt: retrievalVariationSchema.nullable().optional(),
  pressureMode: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "converse", Number(process.env.MAX_OPENAI_REQUESTS_PER_SESSION ?? 25), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Conversation request is incomplete." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Conversation request is incomplete." }, { status: 400 });
  }
  const pressureModeWasProvided =
    typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, "pressureMode");

  try {
    if (parsed.data.action === "start") {
      if (!parsed.data.originalText || !parsed.data.context || !parsed.data.rescue) {
        return NextResponse.json({ error: "Conversation needs the saved practice context." }, { status: 400 });
      }
      const conversationId = crypto.randomUUID();
      const state: ConversationState = {
        originalText: parsed.data.originalText,
        scenarioContext: parsed.data.scenarioContext ?? null,
        context: parsed.data.context,
        rescue: parsed.data.rescue,
        transferPrompt: parsed.data.transferPrompt ?? null,
        pressureMode: parsed.data.pressureMode,
        turns: [],
        currentTurnIndex: 0,
      };
      const first = await generateTurn(conversationId, state, null, 0, false);
      state.turns.push({ turnIndex: 0, characterLineEs: first.characterLineEs, isRepairTurn: false });
      // Persisted only once the opening turn exists: a failed generation leaves no stray row.
      await createSession("converse", conversationId, state);
      return NextResponse.json(first);
    }

    if (!parsed.data.conversationId) {
      return NextResponse.json({ error: "Conversation ID is required." }, { status: 400 });
    }
    const state = await loadSession<ConversationState>("converse", parsed.data.conversationId);
    if (!state) {
      return NextResponse.json({ error: "Conversation expired. Start this practice again." }, { status: 404 });
    }
    if (parsed.data.action === "respond" && pressureModeWasProvided) {
      state.pressureMode = parsed.data.pressureMode;
    }

    if (parsed.data.action === "close") {
      await deleteSession("converse", parsed.data.conversationId);
      return NextResponse.json({
        conversationId: parsed.data.conversationId,
        turnIndex: state.turns.length,
        characterLineEs: "Gracias por practicarlo conmigo.",
        characterMeaningEn: "Thanks for practicing it with me.",
        meaningChunks: [{ es: "Gracias", en: "Thanks" }],
        keyWord: null,
        expectedCommunicativeFunction: "close the conversation",
        suggestedReplyFrameEs: "Gracias por ___.",
        suggestedReplyEs: "Gracias por practicar conmigo.",
        responseGuidanceEn: "Conversation closed.",
        shouldClose: true,
        closingReason: "User ended early.",
        isRepairTurn: false,
        repairType: null,
      } satisfies ConverseResponse);
    }

    const userAttempt = parsed.data.userAttempt?.trim() ?? "";
    if (parsed.data.action === "respond" && userAttempt.length < 2) {
      return NextResponse.json({ error: "Say or type a short response first." }, { status: 400 });
    }

    if (!state.turns.length) {
      return NextResponse.json({ error: "Conversation expired. Start this practice again." }, { status: 404 });
    }

    const repairRequested = parsed.data.repairRequested === true;
    state.turns[state.turns.length - 1] = {
      ...state.turns[state.turns.length - 1],
      userAttempt,
    };
    // Turn-index pinning: a repair exchange does not consume the bounded session budget. When
    // the client has determined (from the real evaluation of this reply) that the character
    // should express confusion, the NEXT turn reuses the SAME turnIndex as the turn just replied
    // to, instead of advancing. Only a turn the character actually understood advances the count
    // that `shouldClose`/`MAX_TURN_INDEX` are measured against.
    const nextTurnIndex = repairRequested ? state.currentTurnIndex : state.currentTurnIndex + 1;
    const next = await generateTurn(parsed.data.conversationId, state, userAttempt, nextTurnIndex, repairRequested);
    state.turns.push({ turnIndex: nextTurnIndex, characterLineEs: next.characterLineEs, isRepairTurn: next.isRepairTurn });
    state.currentTurnIndex = nextTurnIndex;
    // The state object is a local copy of the stored row, so every mutation above (including the
    // pressureMode toggle) has to be written back explicitly.
    if (next.shouldClose) await deleteSession("converse", parsed.data.conversationId);
    else await saveSession("converse", parsed.data.conversationId, state);
    return NextResponse.json(next);
  } catch {
    return NextResponse.json({ error: "Outloud could not continue the conversation yet." }, { status: 502 });
  }
}

// Warm, in-character, non-judging non-comprehension line for the mock-AI path -- mirrors the
// tone required of the real model's repair turns (see repairSystemPrompt below).
const MOCK_REPAIR_LINE_ES = "¿cómo? no te entendí.";
const MOCK_REPAIR_LINE_EN = "What? I didn't understand you.";

const MOCK_PRESSURE_CURVEBALL_ES = "¿En serio? ¿Por qué?";
const MOCK_PRESSURE_CURVEBALL_EN = "Really? Why?";
const MOCK_ELABORATION_LINE_ES = "Cuéntame un poco más, ¿qué fue lo mejor?";
const MOCK_ELABORATION_LINE_EN = "Tell me a little more, what was the best part?";

function conversationDifficultyGuidance(turnIndex: number, pressureMode: boolean) {
  if (turnIndex <= 0) {
    return "Turn 1: stay close to the practiced pattern and the original situation. Prompt the user to use the phrase they just practiced.";
  }
  if (turnIndex === 1) {
    return pressureMode
      ? 'Turn 2: introduce one small, realistic curveball or follow-up, such as "¿por qué?", "¿en serio?", or "espera, ¿qué?", while staying grounded in the same situation.'
      : "Turn 2: add one small follow-up question or mild subject shift, still obviously connected to the same situation.";
  }
  if (turnIndex === 2) {
    return "Turn 3: ask for a little more elaboration about the same situation. Keep it short and practical, not like an exam.";
  }
  if (turnIndex === 3) {
    return "Turn 4: keep the thread natural and ask one connected follow-up that needs a real answer, not a memorized sentence.";
  }
  return "Final turn: close the practice naturally after the user's next reply. Keep the last line warm, short, and connected to the same situation.";
}

async function generateTurn(
  conversationId: string,
  state: ConversationState,
  userAttempt: string | null,
  turnIndex: number,
  repairRequested: boolean,
): Promise<ConverseResponse> {
  if (isMockAiEnabled()) {
    if (repairRequested) {
      return {
        conversationId,
        turnIndex,
        characterLineEs: MOCK_REPAIR_LINE_ES,
        characterMeaningEn: MOCK_REPAIR_LINE_EN,
        meaningChunks: [{ es: "no te entendí", en: "I didn't understand you" }],
        keyWord: null,
        expectedCommunicativeFunction: state.rescue.transferableChunk.communicativeFunction,
        suggestedReplyFrameEs: "Perdón, quería decir ___.",
        suggestedReplyEs: state.rescue.natural_version,
        responseGuidanceEn: "Try saying it a different way -- don't worry about getting it perfect.",
        shouldClose: false,
        closingReason: null,
        isRepairTurn: true,
        repairType: "non_comprehension",
      };
    }
    if (state.transferPrompt && turnIndex === 0) {
      return {
        conversationId,
        turnIndex,
        characterLineEs: state.transferPrompt.openingLineEs,
        characterMeaningEn: state.transferPrompt.openingMeaningEn,
        meaningChunks: [{ es: state.transferPrompt.openingLineEs, en: state.transferPrompt.openingMeaningEn }],
        keyWord: { es: state.transferPrompt.targetChunkPatternEs, en: state.transferPrompt.targetCommunicativeFunction },
        expectedCommunicativeFunction: state.transferPrompt.targetCommunicativeFunction,
        suggestedReplyFrameEs: state.transferPrompt.targetChunkPatternEs,
        suggestedReplyEs: state.rescue.natural_version,
        responseGuidanceEn: "Use the same skill in this new situation.",
        shouldClose: false,
        closingReason: null,
        isRepairTurn: false,
        repairType: null,
      };
    }
    if (turnIndex === 1) {
      return {
        conversationId,
        turnIndex,
        characterLineEs: MOCK_PRESSURE_CURVEBALL_ES,
        characterMeaningEn: MOCK_PRESSURE_CURVEBALL_EN,
        meaningChunks: [{ es: "por qué", en: "why" }],
        keyWord: { es: "porque", en: "because" },
        expectedCommunicativeFunction: "handle an unexpected_follow_up",
        suggestedReplyFrameEs: "Porque ___.",
        suggestedReplyEs: state.rescue.natural_version,
        responseGuidanceEn: "Give a short reason in Spanish. It is okay to keep it simple.",
        shouldClose: false,
        closingReason: null,
        isRepairTurn: false,
        repairType: null,
      };
    }
    if (turnIndex === 2) {
      return {
        conversationId,
        turnIndex,
        characterLineEs: MOCK_ELABORATION_LINE_ES,
        characterMeaningEn: MOCK_ELABORATION_LINE_EN,
        meaningChunks: [{ es: "un poco más", en: "a little more" }],
        keyWord: { es: "mejor", en: "best" },
        expectedCommunicativeFunction: "elaborate a little about the same situation",
        suggestedReplyFrameEs: "Lo mejor fue ___.",
        suggestedReplyEs: state.rescue.natural_version,
        responseGuidanceEn: "Add one short detail in Spanish. Keep using the same idea.",
        shouldClose: turnIndex >= MAX_TURN_INDEX,
        closingReason: turnIndex >= MAX_TURN_INDEX ? "Practice conversation complete." : null,
        isRepairTurn: false,
        repairType: null,
      };
    }
    return {
      conversationId,
      turnIndex,
      characterLineEs: turnIndex === 0 ? "Que bueno, te gusto?" : "Me alegra escuchar eso.",
      characterMeaningEn: turnIndex === 0 ? "Good, did you like it?" : "I'm glad to hear that.",
      meaningChunks: [{ es: "te gusto", en: "you liked it" }],
      keyWord: { es: "gusto", en: "liked" },
      expectedCommunicativeFunction: state.rescue.transferableChunk.communicativeFunction,
      suggestedReplyFrameEs: "Sí, porque ___.",
      suggestedReplyEs: state.rescue.natural_version,
      responseGuidanceEn: "Answer briefly using the pattern you practiced.",
      shouldClose: turnIndex >= MAX_TURN_INDEX,
      closingReason: turnIndex >= MAX_TURN_INDEX ? "Practice conversation complete." : null,
      isRepairTurn: false,
      repairType: null,
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI is not configured.");
  }

  const baseSystemPrompt =
    "Continue a short, bounded Spanish practice conversation. Act as the selected person, one realistic follow-up at a time. " +
    naturalSpanishSystemPrompt + " " +
    "Use short practice-appropriate Spanish, chosen tone/dialect, and meaning chunks rather than word-for-word translation. " +
    "Treat originalText as the target message the user practiced. Treat scenarioContext as background only for relationship, setting, and topic coherence. " +
    "If retrievalTransferPrompt is present, this is a retrieval session: keep the same learned skill, use the new related situation, and reduce help without launching a lesson. " +
    "Accept varied valid replies in the flow; do not imply there is only one exact sentence unless the user asks for the model answer. " +
    "Close naturally within 4 to 8 character turns. Every response must set isRepairTurn and repairType -- on a normal turn, isRepairTurn is " +
    "false and repairType is null. Also produce suggestedReplyFrameEs (one natural Spanish sentence frame with exactly one blank, " +
    'e.g. "Sí, porque ___.") and suggestedReplyEs (one full natural Spanish answer the user could say for this turn\'s ' +
    "expectedCommunicativeFunction). Follow conversationDifficultyGuidance exactly for turn pacing. Output only structured JSON.";

  const pressureModePrompt = state.pressureMode
    ? 'Pressure Mode is ON: you may, but do not have to, make this turn an unexpected_follow_up or brief subject change instead of the expected next beat. Keep it warm and never mocking. Good curveball examples to paraphrase: "¿por qué?", "¿en serio?", "espera, ¿qué?". If you use a curveball, keep it short and set expectedCommunicativeFunction to include unexpected_follow_up.'
    : "";

  const repairSystemPrompt =
    "This turn is different: the user's last reply (see lastUserAttempt below) was NOT understood by your character. " +
    "Do not produce a normal next line and do not continue the storyline. Instead, express genuine, warm confusion, set " +
    "isRepairTurn to true, and pick exactly one repairType: " +
    '"non_comprehension" -- a simple, warm non-understanding, e.g. "¿cómo? no te entendí." Use this when the attempt was ' +
    "too garbled, too English-heavy, or otherwise has no clear word worth reacting to. " +
    '"mishearing" -- a plausible mishearing grounded in the ACTUAL words in lastUserAttempt, e.g. an unclear "pollo" heard ' +
    'as "¿niños? ¿quieres niños?". Only use this when there is a real word in lastUserAttempt that could plausibly be ' +
    "misheard given the context -- never invent a mishearing out of nothing; if you are not sure, use non_comprehension " +
    "instead. characterLineEs is the confused line itself, in Spanish, in character. responseGuidanceEn should tell the " +
    "user to try rephrasing, without revealing the correct answer, model phrasing, or any part of the target " +
    "natural-version sentence or pattern. The character is a person who simply didn't catch it, not a judge or a teacher: " +
    "stay warm and human, never mocking, never a wall of grammar correction -- this is confused dialogue, not feedback. " +
    "Do not end the conversation here: shouldClose must be false and closingReason must be null.";

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: repairRequested
          ? `${baseSystemPrompt} ${pressureModePrompt} ${repairSystemPrompt}`.trim()
          : `${baseSystemPrompt} ${pressureModePrompt}`.trim(),
      },
      {
        role: "user",
        content: JSON.stringify({
          conversationId,
          turnIndex,
          originalText: state.originalText,
          scenarioContext: state.scenarioContext ?? null,
          context: state.context,
          rescue: {
            naturalVersion: state.rescue.natural_version,
            transferableChunk: state.rescue.transferableChunk,
          },
          retrievalTransferPrompt: state.transferPrompt ?? null,
          priorTurns: state.turns,
          lastUserAttempt: userAttempt,
          repairRequested,
          pressureMode: state.pressureMode,
          conversationDifficultyGuidance: conversationDifficultyGuidance(turnIndex, state.pressureMode),
        }),
      },
    ],
    temperature: 0.35,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "converse_response",
        strict: true,
        schema: converseResponseJsonSchema,
      },
    },
  });

  const generated = converseResponseSchema.parse(JSON.parse(response.output_text));
  return normalizeGeneratedTurn(generated, conversationId, turnIndex, repairRequested);
}

function normalizeGeneratedTurn(
  generated: ConverseResponse,
  conversationId: string,
  turnIndex: number,
  repairRequested: boolean,
): ConverseResponse {
  // isRepairTurn is forced from the input decision, not trusted from the model -- the server
  // owns *how* the repair is phrased, never *whether* one happens (see requestSchema comment on
  // repairRequested). repairType, however, is the model's call (mishearing vs. non_comprehension
  // both require judging the actual attempt text), validated against the two allowed values.
  const isRepairTurn = repairRequested;
  const repairType = isRepairTurn ? (generated.repairType === "mishearing" ? "mishearing" : "non_comprehension") : null;
  // A repair turn never closes the conversation and never counts toward the bounded session budget
  // below -- both the model's own shouldClose guess and the MAX_TURN_INDEX comparison are
  // overridden here so a misunderstanding can never accidentally end the practice.
  const shouldClose = isRepairTurn ? false : turnIndex >= MAX_TURN_INDEX || generated.shouldClose;
  return {
    ...generated,
    conversationId,
    turnIndex,
    expectedCommunicativeFunction:
      generated.expectedCommunicativeFunction.trim() || "continue the conversation",
    suggestedReplyFrameEs: generated.suggestedReplyFrameEs.trim() || "Sí, porque ___.",
    suggestedReplyEs: generated.suggestedReplyEs.trim() || "Sí, gracias.",
    responseGuidanceEn: generated.responseGuidanceEn.trim() || "Answer briefly in Spanish.",
    shouldClose,
    closingReason: shouldClose ? (generated.closingReason ?? "Practice conversation complete.") : null,
    isRepairTurn,
    repairType,
  };
}
