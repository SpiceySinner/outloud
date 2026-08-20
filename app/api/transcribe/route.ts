import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildFreezeSignals, type ClientVoiceMetrics, type TimedWord } from "@/lib/freeze";
import { buildMockVoiceAttempt, isMockAiEnabled } from "@/lib/mock-ai";
import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";
import { checkRateLimit } from "@/lib/rate-limit";
import { stripTranscriptArtifacts } from "@/lib/transcript-artifacts";

type WhisperVerboseResponse = {
  text?: string;
  words?: TimedWord[];
  segments?: Array<{ start: number; end: number; text: string }>;
};

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "transcribe", Number(process.env.MAX_OPENAI_REQUESTS_PER_SESSION ?? 25), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const formData = await request.formData();
  const audio = formData.get("audio");
  const clientMetrics = parseClientMetrics(formData.get("metrics"));

  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was recorded. Typing works too." }, { status: 400 });
  }

  if (audio.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "That recording was too large. Typing works too." }, { status: 400 });
  }

  try {
    if (isMockAiEnabled()) {
      return NextResponse.json(buildMockVoiceAttempt("Creo que tu comida esta muy rica"));
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Voice is not connected on this hosted site yet. Typing works too." }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcription = (await client.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      prompt:
        `${naturalSpanishSystemPrompt} Spanish and English mixed-language learner attempt. Preserve English fallback words like because, traffic, late, sorry, and repeat.`,
    })) as WhisperVerboseResponse;

    // Silence does not come back empty -- it comes back as a subtitle credit or a web address.
    // Stripped here rather than in the client so every caller of this route gets it.
    const transcript = stripTranscriptArtifacts(transcription.text?.trim() ?? "");
    const words = Array.isArray(transcription.words) ? transcription.words : [];
    const freeze = buildFreezeSignals({ transcript, words, clientMetrics });

    return NextResponse.json({ transcript, freeze });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return NextResponse.json({ error: `${message} Typing works too.` }, { status: 502 });
  }
}

function parseClientMetrics(value: FormDataEntryValue | null): ClientVoiceMetrics | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return {
      firstSpeechMs: typeof parsed.firstSpeechMs === "number" ? parsed.firstSpeechMs : null,
      hesitationCount: typeof parsed.hesitationCount === "number" ? parsed.hesitationCount : 0,
      durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 0,
    };
  } catch {
    return null;
  }
}
