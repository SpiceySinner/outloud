import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildMockRetrievalVariation, isMockAiEnabled } from "@/lib/mock-ai";
import { backgroundModel } from "@/lib/model-config";
import { buildRetrievalVariationPrompt } from "@/lib/practice-prompts";
import { retrievalVariationJsonSchema, retrievalVariationSchema } from "@/lib/practice-schema";
import { checkRateLimit } from "@/lib/rate-limit";
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
});

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "variation", Number(process.env.MAX_OPENAI_REQUESTS_PER_SESSION ?? 25), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A changed situation needs the saved practice first." }, { status: 400 });
  }

  try {
    if (isMockAiEnabled()) {
      return NextResponse.json(buildMockRetrievalVariation(parsed.data.rescue));
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Outloud's variation AI is not connected yet." }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: backgroundModel(),
      input: buildRetrievalVariationPrompt(parsed.data),
      temperature: 0.35,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "retrieval_variation",
          strict: true,
          schema: retrievalVariationJsonSchema,
        },
      },
    });

    return NextResponse.json(retrievalVariationSchema.parse(JSON.parse(response.output_text)));
  } catch {
    return NextResponse.json({ error: "Outloud could not create the changed situation yet. Try again." }, { status: 502 });
  }
}
