"use client";

/**
 * The four sheets you open mid-conversation.
 *
 * Lifted out of `app/page.tsx` on 2026-09-11, unchanged. What they share is when they are used:
 * the learner is in a scene, something is in the way, and none of these is worth losing the turn
 * over. Read back what has happened, change how hard the other person is being, ask a question in
 * English, or put the screen away entirely.
 */

/**
 * Only what the ask sheet reads. `LifelineResponse` is declared in `app/page.tsx`, and importing it
 * back would make the room and its own sheet depend on each other.
 */
type Lifeline = {
  options: Array<{ spanish: string; meaningEn: string }>;
  fallbackFrameEs: string;
  noteEn: string;
};

/** Only the fields the transcript renders. `SessionTurn` itself lives in `app/page.tsx`. */
type Turn = {
  characterLineEs: string;
  userAttempt: string;
  evaluation?: { correctedAttemptEs?: string | null } | null;
};

/**
 * Every turn so far, in order.
 *
 * Its "back" button is the only re-entry to the after card: that card is opened once, when the
 * session closes, and the sheet handle here would close the whole overlay layer instead of
 * stepping back one. Worth knowing before changing either.
 */
export function TranscriptSheet({ turns, onBack }: { turns: Turn[]; onBack: () => void }) {
  return (
    <section className="room-sheet" aria-label="Transcript review">
      <h2>review transcript</h2>
      <div className="transcript-list">
        {turns.length ? (
          turns.map((turn, index) => (
            <article key={`${turn.characterLineEs}-${index}`}>
              <span>her</span>
              <p>{turn.characterLineEs}</p>
              <span>you</span>
              <p>{turn.userAttempt}</p>
              {turn.evaluation?.correctedAttemptEs ? (
                <>
                  <span>natural version</span>
                  <p>{turn.evaluation.correctedAttemptEs}</p>
                </>
              ) : null}
            </article>
          ))
        ) : (
          <article>
            <p>finish one conversation turn and this will show what happened.</p>
          </article>
        )}
      </div>
      <button className="sheet-link sage-link" type="button" onClick={onBack}>
        back
      </button>
    </section>
  );
}

/**
 * How hard the other person is going to be.
 *
 * `patient` currently behaves like `real` — nothing server-side branches on it yet, and the copy
 * says so rather than pretending otherwise.
 *
 * A dead end: nothing in here changes which sheet is open, so the sheet handle is the only way out.
 */
export function PressureSheet({
  toneMode,
  setToneMode,
}: {
  toneMode: "patient" | "real" | "pressure";
  setToneMode: (tone: "patient" | "real" | "pressure") => void;
}) {
  return (
    <section className="room-sheet" aria-label="Pressure">
      <h2>how real should it feel?</h2>
      <div className="pressure-list">
        <button
          className={toneMode === "patient" ? "is-active" : ""}
          type="button"
          onClick={() => setToneMode("patient")}
        >
          patient
        </button>
        <button
          className={toneMode === "real" ? "is-active" : ""}
          type="button"
          onClick={() => setToneMode("real")}
        >
          real person
        </button>
        <button
          className={toneMode === "pressure" ? "is-active" : ""}
          type="button"
          onClick={() => setToneMode("pressure")}
        >
          under pressure
        </button>
      </div>
      <p className="sheet-note sage-note">
        {toneMode === "pressure"
          ? "more interruptions, real curveballs, less waiting."
          : toneMode === "patient"
            ? "same pace as real person for now — a calmer mode is coming."
            : "some interruptions. natural follow-ups. a little less waiting."}
      </p>
      <p className="tiny-note">you can change this anytime.</p>
    </section>
  );
}

/**
 * A question in English, mid-scene, without losing the turn.
 *
 * Shows `options[0]` and nothing else. That is right here and wrong on the ask ENTRY screen, where
 * choosing between the options is the lesson — this one is interrupting a conversation, and a menu
 * would make going back harder than it needs to be.
 *
 * `onClose` is the room's `closeOverlay`, which also clears the draft and the answer. That reset
 * belongs to the room, which owns the state.
 */
export function AskSheet({
  draft,
  setDraft,
  resetStatus,
  answer,
  status,
  onAsk,
  onClose,
}: {
  draft: string;
  setDraft: (value: string) => void;
  /** Typing invalidates the last answer's status, so the two move together. */
  resetStatus: () => void;
  answer: Lifeline | null;
  status: "idle" | "asking" | "answered" | "error";
  onAsk: () => void;
  onClose: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="Ask anything">
      <h2>ask anything</h2>
      <p className="sheet-note">quick question, then back to this turn.</p>
      <textarea
        className="ask-box"
        aria-label="ask a question"
        placeholder="ask in English"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          resetStatus();
        }}
      />
      {answer ? (
        <div className="correction-stack">
          <div className="natural-line">
            <span>use this</span>
            <p>{answer.options[0]?.spanish ?? answer.fallbackFrameEs}</p>
          </div>
          <div>
            <span>means</span>
            <p>{answer.options[0]?.meaningEn ?? answer.noteEn}</p>
          </div>
          <div>
            <span>frame</span>
            <p>{answer.fallbackFrameEs}</p>
          </div>
        </div>
      ) : null}
      {status === "error" ? (
        <p className="sheet-note">OutLoud could not answer that yet. Try it shorter.</p>
      ) : null}
      <button
        className="sheet-primary"
        type="button"
        disabled={!draft.trim() || status === "asking"}
        onClick={onAsk}
      >
        {status === "asking" ? "asking" : answer ? "ask another" : "ask"}
      </button>
      <button className="sheet-link sage-link" type="button" onClick={onClose}>
        back to the room
      </button>
    </section>
  );
}

/**
 * The screen, put away.
 *
 * Everything here is something you can do without looking, which is why the first two close the
 * sheet before they act: hearing the line again is the point, and a sheet in the way of the orb
 * while it speaks defeats it.
 */
export function EyesOffSheet({
  onRepeat,
  onSlower,
  onNextWord,
  onBackToTouch,
}: {
  onRepeat: () => void;
  onSlower: () => void;
  onNextWord: () => void;
  onBackToTouch: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="Eyes off mode">
      <h2>eyes off</h2>
      <div className="eyes-off-stack">
        <button type="button" onClick={onRepeat}>
          repeat that
        </button>
        <button type="button" onClick={onSlower}>
          slower pacing
        </button>
        <button type="button" onClick={onNextWord}>
          give me the next word
        </button>
      </div>
      <button className="sheet-primary" type="button" onClick={onBackToTouch}>
        back to touch
      </button>
    </section>
  );
}
