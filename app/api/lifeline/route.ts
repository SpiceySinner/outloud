import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { lifelineResponseJsonSchema, lifelineResponseSchema } from "@/lib/lifeline-schema";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { backgroundModel } from "@/lib/model-config";
import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";
import { checkRateLimit } from "@/lib/rate-limit";
import { rescueResponseSchema } from "@/lib/rescue-schema";

const requestSchema = z.object({
  query: z.string().min(1).max(300),
  context: z.object({
    who: z.string().min(1),
    dialect: z.string().min(1),
    tone: z.string().min(1),
  }),
  currentLine: z
    .object({
      characterLineEs: z.string(),
      characterMeaningEn: z.string(),
      expectedCommunicativeFunction: z.string(),
    })
    .nullable()
    .optional(),
  rescue: rescueResponseSchema.optional(),
});

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "lifeline", Number(process.env.MAX_OPENAI_REQUESTS_PER_SESSION ?? 25), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That word needs a little more detail." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "That word needs a little more detail." }, { status: 400 });
  }

  try {
    if (isMockAiEnabled()) {
      return NextResponse.json(mockLifeline(parsed.data.query));
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Outloud's lifeline AI is not connected yet." }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: backgroundModel(),
      input: [
        {
          role: "system",
          content:
            "You are a mid-conversation Spanish lifeline for a speaker who blanked or asked one quick English question. " +
            naturalSpanishSystemPrompt +
            " Return only practical words, short chunks, or a one-sentence explanation they can use immediately. Do not start a lesson, do not continue free chat, and do not invent slang. If a regional term is uncertain, use the common form. Output only structured JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            needed_word_or_phrase_in_english: parsed.data.query,
            current_character_line: parsed.data.currentLine ?? null,
            context: parsed.data.context,
            practiced_target: parsed.data.rescue
              ? {
                  naturalVersion: parsed.data.rescue.natural_version,
                  communicativeFunction: parsed.data.rescue.transferableChunk.communicativeFunction,
                  pattern: parsed.data.rescue.transferableChunk.patternEs,
                }
              : null,
            instructions: [
              "Give 1 to 3 Spanish options or short answers with plain English meanings.",
              "Each option must fit the current relationship, tone, and dialect.",
              "fallbackFrameEs should be one natural sentence frame with a blank the user can finish.",
              "noteEn must be one short sentence answering their question and telling them how to use the answer right now.",
            ],
          }),
        },
      ],
      temperature: 0.2,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "lifeline_response",
          strict: true,
          schema: lifelineResponseJsonSchema,
        },
      },
    });

    return NextResponse.json(lifelineResponseSchema.parse(JSON.parse(response.output_text)));
  } catch {
    return NextResponse.json({ error: "Outloud could not find that word yet. Try typing it shorter." }, { status: 502 });
  }
}

function mockLifeline(query: string) {
  const normalized = query.toLowerCase();
  if (/because|why|reason/.test(normalized)) {
    return lifelineResponseSchema.parse({
      queryEn: query,
      options: [{ spanish: "porque", meaningEn: "because", useWhenEn: "use it before the reason" }],
      fallbackFrameEs: "Porque ___.",
      noteEn: "Start with porque, then say the simple reason.",
    });
  }
  if (/sorry|excuse|forgive/.test(normalized)) {
    return lifelineResponseSchema.parse({
      queryEn: query,
      options: [{ spanish: "perdon", meaningEn: "sorry", useWhenEn: "use it to repair the turn softly" }],
      fallbackFrameEs: "Perdon, queria decir ___.",
      noteEn: "Use this first, then try the idea again.",
    });
  }
  return lifelineResponseSchema.parse({
    queryEn: query,
    options: [{ spanish: "lo que quiero decir es", meaningEn: "what I mean is", useWhenEn: "use it when your sentence gets stuck" }],
    fallbackFrameEs: "Lo que quiero decir es ___.",
    noteEn: "Use the frame to restart without leaving the conversation.",
  });
}
