export type TranscriptionConfidenceTier = "reliable" | "borderline" | "unreliable";

export type WhisperSegmentConfidence = {
  avgLogprob: number | null;
  noSpeechProb: number | null;
  compressionRatio: number | null;
};

// Hard thresholds mirror Whisper's own reference-implementation fallback heuristic
// (no_speech_threshold=0.6, logprob_threshold=-1.0, compression_ratio_threshold=2.4). Soft
// thresholds are a tighter band inside that, flagged as merely worth a human's second look
// rather than blocked outright. Starting point to validate against real recordings, not tuned.
const NO_SPEECH_HARD = 0.6;
const LOGPROB_HARD = -1.0;
const COMPRESSION_HARD = 2.4;
const NO_SPEECH_SOFT = 0.3;
const LOGPROB_SOFT = -0.5;

export function classifyTranscriptionConfidence(
  segments: WhisperSegmentConfidence[],
): TranscriptionConfidenceTier {
  // No diagnostic data at all (e.g. the mock path, or a Whisper response shape without
  // segments) -- never penalize an attempt for data we don't have.
  if (!segments.length) return "reliable";

  let unreliable = false;
  let borderline = false;

  for (const segment of segments) {
    const noSpeech = segment.noSpeechProb ?? 0;
    const logprob = segment.avgLogprob ?? 0;
    const compression = segment.compressionRatio ?? 0;

    if ((noSpeech > NO_SPEECH_HARD && logprob < LOGPROB_HARD) || compression > COMPRESSION_HARD) {
      unreliable = true;
    } else if (noSpeech > NO_SPEECH_SOFT || logprob < LOGPROB_SOFT) {
      borderline = true;
    }
  }

  return unreliable ? "unreliable" : borderline ? "borderline" : "reliable";
}
