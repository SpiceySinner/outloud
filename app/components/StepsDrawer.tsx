"use client";

import { beatsDone, eventDayLabel } from "@/lib/event-plan";
import type { StoredEvent } from "@/lib/event-schema";

/**
 * Every go at the evening, in order, in a drawer that comes up from the bottom.
 *
 * Lifted out of `app/dash/page.tsx` on 2026-09-11, unchanged.
 *
 * **It is absolutely positioned, not fixed**, so it needs a positioned ancestor that caps its own
 * width and clips its overflow -- otherwise the slide-up starts from a guessed offset instead of
 * genuinely off-screen. `.dash-shell` is that ancestor today; `.room` happens to be the same box
 * (`position: relative`, `min(100vw, 430px)`, `overflow: hidden`), which is what makes rendering
 * this inside the room possible at all. Render it as a child of that element, never nested deeper.
 */
export default function StepsDrawer({
  event,
  eventDay,
  nextBeatIndex,
  todayIso,
  disabled,
  onStartBeat,
  onClose,
}: {
  event: StoredEvent;
  /** "friday", "tomorrow", and so on. Null when the event has no date yet. */
  eventDay: string | null;
  /** Which go is the next one, so it can be marked. Null when they are all done. */
  nextBeatIndex: number | null;
  todayIso: string;
  disabled: boolean;
  onStartBeat: (beatIndex: number) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button className="dash-steps-scrim" type="button" aria-label="close the list of goes" onClick={onClose} />
      <div
        className="dash-steps"
        id="dash-steps"
        role="dialog"
        aria-modal="true"
        aria-label={`${event.nameEn}: every go`}
      >
        <span className="dash-steps-grip" aria-hidden="true" />
        <p className="dash-steps-title">{event.nameEn}</p>
        <p className="dash-steps-sub">
          {eventDay ?? "no date yet"}
          {` · ${beatsDone(event.beats)} of ${event.beats.length} done`}
        </p>
        <ol className="dash-steps-list">
          {event.beats.map((beat) => {
            const done = Boolean(beat.completedAt);
            const isNext = !done && beat.index === nextBeatIndex;
            const when = beat.dueOn ? eventDayLabel(beat.dueOn, todayIso) : null;
            return (
              <li key={beat.index}>
                <button
                  className={`dash-step${done ? " is-done" : ""}${isNext ? " is-next" : ""}`}
                  type="button"
                  onClick={() => onStartBeat(beat.index)}
                  disabled={disabled}
                >
                  <span className="dash-step-n" aria-hidden="true">
                    {done ? "✓" : beat.index + 1}
                  </span>
                  <span className="dash-step-body">
                    <span className="dash-step-title">{beat.titleEn}</span>
                    <span className="dash-step-meta">
                      {`with ${beat.characterName}`}
                      {when ? ` · ${when}` : ""}
                    </span>
                  </span>
                  {/*
                   * A finished go says "again" rather than going quiet. #38 in the master
                   * plan: deciding somebody is done before they do is a small betrayal in an
                   * app about persistence.
                   */}
                  <span className="dash-step-do" aria-hidden="true">
                    {done ? "again" : isNext ? "start" : "go"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <button className="dash-steps-close" type="button" onClick={onClose}>
          close
        </button>
      </div>
    </>
  );
}
