/**
 * What a captured utterance is allowed to be, and what it must never be mistaken for.
 *
 * Every rule in here was paid for by a real failure in the room, so they live outside the room:
 * `/dash` captures speech too now, and a second copy of these tests would drift from this one.
 * Drift is how this codebase keeps producing features that look built and are not.
 *
 * These are pure. They classify a string; they never decide what to do about it. The reaction --
 * which note to show, whether to widen the silence window, whether to count a strike -- belongs to
 * the screen that asked, because the room and the entry screen genuinely want different things.
 */

/**
 * Sounds a person makes while still deciding what to say.
 *
 * Deliberately narrow. "eh" and "este" are also real Spanish words and "well" and "like" are real
 * English ones. "mm", "mmm" and "mhm" are left out for a sharper reason: as a whole utterance they
 * usually mean YES, and a learner answering a yes/no question with one has answered it. Swallowing
 * that as hesitation would silently discard a correct reply -- the exact failure the short-answer
 * rule exists to prevent.
 */
export const fillerSounds = new Set([
  "um", "umm", "uhm", "uh", "uhh", "er", "err", "erm", "ehm", "emm", "em",
  "hm", "hmm", "hmmm", "ähm", "äh", "öhm",
]);

/**
 * Reactions -- kept apart from the stalls above, and for a while kept out entirely on the grounds
 * that "ah" is a reaction and not a stall.
 *
 * That reasoning is right about a reaction INSIDE an utterance: "ah, sí, quiero un café" is an
 * answer with a noise on the front, and the rule below never touches it because the other words
 * are not in either set. It is wrong about a reaction that is the WHOLE utterance. "ah..." on its
 * own answers nothing, and a learner who produced it was reacting or thinking, not speaking.
 *
 * Reported live: a capture of exactly "ah..." was shown in the confirm box under the heading
 * "here's what I heard. fix anything that's wrong, then send." The transcription was perfect.
 * There was simply nothing in it, and being asked to correct it is being told the microphone is
 * the problem when it is not.
 */
export const reactionSounds = new Set([
  "ah", "ahh", "ahhh", "oh", "ohh", "ohhh", "ay", "aiy", "uf", "puf", "hu", "huh",
]);

/** Punctuation a hesitation transcribes as. Letters and digits survive, so real content fails. */
const spokenPunctuation = /[.,!?¿¡…"'`\-—–]/g;

function spokenWords(attempt: string) {
  return attempt.toLowerCase().replace(spokenPunctuation, " ").split(/\s+/).filter(Boolean);
}

/**
 * True when the capture contains nothing but hesitation or reaction.
 *
 * Server VAD ends a turn on silence, and a learner who says "um..." and then thinks has produced
 * exactly that: a complete turn, by the microphone's definition, containing no answer. Sending it
 * on gets it flagged as a broken attempt and puts a confirm box in front of someone who was still
 * working out how to start -- asking them to correct a transcript that was perfectly accurate.
 *
 * EVERY word has to be one of these, which is what keeps it off real answers: one real word
 * anywhere in the utterance and this is false, so "ah, sí" and "uh, quiero un café" are safe.
 */
export function isFillerOnly(attempt: string) {
  const words = spokenWords(attempt);
  return words.length > 0 && words.every((word) => fillerSounds.has(word) || reactionSounds.has(word));
}

/**
 * A transcript that is a decoder stuck in a loop rather than anything a person said.
 *
 * Whisper-family models repeat when handed a truncated or content-poor clip -- the same short
 * phrase over and over until the token budget runs out. Observed live as "Oh god" roughly twenty
 * times, produced after server VAD cut the learner off mid-sentence.
 *
 * It slipped through every existing gate: not empty, VAD had seen speech, not filler, and it
 * contains none of the words `looksBrokenAttempt` looks for -- so it was submitted without even a
 * confirm box, scored, stored, and then shown back on the closing card as the learner's own
 * words. Being quoted saying something you never said is worse than any missed turn.
 *
 * Non-overlapping windows so a genuinely repeated unit is what triggers this, not an unlucky
 * n-gram: a unit has to repeat at least four times AND cover most of the transcript.
 */
export function looksLikeDecodeLoop(attempt: string) {
  const words = spokenWords(attempt);
  // Short repetition is human: "sí, sí, sí" and a stutter both live down here.
  if (words.length < 8) return false;

  for (let size = 1; size <= 4; size += 1) {
    const counts = new Map<string, number>();
    for (let i = 0; i + size <= words.length; i += size) {
      const unit = words.slice(i, i + size).join(" ");
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
    for (const seen of counts.values()) {
      if (seen >= 4 && (seen * size) / words.length >= 0.6) return true;
    }
  }
  return false;
}

/** A spoken attempt that visibly broke: trailing off, or English leaking into the Spanish. */
export function looksBrokenAttempt(attempt: string) {
  return (
    attempt.includes("...") ||
    /\b(uh|um|ehm|how do you say|the|and|you|want|is|was|do|don't|know)\b/i.test(attempt)
  );
}

/**
 * What came back from one capture window, in the order the checks have to run.
 *
 * - `no-speech`: server VAD never reported speech, yet a transcript arrived. Almost certainly a
 *   hallucination from room noise. There is no graded confidence signal on the realtime path, so
 *   VAD is the only gate available -- and it has to be checked before the content ones, because a
 *   hallucinated transcript can look perfectly well-formed.
 * - `empty`: speech was seen and nothing came back.
 * - `decode-loop`: see above. Discarded before anything can score or store it.
 * - `filler`: they are still thinking and the microphone mistook a pause for an ending.
 * - `ok`: a real utterance.
 */
export type CaptureVerdict = "ok" | "empty" | "no-speech" | "decode-loop" | "filler";

export function classifyCapture(transcript: string, speechSeen: boolean): CaptureVerdict {
  const said = transcript.trim();
  if (!speechSeen) return "no-speech";
  if (!said) return "empty";
  if (looksLikeDecodeLoop(said)) return "decode-loop";
  if (isFillerOnly(said)) return "filler";
  return "ok";
}

export const mediaRecorderTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
];

/**
 * Shared by every capture path so they can't drift: echo cancellation is what stops an open mic
 * from hearing the coach through the speaker, and the recorder fallback needs it just as much as
 * the realtime path does.
 */
export const micConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};
