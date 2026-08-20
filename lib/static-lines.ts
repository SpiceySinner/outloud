// Coach lines that never change between sessions (the coach itself is dynamic; only the opening
// is fixed). Their audio is rendered once with
// `npm run render:lines` into public/audio/lines/ and played from disk instead of asking the
// Realtime model to say the same sentence for every learner.
//
// The file name carries a hash of the text, so editing a line here makes the old file
// unreachable (the app then falls back to live speech) until the script is re-run.

export type StaticLine = {
  id: string;
  text: string;
  /** BCP-47 language of the line; drives the TTS delivery instructions. */
  language: "en" | "es";
};

export const openingPrompt = "before we start — what usually trips you up when you speak Spanish?";

export const staticLines: StaticLine[] = [{ id: "opening", text: openingPrompt, language: "en" }];

export function staticLineFileName(line: StaticLine) {
  return `${line.id}-${hashText(line.text)}.mp3`;
}

export function staticLineUrl(line: StaticLine) {
  return `/audio/lines/${staticLineFileName(line)}`;
}

/** Looks up a pre-rendered clip for a coach line; null when the line is dynamic. */
export function staticAudioForText(text: string) {
  const line = staticLines.find((candidate) => candidate.text === text);
  return line ? staticLineUrl(line) : null;
}

// djb2 — tiny, dependency-free, identical in Node and the browser.
function hashText(text: string) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
