import { NextResponse } from "next/server";
import { z } from "zod";
import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";
import { checkRateLimit } from "@/lib/rate-limit";
import { rescueResponseSchema } from "@/lib/rescue-schema";
import { retrievalVariationSchema } from "@/lib/practice-schema";
import { characterVoiceDeliveryStyle } from "@/lib/character-voice";

const contextSchema = z.object({
  who: z.string().min(1).max(80),
  dialect: z.string().min(1).max(80),
  tone: z.string().min(1).max(80),
});

const requestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("conversation").optional().default("conversation"),
    originalText: z.string().min(4).max(1600),
    scenarioContext: z.string().max(1600).nullable().optional(),
    context: contextSchema,
    rescue: rescueResponseSchema,
    transferPrompt: retrievalVariationSchema.nullable().optional(),
    pressureMode: z.boolean().optional().default(false),
  }),
  z.object({
    mode: z.literal("intake"),
    context: contextSchema,
  }),
]);

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "realtime", 5, 24 * 60 * 60 * 1000);
  if (limited) return limited;

  if (process.env.OUTLOUD_REALTIME_ENABLED === "false") {
    return NextResponse.json({ error: "Live rehearsal is not enabled yet." }, { status: 503 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI is not configured." }, { status: 500 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Live practice needs the completed setup first." }, { status: 400 });
  }

  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";
  const silenceDurationMs = parsed.data.mode === "conversation" && parsed.data.pressureMode ? 850 : 1200;
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": await safetyIdentifier(request),
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model,
        instructions: buildRealtimeInstructions(parsed.data),
        audio: {
          input: {
            // Deliberately NOT OPENAI_TRANSCRIBE_MODEL. That one belongs to /api/transcribe, which
            // asks for verbose_json with word timestamps to derive freeze signals -- something the
            // gpt-4o-transcribe family does not return. This session instead needs a model that
            // streams input_audio_transcription.delta events so the placement screen can show the
            // transcript while the user is still speaking.
            transcription: { model: process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              silence_duration_ms: silenceDurationMs,
              create_response: false,
              interrupt_response: false,
            },
          },
          output: { voice },
        },
      },
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: "Live rehearsal could not start yet." }, { status: 502 });
  }

  const value = json.value ?? json.client_secret?.value ?? json.client_secret;
  if (typeof value !== "string") {
    return NextResponse.json({ error: "Live rehearsal token was not returned." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    model,
    voice,
    value,
    expiresAt: json.expires_at ?? json.client_secret?.expires_at ?? null,
  });
}

function buildRealtimeInstructions(data: z.infer<typeof requestSchema>) {
  if (data.mode === "intake") {
    return `
# Role & Objective
You are Outloud's one-shot voice intake bridge.
Ask exactly one short question, listen, and let transcription capture the learner's answer.
${naturalSpanishSystemPrompt}

# Intake Rules
- Only speak when the client sends a response.create event.
- The response.create instructions will contain one literal coach line to say. Say that line only.
- Do not roleplay, coach, diagnose, continue the story, or ask follow-up questions.
- Never automatically answer the learner. The app will turn their transcript into a rescue card.

# Delivery Style Only
- Keep it warm, brief, and calm.
- Context defaults for later: ${data.context.who}, ${data.context.dialect}, ${data.context.tone}.
`.trim();
  }

  return `
# Role & Objective
You are Outloud's controlled live voice bridge, not a roleplay generator and not a tutor.
The app owns every conversation turn. Your only job is to speak the exact Spanish text the app gives you in explicit response.create instructions.
${naturalSpanishSystemPrompt}

# Voice Bridge Rules
- Only speak when the client sends a response.create event.
- The response.create instructions will contain one literal line to say. Say that line only.
- Never invent dialogue, continue the story, ask a follow-up, coach, correct, summarize, or add filler.
- Never respond automatically to the learner's microphone input. The app will evaluate their transcript and decide the next line.
- If asked to repeat more slowly, speak the same literal line more slowly without changing the wording.

# Delivery Style Only
- Deliver literal Spanish lines using ${data.context.dialect} Spanish pronunciation and a ${data.context.tone.toLowerCase()} tone.
- Treat the character as ${data.context.who} only for warmth, pace, and delivery style; do not use that context to create new content.

# Character Delivery
- ${characterVoiceDeliveryStyle(data.context.who, data.pressureMode)}

# Session Limits
- Do not give CEFR levels, global fluency scores, XP, streaks, or invented claims.

# Saved Moment
Target message: ${data.originalText}
Scenario context: ${data.scenarioContext ?? "not provided"}
Natural model answer from the rescue: ${data.rescue.natural_version}
One correction: ${data.rescue.one_correction}
Important phrase: ${data.rescue.important_phrase.spanish} = ${data.rescue.important_phrase.meaning_en}
`.trim();
}

async function safetyIdentifier(request: Request) {
  const source =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("user-agent") ??
    "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
