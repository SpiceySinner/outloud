"use client";

import Link from "next/link";
import { daysOverdue, type MomentCard } from "@/lib/dashboard-data";
import { beatsDone, eventDayLabel } from "@/lib/event-plan";
import type { EventBeat, StoredEvent } from "@/lib/event-schema";

/**
 * Exactly one thing to pick up next, in thumb reach, and the way to your account beside it.
 *
 * Lifted out of `app/dash/page.tsx` on 2026-09-11, unchanged, so that the room can render it too.
 * Nothing is derived in here that is not already a pure helper in `lib/` -- `beatsDone`,
 * `eventDayLabel` and `daysOverdue` are the same functions the page called, called from one level
 * lower. The ORDER of the branches is the design and is the thing to be careful with:
 *
 *   1. the closed question about an evening that has been and gone
 *   2. the next go at an event  -- a date we did not invent
 *   3. a saved phrase that is due -- a schedule we did
 *   4. the intake offer -- the band is never allowed to be empty of a way forward
 *
 * An event outranks a due phrase for the same reason its header does: friday cannot move and
 * spaced retrieval can.
 */
export default function PickUpCard({
  event,
  nextBeat,
  readyBeat,
  stepsOpen,
  moment,
  momentIsDue,
  libraryReady,
  askOutcome,
  todayIso,
  accountEmail,
  accountHref,
  disabled,
  onAnswerSpoke,
  onStartBeat,
  onOpenSteps,
  onPickUp,
  onStartTalking,
}: {
  /** The event whose next go is on offer, if one is planned and unfinished. */
  event: StoredEvent | null;
  /** The go the card points at. Null when the event has none left. */
  nextBeat: EventBeat | null;
  /** True when that go is due today or already overdue, which drops the date from the kicker. */
  readyBeat: boolean;
  /** Whether this event's drawer is the open one. Drives `aria-expanded` only. */
  stepsOpen: boolean;
  /** The saved moment offered when no event outranks it. */
  moment: MomentCard | null;
  /** True when that moment is genuinely due, rather than merely the most recent one. */
  momentIsDue: boolean;
  /** False while the library is still settling. The moment card waits rather than flashing. */
  libraryReady: boolean;
  /** The one closed question left after an evening happened. Outranks everything. */
  askOutcome: boolean;
  todayIso: string;
  /** The signed-in address, for the initial on the disc. Null falls back to the glyph. */
  accountEmail: string | null;
  /**
   * Where the disc goes, or null to leave it out.
   *
   * The room already carries an account pill in its own chrome, one layer above this, so a
   * disc here would be the second way to the same place on the same screen.
   */
  accountHref: string | null;
  /** Everything goes inert while the screen is leaving. */
  disabled: boolean;
  onAnswerSpoke: (spoke: boolean) => void;
  onStartBeat: (beatIndex: number) => void;
  onOpenSteps: () => void;
  onPickUp: () => void;
  onStartTalking: () => void;
}) {
  return (
    /*
     * One row, shared. The card is the thing to do next; the disc is the way to your account.
     * They belong on the same line because the account is not a fifth thing to do -- it is
     * the edge of the screen, and putting it in the tray below made it compete with
     * "everything" for the same job.
     */
    <div className="dash-card-row">
      {askOutcome ? (
        /*
         * One closed question, answered with a tap. The mastery ladder's top rung says "you
         * used it for real", and this is the only thing in the app that can honestly put
         * somebody there -- so it must not be inferred from the sentence above it. Turning up
         * and freezing is not mastery, and a model reading "it was fine" would call it one.
         */
        <div className="dash-answers" role="group" aria-label="did you get to say any of it?">
          <p className="dash-answers-q">did you get to say any of it?</p>
          <div className="dash-answers-row">
            <button className="dash-answer" type="button" onClick={() => onAnswerSpoke(true)} disabled={disabled}>
              some of it, yes
            </button>
            <button className="dash-answer" type="button" onClick={() => onAnswerSpoke(false)} disabled={disabled}>
              not really
            </button>
          </div>
        </div>
      ) : event && nextBeat ? (
        // The event card outranks the saved-moment card for the same reason its header does:
        // one has a date attached and the other has a schedule we invented.
        <div className="dash-card-slot">
          <button
            className="dash-pickup is-event has-steps"
            type="button"
            onClick={() => onStartBeat(nextBeat.index)}
            disabled={disabled}
          >
            <span className="dash-pickup-kicker">
              {`go ${beatsDone(event.beats) + 1} of ${event.beats.length}`}
              {readyBeat ? "" : nextBeat.dueOn ? ` · ${eventDayLabel(nextBeat.dueOn, todayIso) ?? "soon"}` : ""}
            </span>
            <span className="dash-pickup-line">{nextBeat.titleEn}</span>
            <span className="dash-pickup-meaning">
              {`with ${nextBeat.characterName} — ${nextBeat.characterRelation}`}
            </span>
          </button>
          {/*
           * A sibling of the card, never a child: a button inside a button is invalid and iOS
           * resolves it by ignoring one of them at random.
           *
           * It replaces the card's arrow rather than joining it. The arrow was decoration
           * (aria-hidden) saying "this does something"; a chevron pointing at where the drawer
           * will appear says WHAT it does, which is worth more than a second glyph fighting for
           * 40 pixels next to it.
           */}
          <button
            className="dash-steps-open"
            type="button"
            onClick={onOpenSteps}
            disabled={disabled}
            aria-expanded={stepsOpen}
            aria-controls="dash-steps"
            aria-label={`see all ${event.beats.length} goes`}
          >
            {/* Three lines, the last one short: a list. Drawn rather than typed because the
                arrowhead glyph this started as has no font coverage and fell back to a caret. */}
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path
                d="M2.5 4h10M2.5 7.5h10M2.5 11h6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ) : libraryReady && moment ? (
        <button className="dash-pickup" type="button" onClick={onPickUp} disabled={disabled}>
          <span className="dash-pickup-kicker">
            {momentIsDue
              ? moment.dueAt && daysOverdue(moment.dueAt) > 0
                ? `waiting ${daysOverdue(moment.dueAt)} ${daysOverdue(moment.dueAt) === 1 ? "day" : "days"}`
                : "ready today"
              : "last time"}
          </span>
          <span className="dash-pickup-line">{moment.keyPhrase ?? moment.naturalVersion ?? moment.summary}</span>
          <span className="dash-pickup-meaning">{moment.keyPhraseMeaning ?? moment.summary}</span>
          <span className="dash-pickup-go" aria-hidden="true">
            &rarr;
          </span>
        </button>
      ) : (
        // Nothing is waiting -- a new learner, or one whose microphone we cannot reach. The
        // bottom band is never allowed to be empty of a way forward, so the intake goes here:
        // offered by name and chosen, never slipped into behind their back.
        <button className="dash-pickup is-offer" type="button" onClick={onStartTalking} disabled={disabled}>
          <span className="dash-pickup-kicker">the version that works</span>
          <span className="dash-pickup-line">start from a time the words didn&apos;t come</span>
          <span className="dash-pickup-go" aria-hidden="true">
            &rarr;
          </span>
        </button>
      )}
      {/* The pill is the target; the disc inside it is the identity. An initial floating in a
          rectangle reads as a letter -- put it on a disc and it reads as a person. */}
      {accountHref ? (
      <Link className="dash-account" href={accountHref} aria-label="your account">
        <span className="dash-account-disc" aria-hidden="true">
          {accountEmail ? (
            accountEmail.slice(0, 1).toUpperCase()
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5.6" r="2.8" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M2.9 13.6c0-2.5 2.3-4.2 5.1-4.2s5.1 1.7 5.1 4.2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>
      </Link>
      ) : null}
    </div>
  );
}

/**
 * What we are working on, named every time.
 *
 * #47. A different job from the header above the orb: that one says what to SAY, this says what
 * the practice is about. They must not be merged -- the screen tried it once and the result read
 * as two instructions competing for the same moment.
 */
export function FocusLine({ label }: { label: string }) {
  return <p className="dash-focus">today: {label}</p>;
}
