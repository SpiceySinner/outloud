import type { FreezeSignals } from "@/lib/types";

export type TimedWord = {
  word: string;
  start: number;
  end: number;
};

export type ClientVoiceMetrics = {
  firstSpeechMs: number | null;
  hesitationCount: number;
  durationMs: number;
};

// Exported so lib/repair-loop.ts can reuse the exact same fallback-word dictionary for the
// misunderstanding/repair loop's English-fallback signal, instead of duplicating the list.
export const englishRescueWords = new Set([
  "because",
  "traffic",
  "late",
  "sorry",
  "work",
  "car",
  "home",
  "mom",
  "dad",
  "mother",
  "father",
  "dinner",
  "food",
  "soup",
  "tired",
  "nervous",
  "quiet",
  "repeat",
  "slow",
  "slower",
  "address",
  "appointment",
  "please",
  "thanks",
  "thank",
  "like",
  "but",
  "just",
  "really",
]);

export function buildFreezeSignals({
  transcript,
  words,
  clientMetrics,
}: {
  transcript: string;
  words: TimedWord[];
  clientMetrics?: ClientVoiceMetrics | null;
}): FreezeSignals {
  const firstWordSeconds =
    typeof words[0]?.start === "number"
      ? words[0].start
      : clientMetrics?.firstSpeechMs
        ? clientMetrics.firstSpeechMs / 1000
        : null;

  const timedHesitations = words.reduce((count, word, index) => {
    if (index === 0) return count;
    const previous = words[index - 1];
    return word.start - previous.end >= 1.2 ? count + 1 : count;
  }, 0);

  const hesitationCount = Math.max(timedHesitations, clientMetrics?.hesitationCount ?? 0);
  const englishWordCount = countEnglishRescueWords(transcript);
  const timeLabel = firstWordSeconds === null ? "a little while" : `${roundOne(firstWordSeconds)}s`;
  const switched = englishWordCount === 1 ? "switched to English once" : `switched to English ${englishWordCount} times`;
  const paused =
    hesitationCount === 0
      ? "kept moving once you started"
      : hesitationCount === 1
        ? "had one long pause"
        : `had ${hesitationCount} long pauses`;

  return {
    timeToFirstWordSeconds: firstWordSeconds === null ? null : roundOne(firstWordSeconds),
    hesitationCount,
    englishWordCount,
    summary:
      englishWordCount > 0
        ? `you took ${timeLabel} to start and ${switched}; totally normal, that's the exact thing we're going to kill.`
        : `you took ${timeLabel} to start and ${paused}; good, now we know where the pause happens.`,
  };
}

export function countEnglishRescueWords(transcript: string) {
  return transcript
    .toLowerCase()
    .split(/[^a-záéíóúüñ]+/i)
    .filter((word) => englishRescueWords.has(word)).length;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
