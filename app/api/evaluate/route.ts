import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildMockAttemptEvaluation, isMockAiEnabled } from "@/lib/mock-ai";
import { backgroundModel } from "@/lib/model-config";
import { buildAttemptEvaluationPrompt } from "@/lib/practice-prompts";
import { attemptEvaluationJsonSchema, attemptEvaluationSchema, retrievalVariationSchema } from "@/lib/practice-schema";
import { checkRateLimit, openAiRequestsPerDay } from "@/lib/rate-limit";
import { rescueResponseSchema } from "@/lib/rescue-schema";

const requestSchema = z.object({
  originalText: z.string().min(4).max(1600),
  scenarioContext: z.string().max(1600).nullable().optional(),
  context: z.object({
    who: z.string().min(1),
    dialect: z.string().min(1),
    tone: z.string().min(1),
  }),
  rescue: rescueResponseSchema,
  attempt: z.string().max(1600),
  inputMode: z.enum(["spoken", "written"]).optional().default("written"),
  stage: z.enum(["independent_rebuild", "changed_context"]),
  assistanceUsed: z.enum([
    "full_model",
    "sentence_frame",
    "keyword",
    "repeat",
    "slower_audio",
    "english_explanation",
    "none",
  ]),
  /**
   * The character line this attempt is a reply to, when the attempt came from inside a live
   * conversation. Absent for a rebuild, where there is no question and `originalText` is the whole
   * criterion. Without it the evaluator judged every conversational reply against the placement
   * target and marked correct answers wrong -- "estoy bien" to "¿cómo estás?" was reported as
   * failing to produce the target message.
   */
  conversationTurn: z
    .object({
      characterLineEs: z.string().min(1).max(600),
      characterMeaningEn: z.string().max(600).optional(),
      expectedCommunicativeFunction: z.string().max(300).optional(),
    })
    .nullable()
    .optional(),
  variation: retrievalVariationSchema.nullable().optional(),
  /**
   * True when the capture itself (not the Spanish in it) is suspect -- low ASR confidence or no
   * speech detected by VAD. Forces an insufficient-evidence result rather than letting the model
   * judge unreliable audio as if it were a genuine attempt. See lib/practice-prompts.ts.
   */
  lowConfidenceAttempt: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "evaluate", openAiRequestsPerDay(), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "That attempt needs a little more detail." }, { status: 400 });
  }

  try {
    if (isMockAiEnabled()) {
      return NextResponse.json(
        buildMockAttemptEvaluation({
          attempt: parsed.data.attempt,
          assistanceUsed: parsed.data.assistanceUsed,
          isConversationReply: Boolean(parsed.data.conversationTurn),
          lowConfidenceAttempt: parsed.data.lowConfidenceAttempt,
        }),
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Outloud's evaluation AI is not connected yet." }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: backgroundModel(),
      input: buildAttemptEvaluationPrompt(parsed.data),
      temperature: 0.1,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "attempt_evaluation",
          strict: true,
          schema: attemptEvaluationJsonSchema,
        },
      },
    });

    return NextResponse.json(attemptEvaluationSchema.parse(JSON.parse(response.output_text)));
  } catch {
    return NextResponse.json({ error: "Outloud could not evaluate that attempt yet. Try again." }, { status: 502 });
  }
}
