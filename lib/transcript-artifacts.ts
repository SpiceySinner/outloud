/**
 * Whisper does not return an empty string for silence. It fills the gap with text from its
 * training data -- subtitle credits, channel plugs, the "Learn English for free www.engvid.com"
 * watermark that sits on thousands of hours of captioned lesson videos. A user who taps the mic,
 * says nothing and lets go gets one of these pasted into their answer box as if they had said it.
 *
 * Matching is per whole sentence, never per substring. Several of these are ordinary English and
 * Spanish, and a substring match would silently delete real speech -- a far worse failure than
 * letting one artifact through. For the same reason the list holds only phrases that cannot
 * plausibly be a learner's attempt: web addresses, subtitle credits, channel sign-offs. Whisper's
 * other common silence outputs ("you", "thank you", "bye") are deliberately absent -- they are all
 * things a learner reaching for English mid-sentence might genuinely say, and lib/prompt.ts asks
 * the transcriber to preserve exactly that.
 */
const artifactSentences = new Set([
  "learn english for free www engvid com",
  "www engvid com",
  "engvid com",
  "subtitles by the amara org community",
  "subtitles by amara org community",
  "subtitulos realizados por la comunidad de amara org",
  "subtitulado por la comunidad de amara org",
  "subtitulos por la comunidad de amara org",
  "subs by www zeoranger co uk",
  "please subscribe to my channel",
  "dont forget to subscribe",
  "thanks for watching and dont forget to subscribe",
  "suscribete al canal",
  "gracias por ver el video",
  "mas informacion www smartcar com",
  "www mooji org",
]);

/**
 * Lowercase, accent-free, letters and digits separated by single spaces. Punctuation becomes a
 * space rather than nothing, so "www.engvid.com" normalises to "www engvid com" -- which is the
 * form the list above is written in. Accents are stripped so "Subtítulos" and "Subtitulos" are the
 * same string; the transcriber is inconsistent about them in exactly these boilerplate lines.
 */
function normalize(sentence: string) {
  return sentence
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Returns the transcript with known silence artifacts removed, or "" when nothing else was said.
 * Callers should treat "" as "nothing was heard" rather than as a transcription failure -- the
 * recording worked, there was just no speech in it.
 */
export function stripTranscriptArtifacts(transcript: string) {
  const sentences = transcript.split(/(?<=[.!?])\s+|\n+/);
  const kept = sentences.filter((sentence) => {
    const normalized = normalize(sentence);
    return normalized.length > 0 && !artifactSentences.has(normalized);
  });
  // A transcript with no sentence-ending punctuation is one sentence, so this also covers the bare
  // "Learn English for free www.engvid.com" with no full stop.
  return kept.join(" ").trim();
}
