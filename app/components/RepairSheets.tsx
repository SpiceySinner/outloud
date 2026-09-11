"use client";

/**
 * The repair loop: one correction, and the sound of it.
 *
 * Lifted out of `app/page.tsx` on 2026-09-11, unchanged. The two share a file because they are one
 * loop — the correction offers a sentence to say back, and if the trouble turns out to be the sound
 * rather than the words, it hands over to the pronunciation sheet and back.
 *
 * Both are reached from the help ladder. The chips in the session tool row can also open them, but
 * only once a turn has produced something to fix, so the ladder is the door that is always there.
 *
 * `naturalVersion` is what both primary buttons hang on, and it can legitimately be empty before
 * the first reply — which is why every one of them is disabled on it rather than assuming it.
 */

/** The correction the room is currently offering. Built in `app/page.tsx`. */
type Correction = {
  gap: string;
  pattern: string;
  /** Empty until a reply has been evaluated. Both "say it back" buttons hang on it. */
  naturalVersion: string;
};

export function CorrectionSheet({
  correction,
  hasPronunciationTarget,
  transcriptionWasBorderline,
  retryFeedback,
  onPronounce,
  onSayItBack,
}: {
  correction: Correction;
  /** Whether the sound was also part of the problem, which reveals the way across. */
  hasPronunciationTarget: boolean;
  /** Whisper thought this one was hard to hear, so the correction above deserves a caveat. */
  transcriptionWasBorderline: boolean;
  /** Short feedback from the last say-it-back, if there was one. */
  retryFeedback: string | null;
  onPronounce: () => void;
  onSayItBack: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="Correction">
      <h2>one correction</h2>
      <div className="correction-stack">
        <div>
          <span>gap</span>
          <p>{correction.gap}</p>
        </div>
        <div>
          <span>pattern</span>
          <p>{correction.pattern}</p>
        </div>
        <div className="natural-line">
          <span>natural version</span>
          <p>{correction.naturalVersion || "finish one reply and this will fill in."}</p>
        </div>
      </div>
      {hasPronunciationTarget ? (
        <button type="button" className="quiet-link" onClick={onPronounce}>
          pronunciation also affected clarity — practice it →
        </button>
      ) : null}
      {transcriptionWasBorderline ? (
        <p className="tiny-note">this was hard to hear clearly — the correction above may be less reliable.</p>
      ) : null}
      {retryFeedback ? <p className="sheet-note sage-note">{retryFeedback}</p> : null}
      <button
        className="sheet-primary"
        type="button"
        disabled={!correction.naturalVersion}
        onClick={onSayItBack}
      >
        say it back
      </button>
      <p className="tiny-note">
        {correction.naturalVersion ? `say: ${correction.naturalVersion}` : "OutLoud needs one reply first."}
      </p>
    </section>
  );
}

/**
 * The word, broken into syllables, with the stressed one marked.
 *
 * **Intelligibility only, and the panel says so out loud.** This is not an accent lesson: the
 * question is whether the word survives being said, not whether it sounds native.
 */
export function PronunciationSheet({
  syllables,
  stressedIndex,
  word,
  coachingNote,
  naturalVersion,
  isRetrying,
  onTryAgain,
  onEnough,
}: {
  syllables: string[];
  /** Which syllable carries the stress. Defaulted by the room, never guessed here. */
  stressedIndex: number;
  /** The single word being worked on, when there is one. */
  word: string | null;
  coachingNote: string | null;
  naturalVersion: string;
  /** True while this sheet owns the turn, which is the only time leaving it needs a way back. */
  isRetrying: boolean;
  onTryAgain: () => void;
  onEnough: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="Pronunciation">
      <h2>make it clear</h2>
      <div className="syllable-row">
        {syllables.map((part, index) => (
          <button className={index === stressedIndex ? "is-stressed" : ""} type="button" key={`${part}-${index}`}>
            {part}
          </button>
        ))}
      </div>
      <div className="pronunciation-panel">
        <span>intelligibility only</span>
        <p>{coachingNote ?? word ?? naturalVersion}</p>
      </div>
      <button
        className="sheet-primary"
        type="button"
        disabled={!naturalVersion && !word}
        onClick={onTryAgain}
      >
        try again
      </button>
      {isRetrying ? (
        <button className="quiet-link" type="button" onClick={onEnough}>
          that&apos;s enough for now
        </button>
      ) : null}
      <p className="tiny-note">go as many times as you want.</p>
    </section>
  );
}
