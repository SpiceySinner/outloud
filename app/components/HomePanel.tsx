"use client";

import { useState } from "react";
import { formatSavedDate } from "@/lib/account-links";
import {
  daysOverdue,
  dueMoments,
  journeyPosition,
  journeyStages,
  masteryLabels,
  masteryRank,
  wordState,
  type DashboardData,
  type MomentCard,
} from "@/lib/dashboard-data";

/**
 * The one surface that says what OutLoud gives back, rendered in two places.
 *
 * It used to be five: the closing card, "what OutLoud knows about you", the evidence card, a
 * five-row session checklist calling itself the speaking journey, and the dashboard page. Four of
 * those lived in the room and mostly opened each other; the good one was behind a login a stranger
 * will never do. So the only learner who ever saw the memory this product is built on was one who
 * had already signed up and come back -- and the wedge (memory proven, not claimed) was invisible
 * to exactly the people it has to convince.
 *
 * Now: same component, same `DashboardData`, two variants. At the end of a session the room builds
 * the data from what it already holds -- no request, no account, no waiting until day three.
 *
 * **Ordering is load-bearing.** Open things first, finished things underneath. A dashboard is a
 * summary by nature, and a summary at the end of a session reads as "done" -- which would quietly
 * kill the one retention mechanic this product has ("endings, never conclusions"). So the first
 * thing on screen is always what is still unfinished and when it comes back.
 *
 * The page or the room owns its own headline and its own primary action. This owns the middle.
 */

export type ClosingRead = {
  /** What changed today. One sentence, already derived by the room. */
  delta: string;
  /** The thing that nearly landed -- named, so tomorrow has a subject. */
  almostThere: string;
  /** Weekday this comes back, from the moment's real review date. */
  comesBackOn: string;
};

export default function HomePanel({
  variant,
  data,
  closing,
  focusLabel,
  onContinue,
}: {
  variant: "session-end" | "home";
  data: DashboardData;
  /** Session-end only: the room's read of what just happened. */
  closing?: ClosingRead | null;
  /** The dimension being worked on, in plain language, shown against the stage they stand on. */
  focusLabel?: string | null;
  onContinue?: (moment: MomentCard) => void;
}) {
  const moments = data.moments;
  const words = data.words;
  const due = dueMoments(moments);
  const [wordFilter, setWordFilter] = useState<"all" | "new" | "used">("all");
  const filteredWords = words.filter((word) => wordFilter === "all" || wordState(word) === wordFilter);

  return (
    <div className="home-panel">
      {/*
        1 -- what is still open. At the end of a session this is a promise with a date on it, not a
        queue with a button: the one thing just practised is not due yet, and handing someone a
        to-do list the moment they finish is how a session becomes a chore.
      */}
      {variant === "session-end" && closing ? (
        <div className="after-stack">
          <article>
            <span>changed today</span>
            <p>{closing.delta}</p>
          </article>
          <article>
            <span>almost there</span>
            <p>{closing.almostThere}</p>
          </article>
          <article className="return-hook">
            <span>{closing.comesBackOn}</span>
            <p>we&apos;ll bring this back in a new situation, with a little less help.</p>
          </article>
        </div>
      ) : null}

      {variant === "home" ? (
        <section className="page-section" id="review" aria-label="Due for another go">
          <h2>another go</h2>
          {due.length ? (
            <>
              <p className="page-body home-section-note">
                spaced out on purpose — these are the ones far enough back that saying them again
                actually proves something.
              </p>
              <ul className="review-list">
                {due.map((moment) => (
                  <li key={moment.id}>
                    <div className="review-body">
                      <p className="review-summary">{moment.summary}</p>
                      {moment.keyPhrase ? (
                        <p className="review-phrase">
                          <strong>{moment.keyPhrase}</strong>
                          {moment.keyPhraseMeaning ? <span> — {moment.keyPhraseMeaning}</span> : null}
                        </p>
                      ) : null}
                      <MasteryLadder state={moment.ledgerState} />
                      <p className="review-meta">
                        {moment.dueAt && daysOverdue(moment.dueAt) > 0
                          ? `due ${daysOverdue(moment.dueAt)} ${daysOverdue(moment.dueAt) === 1 ? "day" : "days"} ago`
                          : "due today"}
                      </p>
                    </div>
                    <button type="button" onClick={() => onContinue?.(moment)}>
                      say it again
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="page-body">
              nothing due. things come back here a few days after you first got them — long enough
              that saying it again means you actually kept it.
            </p>
          )}
        </section>
      ) : null}

      {/* 2 -- the path. Visibly long on purpose: it turns a bad session into one step. */}
      <section className="page-section" aria-label="The speaking journey">
        <h2>where this goes</h2>
        <JourneyPath moments={moments} focusLabel={focusLabel} />
      </section>

      {/* 3 -- what they are taking with them. */}
      <section className="page-section" aria-label="Your words">
        <h2>your words</h2>
        {words.length ? (
          <>
            {/* One session hands over two or three phrases; a filter over three chips is noise. */}
            {variant === "home" && words.length > 6 ? (
              <div className="word-filter" role="group" aria-label="filter words">
                {(["all", "new", "used"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={wordFilter === key ? "is-picked" : ""}
                    onClick={() => setWordFilter(key)}
                  >
                    {key === "all"
                      ? `all ${words.length}`
                      : key === "new"
                        ? `not used yet ${words.filter((word) => wordState(word) === "new").length}`
                        : `used again ${words.filter((word) => wordState(word) === "used").length}`}
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="word-grid">
              {filteredWords.map((word) => (
                <li key={word.id} className={wordState(word) === "used" ? "is-used" : ""}>
                  <strong>{word.spanish}</strong>
                  {word.meaning_en ? <small>{word.meaning_en}</small> : null}
                  <span className="word-meta">
                    {word.times_practiced > 0 ? `used ${word.times_practiced}×` : formatSavedDate(word.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="page-note">nothing kept yet — a session hands you the phrase it built with you.</p>
        )}
      </section>

      {/*
        4 -- the history. Never at the end of session one: a list with a single row in it is not a
        history, it is a claim that there is one.
      */}
      {variant === "home" && moments.length > 1 ? (
        <section className="page-section" aria-label="Your sessions">
          <h2>everything so far</h2>
          <ul className="session-list">
            {moments.map((moment) => (
              <li key={moment.id}>
                <div>
                  <p className="session-summary">{moment.summary}</p>
                  {moment.naturalVersion ? <p className="session-line">{moment.naturalVersion}</p> : null}
                  <p className="session-meta">
                    {formatSavedDate(moment.createdAt)} · {masteryLabels[moment.ledgerState]}
                  </p>
                </div>
                <button type="button" onClick={() => onContinue?.(moment)}>
                  continue &rarr;
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * #51-54. Capabilities, not topics, and tapping one explains it rather than launching anything.
 *
 * This replaces a five-row checklist in the room that was also called "your speaking journey" and
 * was a different thing entirely -- "answer the coach's first question", "retry after a hint" --
 * of which three rows were always already ticked by the time anyone could see it. Two lists with
 * one name, and the one that told you where you were going was the one nobody could reach.
 */
export function JourneyPath({ moments, focusLabel }: { moments: MomentCard[]; focusLabel?: string | null }) {
  const journey = journeyPosition(moments);
  const [openStage, setOpenStage] = useState<string | null>(null);

  return (
    <>
      <p className="page-body home-section-note">
        you move because something got beaten, not because you turned up. {journey.unaided}{" "}
        {journey.unaided === 1 ? "sentence" : "sentences"} said with nothing on the screen so far.
      </p>
      <ol className="journey">
        {journeyStages.map((stage, index) => {
          const status = index < journey.index ? "done" : index === journey.index ? "current" : "ahead";
          const crossed = journey.crossedAt[stage.key];
          return (
            <li key={stage.key} className={`journey-stage is-${status}`}>
              <button
                type="button"
                aria-expanded={openStage === stage.key}
                onClick={() => setOpenStage(openStage === stage.key ? null : stage.key)}
              >
                <span className="journey-dot" aria-hidden="true" />
                <span className="journey-title">{stage.title}</span>
                <span className="journey-meta">
                  {status === "done" && crossed
                    ? formatSavedDate(crossed)
                    : status === "current"
                      ? (focusLabel ?? "here")
                      : ""}
                </span>
              </button>
              {openStage === stage.key ? <p className="journey-meaning">{stage.meaning}</p> : null}
              {status === "current" && journey.toNext > 0 ? (
                <p className="journey-meaning is-progress">
                  {journey.toNext} more unaided {journey.toNext === 1 ? "sentence" : "sentences"} and this one is
                  behind you.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** The ledger as five steps, so a saved practice shows how far it has actually come. */
export function MasteryLadder({ state }: { state: MomentCard["ledgerState"] }) {
  const reached = masteryRank[state];
  return (
    <p className="mastery">
      <span className="mastery-dots" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((step) => (
          <span key={step} className={step <= reached ? "is-reached" : ""} />
        ))}
      </span>
      <span className="mastery-label">{masteryLabels[state]}</span>
    </p>
  );
}
