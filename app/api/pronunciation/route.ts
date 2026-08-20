import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { backgroundModel } from "@/lib/model-config";
import {
  freezeSignalsSchema,
  pronunciationCoachingJsonSchema,
  pronunciationCoachingSchema,
} from "@/lib/pronunciation-schema";
import { checkRateLimit } from "@/lib/rate-limit";

const contextSchema = z.object({
  who: z.string().min(1),
  dialect: z.string().min(1),
  tone: z.string().min(1),
});

const requestSchema = z.object({
  phraseEs: z.string().min(1).max(600),
  phraseMeaningEn: z.string().min(1).max(600),
  attemptTranscript: z.string().min(1).max(1600),
  freeze: freezeSignalsSchema,
  context: contextSchema,
});

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "pronunciation", Number(process.env.MAX_OPENAI_REQUESTS_PER_SESSION ?? 25), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Pronunciation practice needs the phrase and your attempt." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Pronunciation practice needs the phrase and your attempt." }, { status: 400 });
  }

  try {
    if (isMockAiEnabled()) {
      return NextResponse.json(buildMockPronunciationCoaching(parsed.data.phraseEs, parsed.data.attemptTranscript));
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Outloud's pronunciation AI is not connected yet." }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: backgroundModel(),
      input: [
        {
          role: "system",
          content:
            "You give one intelligibility-only spoken note for a Spanish phrase the learner just tried to say. " +
            "Judge whether a native speaker would understand the attempt, never accent or nativeness. " +
            "Do not punish foreign accent. Do not make accent marks the correction unless the phrase is otherwise already natural. " +
            "Give exactly one concrete note only when something would block understanding. " +
            "If the phrase would be understood, affirm plainly in one sentence. " +
            "If it would not be understood, name one word or sound to make clearer in one sentence. Never give a list. Output only structured JSON.",
        },
        {
          role: "user",
          content: JSON.stringify(parsed.data),
        },
      ],
      temperature: 0.1,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "pronunciation_coaching",
          strict: true,
          schema: pronunciationCoachingJsonSchema,
        },
      },
    });

    return NextResponse.json(pronunciationCoachingSchema.parse(JSON.parse(response.output_text)));
  } catch {
    return NextResponse.json({ error: "Outloud could not check that pronunciation yet. Try again." }, { status: 502 });
  }
}

function buildMockPronunciationCoaching(phraseEs: string, attemptTranscript: string) {
  if (normalizedSpeech(phraseEs) === normalizedSpeech(attemptTranscript)) {
    return pronunciationCoachingSchema.parse({
      intelligible: true,
      fixWord: null,
      coachingNoteEn: "That would be understood clearly.",
    });
  }

  return pronunciationCoachingSchema.parse({
    intelligible: false,
    fixWord: firstSpanishWord(phraseEs),
    coachingNoteEn: `Make "${firstSpanishWord(phraseEs)}" land clearly, then say the whole phrase again.`,
  });
}

function normalizedSpeech(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSpanishWord(value: string) {
  return value.match(/[\p{L}\p{M}]+/u)?.[0] ?? "the phrase";
}
