"use client";

/** Only the fields this sheet renders. `FeedbackQuestion` itself lives in `app/page.tsx`, and
 *  importing it back would make the room and its own sheet depend on each other. */
type Question = {
  key: string;
  question: string;
  note: string;
  options: string[];
  placeholder: string;
};

/**
 * The feedback questions, one at a time, and the eyes-off switch.
 *
 * Lifted out of `app/page.tsx` on 2026-09-11, unchanged.
 *
 * Eyes-off sits at the top of this sheet rather than in the session tool row because it is a mode,
 * not a per-turn action — and the header pill that opens this sheet is already its indicator.
 *
 * **`onClose` is not just "hide me".** In the room it is `closeOverlay`, which also clears
 * `feedbackStep`, `feedbackPick` and `feedbackText`. That reset belongs to the room, which owns the
 * state; nothing here reimplements it.
 */
export default function FeedbackSheet({
  eyesOffMode,
  setEyesOffMode,
  done,
  saved,
  step,
  questions,
  question,
  pick,
  setPick,
  text,
  setText,
  submitting,
  onSubmit,
  onClose,
}: {
  eyesOffMode: boolean;
  /** The setter itself, not a toggle: the sheet calls it with a function. */
  setEyesOffMode: (update: (current: boolean) => boolean) => void;
  /** Every question answered or skipped. Swaps the whole sheet for the thank-you. */
  done: boolean;
  /** Whether the answers actually reached the server, which is a different thing from done. */
  saved: boolean;
  step: number;
  /** The questions still in play — the room decides which, so the dashes count what is left. */
  questions: Question[];
  question: Question;
  pick: number | null;
  setPick: (index: number) => void;
  text: string;
  setText: (value: string) => void;
  submitting: boolean;
  onSubmit: (skipped: boolean) => void;
  onClose: () => void;
}) {
  return (
    <section className="room-sheet" aria-label="Feedback">
      {/* eyes off is a mode, not a per-turn action, so it lives here rather than in the
          session tool row. The header pill this sheet opens from is already its indicator. */}
      <button
        className={eyesOffMode ? "quiet-link is-active" : "quiet-link"}
        type="button"
        aria-pressed={eyesOffMode}
        onClick={() => setEyesOffMode((current) => !current)}
      >
        {eyesOffMode ? "eyes off is on — turn it off" : "switch to eyes off"}
      </button>
      {done ? (
        <div className="feedback-complete">
          <span className="complete-mark">✓</span>
          <h2>that actually changes what we build next. thanks.</h2>
          <p>{saved ? "saved." : "back to the room"}</p>
          <button className="sheet-primary" type="button" onClick={onClose}>
            done
          </button>
        </div>
      ) : (
        <>
          <div className="feedback-progress">
            <span>{step + 1} of {questions.length}</span>
            <span className="feedback-dashes">
              {questions.map((item, index) => (
                <span className={index <= step ? "is-current" : ""} key={item.key} />
              ))}
            </span>
          </div>
          <h2>{question.question}</h2>
          {question.note ? <p className="sheet-note">{question.note}</p> : null}
          {question.options.length ? (
            <div className="feedback-options">
              {question.options.map((option, index) => (
                <button
                  className={pick === index ? "is-picked" : ""}
                  key={option}
                  type="button"
                  onClick={() => setPick(index)}
                >
                  <span>{pick === index ? "✓" : ""}</span>
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            className="feedback-input"
            aria-label={question.placeholder}
            placeholder={question.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {(pick !== null || question.options.length === 0) ? (
            <button
              className="sheet-primary"
              type="button"
              disabled={submitting}
              onClick={() => onSubmit(false)}
            >
              {submitting ? "sending" : step === questions.length - 1 ? "send feedback" : "continue"}
            </button>
          ) : null}
          <button className="sheet-link" type="button" disabled={submitting} onClick={() => onSubmit(true)}>
            skip this question
          </button>
        </>
      )}
    </section>
  );
}
