import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildRescuePrompt, rescueJsonSchema } from "@/lib/prompt";
import { buildMockRescueResponse, isMockAiEnabled } from "@/lib/mock-ai";
import { backgroundModel } from "@/lib/model-config";
import { checkRateLimit } from "@/lib/rate-limit";
import { rescueResponseSchema } from "@/lib/rescue-schema";

const requestSchema = z.object({
  entryMode: z.enum(["wanted_to_say", "received_spanish"]),
  originalText: z.string().min(4).max(1600),
  scenarioContext: z.string().max(1600).nullable().optional(),
  context: z.object({
    who: z.string().min(1),
    dialect: z.string().min(1),
    tone: z.string().min(1),
  }),
  selfReportedBlocker: z
    .enum([
      "words_to_sentences",
      "freeze_under_pressure",
      "missing_words",
      "pronunciation_nerves",
      "sounds_unnatural",
      "grammar_falls_apart",
      "follow_ups_break_me",
      "not_sure",
    ])
    .nullable(),
  selfReportedBlockers: z
    .array(
      z.enum([
        "words_to_sentences",
        "freeze_under_pressure",
        "missing_words",
        "pronunciation_nerves",
        "sounds_unnatural",
        "grammar_falls_apart",
        "follow_ups_break_me",
        "not_sure",
      ]),
    )
    .max(8)
    .optional(),
  attempt: z.string().max(1600),
  skippedAttempt: z.boolean(),
  voiceAttempt: z
    .object({
      transcript: z.string(),
      freeze: z.object({
        timeToFirstWordSeconds: z.number().nullable(),
        hesitationCount: z.number(),
        englishWordCount: z.number(),
        summary: z.string(),
      }),
    })
    .nullable()
    .optional(),
});

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "rescue", Number(process.env.MAX_OPENAI_REQUESTS_PER_SESSION ?? 25), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Tell me a little more first." }, { status: 400 });
  }

  try {
    if (isMockAiEnabled()) {
      return NextResponse.json(buildMockRescueResponse(parsed.data));
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Outloud's hosted AI is not connected yet." }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: backgroundModel(),
      input: buildRescuePrompt(parsed.data),
      temperature: 0.2,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "spanish_rescue_card",
          strict: true,
          schema: rescueJsonSchema,
        },
      },
    });

    const raw = response.output_text;
    const rescue = rescueResponseSchema.parse(JSON.parse(raw));
    return NextResponse.json(rescue);
  } catch {
    return NextResponse.json(
      { error: "Outloud could not answer yet. Try again in a few seconds." },
      { status: 502 },
    );
  }
}
