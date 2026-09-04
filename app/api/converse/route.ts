import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { converseResponseJsonSchema, converseResponseSchema } from "@/lib/converse-schema";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { checkRateLimit, openAiRequestsPerDay } from "@/lib/rate-limit";
import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";
import { retrievalVariationSchema } from "@/lib/practice-schema";
import { rescueResponseSchema } from "@/lib/rescue-schema";
import { createSession, deleteSession, loadSession, saveSession } from "@/lib/session-store";
import type { ConverseResponse } from "@/lib/types";

type ConversationState = {
  originalText: string;
  scenarioContext?: string | null;
  /**
   * True when this conversation replaces an earlier one because the learner stepped out and said
   * the situation itself was wrong for them (see app/api/aside/route.ts). It inverts which of
   * `originalText` and `scenarioContext` describes the scene -- see `baseSystemPrompt`.
   */
  sceneIsNew?: boolean;
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
  /**
   * #44 -- what the character is allowed to notice.
   *
   * `recentEvidence` is the real `/api/evaluate` verdict on EARLIER turns, already settled by the
   * time this call is made, so it costs nothing to send and can be trusted about correctness.
   * `thisTurn` is measurement only -- how the reply came out, not whether it was right -- because
   * the evaluation of the current reply is still in flight when this request is sent.
   *
   * Without these the route knew only the raw attempt text and `repairRequested`, so the
   * character answered in the same pleasant register whether the learner nailed it or dodged.
   */
  recentEvidence: z
    .array(
      z.object({
        meaning: z.string(),
        blocker: z.string().nullable(),
        assistance: z.string(),
      }),
    )
    .max(3)
    .optional(),
  thisTurn: z
    .object({
      assistance: z.string(),
      usedSubtitle: z.boolean(),
      unaidedRun: z.number().int().min(0).max(50),
      secondsToFirstWord: z.number().nullable(),
      hesitations: z.number().int().min(0).max(99),
      englishWords: z.number().int().min(0).max(99),
    })
    .optional(),
  originalText: z.string().min(4).max(1600).optional(),
  scenarioContext: z.string().max(1600).nullable().optional(),
  /**
   * Set by a scene change out of an aside. Without it the first line of the new scene came out of
   * the OLD situation -- a learner who had just said "ordering food is not my problem, it is my
   * girlfriend's family at dinner" was moved to the family dinner and then asked what they would
   * like to order, because `originalText` still described the cafe and the turn-0 guidance said to
   * stay close to it.
   */
  sceneIsNew: z.boolean().optional().default(false),
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
  const limited = checkRateLimit(request, "converse", openAiRequestsPerDay(), 24 * 60 * 60 * 1000);
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
        sceneIsNew: parsed.data.sceneIsNew,
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
    const next = await generateTurn(parsed.data.conversationId, state, userAttempt, nextTurnIndex, repairRequested, {
      recentEvidence: parsed.data.recentEvidence ?? [],
      thisTurn: parsed.data.thisTurn ?? null,
    });
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

/**
 * The opening line, and the source of the worst bug this route has had.
 *
 * The guidance used to read "prompt the user to use the phrase they just practiced", and the model
 * did exactly that: it said the phrase. A learner practising "¿dónde está el museo?" was greeted by
 * a passer-by asking THEM where the museum was -- reported twice from real sessions, once as the
 * library and once as the museum, and misdiagnosed the first time as a transcription fault.
 *
 * The character creates the opening; the learner walks through it.
 */
const OPENING_TURN_RULE =
  "CRITICAL: never say the learner's practised phrase yourself, and never ask them the question they are learning to ask. If they are practising how to ask for directions, you do not ask them for directions -- you are the one who has them. Your line makes room for their phrase; it does not use it. In a scene where the learner is the one who wants something, opening as someone who has just been approached is usually right (\"¿sí, dime?\", \"buenas, ¿qué necesitas?\"), and then you wait.";

function conversationDifficultyGuidance(turnIndex: number, pressureMode: boolean, sceneIsNew = false) {
  if (turnIndex <= 0) {
    return sceneIsNew
      ? "Turn 1: open the NEW scene described in scenarioContext, as the person in it. Your first line must be something that person would actually say in that place, to this learner, right now, about what is happening THERE. Do not open with the situation from originalText or the rescue card, and do not bring their errand, their topic or their objects along -- the learner has just told us that situation is not their problem, and opening there is the whole reason this scene exists. " +
        OPENING_TURN_RULE
      : "Turn 1: open the scene as that person, close to the original situation, so that the phrase the learner practised becomes the natural next thing to say. " + OPENING_TURN_RULE;
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
  reaction: {
    recentEvidence: Array<{ meaning: string; blocker: string | null; assistance: string }>;
    thisTurn: {
      assistance: string;
      usedSubtitle: boolean;
      unaidedRun: number;
      secondsToFirstWord: number | null;
      hesitations: number;
      englishWords: number;
    } | null;
  } = { recentEvidence: [], thisTurn: null },
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
    "Continue a short, bounded Spanish practice conversation. Act as the selected person, one realistic beat at a time. " +
    // The route used to say "one realistic follow-up at a time", and every turn guidance below
    // still says to ask something. That is right for a scenario where the character leads -- and
    // exactly wrong for the many where the learner needs something FROM them. Observed: the
    // learner asked "¿dónde está el museo?" and the character replied "¿puedes decirme si el
    // museo está cerca o lejos?", handing the question straight back.
    "TALKING ABOUT THE TASK IS NOT ATTEMPTING IT. If lastUserAttempt is the learner explaining in English that they do not have the words, asking how to say something, or saying they are stuck, do not play confused and do not treat it as broken Spanish. Answer the person. characterLineEs stays in character and short, and responseGuidanceEn tells them plainly what to do next. " +
    "NEVER praise a non-answer. \"no idea\", \"I don't know\", \"I can't\" -- these never get a warm \"perfecto\" and a new question that leaves them exactly as stuck. " +
    "IF THE LEARNER ASKED YOU SOMETHING, ANSWER IT. You are the person who is there, so you know where it is, what it costs, when it opens -- invent the detail confidently and say it. Never reply to a question with the same question aimed back at them, and never ask them for information they just asked you for. " +
    // Without this the rule runs backwards on turn 0: the rescue card holds the sentence the
    // learner PRACTISED ("¿dónde está el museo?"), the model read it as a question it had been
    // asked, and the scene opened with the character volunteering directions to someone who had
    // not spoken yet.
    "This applies to lastUserAttempt and to nothing else. The rescue card, the practised pattern and originalText record what this learner is working on -- they are not questions anyone has asked you, so never answer them. When lastUserAttempt is null you have not been asked anything at all: open the scene as that person would, and wait. " +
    "Whole scenarios exist where the learner needs something from you -- directions, an order, a price, a favour, a phone call. In those, most of your lines are ANSWERS. Answer first; only then, if it is natural, add one short follow-up in the same breath. Where the turn guidance below tells you to ask a follow-up, that follow-up comes AFTER your answer and never instead of it. " +
    naturalSpanishSystemPrompt + " " +
    "Use short practice-appropriate Spanish, chosen tone/dialect, and meaning chunks rather than word-for-word translation. " +
    (state.sceneIsNew
      ? // The learner asked for this scene by name. scenarioContext IS the situation now, and
        // originalText survives only as evidence of how they speak -- never as the setting.
        "scenarioContext IS the situation: it is the scene the learner asked to be put in, and every line you say belongs in it. " +
        "originalText and the rescue card BOTH describe a DIFFERENT situation the learner has left behind -- its place, its topic, its errand, the specific thing they were trying to get. Carry over ONLY the pattern they are practising and the difficulty they have. Never set a line in that old situation, never mention its topic or the objects in it, and never ask them to do the errand it describes. The pattern transfers; the errand does not. "
      : "Treat originalText as the target message the user practiced. Treat scenarioContext as background only for relationship, setting, and topic coherence. ") + +
    "If retrievalTransferPrompt is present, this is a retrieval session: keep the same learned skill, use the new related situation, and reduce help without launching a lesson. " +
    "Accept varied valid replies in the flow; do not imply there is only one exact sentence unless the user asks for the model answer. " +
    // #14 -- the learner must produce more language than the coach. The coach route already caps
    // its lines; this route, where most turns actually happen, had no limit at all, so the
    // character could answer at any length it liked in a product whose point is the learner
    // speaking. One idea per turn keeps the floor with them.
    "characterLineEs is spoken out loud: keep it under 20 words and to ONE idea -- one question, or " +
    "one reaction plus one question. Never stack a reaction, an explanation and a question in the " +
    "same line, and never explain the learner's Spanish back to them; that is another surface's job. " +
    "The learner should end every turn having said more than you did. " +
    "Close naturally within 4 to 8 character turns. Every response must set isRepairTurn and repairType -- on a normal turn, isRepairTurn is " +
    "false and repairType is null. Also produce suggestedReplyFrameEs (one natural Spanish sentence frame with exactly one blank, " +
    'e.g. "Sí, porque ___.") and suggestedReplyEs (one full natural Spanish answer the user could say for this turn\'s ' +
    "expectedCommunicativeFunction). Follow conversationDifficultyGuidance exactly for turn pacing. Output only structured JSON.";

  /**
   * #44 -- the character reacted identically whether the learner nailed it or dodged, because the
   * route was never told which had happened.
   *
   * The split is deliberate and load-bearing: `recentEvidence` is settled, so the character may
   * speak about it as fact. `thisTurn` is measurement of DELIVERY only -- the evaluation of the
   * reply it just heard has not landed yet -- so reacting to it as if it were a verdict on the
   * Spanish would be praising work nobody has checked, which is the exact failure Phase 0 spent
   * itself removing.
   */
  const reactionPrompt = (() => {
    if (!reaction.recentEvidence.length && !reaction.thisTurn) return "";
    const lines = [
      "You are given two kinds of signal about the learner. React to them AS THE CHARACTER, in one short beat before your line -- never as a teacher, never as a score, and never more than a handful of words.",
    ];
    if (reaction.recentEvidence.length) {
      lines.push(
        `recentEvidence is the settled verdict on their EARLIER replies, oldest first: ${JSON.stringify(reaction.recentEvidence)}. You may speak about these as fact. A run of "clear" with assistance "none" earns real, specific warmth -- surprise, even, if they used to need help. Repeated "unclear", or help climbing turn after turn, means stop being uniformly pleasant: slow down, make the next question smaller and more concrete.`,
      );
    }
    if (reaction.thisTurn) {
      lines.push(
        `thisTurn describes only HOW the reply you just heard came out, not whether it was correct -- that evaluation has not finished: ${JSON.stringify(reaction.thisTurn)}. secondsToFirstWord and hesitations describe the pause before and inside their answer; englishWords is how much English leaked in; assistance and usedSubtitle are what they reached for on this turn; unaidedRun is how many replies in a row they have made without reaching for anything.`,
      );
      lines.push(
        "You may react to delivery -- that it came out fast, or that they pushed through a long pause. You may NOT say or imply their Spanish was right, good, correct, perfect or well-formed on the basis of thisTurn: you have not been told that and it may be false. If they leaned on help or leaked English, do not congratulate; just carry on warmly and keep the next question small.",
      );
    }
    lines.push(
      "Never read these signals out loud, never mention timing in seconds, never name the help they used, and never let the reaction grow into a second sentence. It is a beat, then your line.",
    );
    return lines.join(" ");
  })();

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
    "user to try rephrasing IN THEIR OWN WORDS. This is the hardest rule on a repair turn and it was " +
    "observed being broken: responseGuidanceEn must not contain any Spanish at all, must not name or " +
    "quote a pattern or frame (nothing of the shape \"use 'Quisiera ___, por favor'\"), and must not " +
    "hint at the target sentence. Say only that you did not catch it and to try saying it a different " +
    "way. Handing them the phrasing here defeats the entire point: the learner is meant to repair " +
    "their own meaning, which is the one skill a real conversation demands. The character is a person who simply didn't catch it, not a judge or a teacher: " +
    "stay warm and human, never mocking, never a wall of grammar correction -- this is confused dialogue, not feedback. " +
    "Do not end the conversation here: shouldClose must be false and closingReason must be null.";

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: repairRequested
          // A repair turn deliberately gets no reaction prompt: the character did not understand,
          // so it has nothing to be warm or pressing about yet.
          ? `${baseSystemPrompt} ${pressureModePrompt} ${repairSystemPrompt}`.trim()
          : `${baseSystemPrompt} ${pressureModePrompt} ${reactionPrompt}`.trim(),
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
          conversationDifficultyGuidance: conversationDifficultyGuidance(turnIndex, state.pressureMode, state.sceneIsNew),
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
