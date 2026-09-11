"use client";

import HomePanel, { JourneyPath, type ClosingRead } from "./HomePanel";
import type { DashboardData } from "@/lib/dashboard-data";

/**
 * The closing card, and the journey sheet behind it.
 *
 * Lifted out of `app/page.tsx` on 2026-09-11, unchanged. The two live in one file because they are
 * built out of the same two things — `closingData` and `sessionFocusLine` — and the journey sheet
 * is six lines that would otherwise be a file of its own.
 *
 * The card's job is the contrast. It leads with the Spanish sentence the learner left with and, when
 * there are genuinely two different things to compare, puts the sentence they arrived with directly
 * above it. Both halves are their own words, which is what makes this the one argument for an
 * account that cannot be read as marketing.
 *
 * **There is no account ask here, and that is deliberate.** It used to be repeated, gated on being
 * signed out exactly like the one on the verdict — so it could only ever appear to somebody who had
 * just been asked and said no. One ask, at the verdict, where the rescue and the diagnosis are still
 * on screen to justify it.
 */
export default function AfterCard({
  openingAnswer,
  todayLine,
  data,
  closing,
  focusLabel,
  saveStatus,
  hasReturnLink,
  returnEmail,
  returnEmailStatus,
  setReturnEmail,
  setReturnEmailStatus,
  onSendLink,
  onReviewTranscript,
  onWhatWeKnow,
  onKeepGoing,
  onDone,
}: {
  /** The sentence they came in with. Trimmed by this component, as the room did before it. */
  openingAnswer: string;
  /** The sentence they left with. Empty falls back to a line about getting started. */
  todayLine: string;
  data: DashboardData;
  closing: ClosingRead;
  focusLabel?: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** Whether the saved run really got a private return link, which changes what "saved" means. */
  hasReturnLink: boolean;
  returnEmail: string;
  returnEmailStatus: "idle" | "saving" | "saved" | "error";
  setReturnEmail: (value: string) => void;
  setReturnEmailStatus: (value: "idle" | "saving" | "saved" | "error") => void;
  onSendLink: () => void;
  onReviewTranscript: () => void;
  onWhatWeKnow: () => void;
  onKeepGoing: () => void;
  onDone: () => void;
}) {
  return (
    <section className="room-sheet after-card" aria-label="After session">
      {/*
        The change, not just the result.

        The card led with the learner's Spanish sentence -- right instinct, and it is
        still the headline. What it never did was put it next to the sentence they
        arrived with, so the strongest thing on the screen was reported underneath as
        "you got at least one real reply across clearly": a participation note for
        somebody who had just said fourteen words of Spanish after opening with "the
        words disappear".

        Both halves are their own words, which is what makes this the one argument for
        an account that cannot be read as marketing. Shown only when there really are
        two different things to compare.
      */}
      {openingAnswer.trim() && todayLine && openingAnswer.trim() !== todayLine ? (
        <div className="then-now">
          <p className="verdict-kicker">you came in saying</p>
          <p className="then-line">{openingAnswer.trim()}</p>
        </div>
      ) : null}
      <p className="verdict-kicker">{openingAnswer.trim() && todayLine ? "you left saying" : "today's line"}</p>
      <h2>{todayLine || "you got the conversation started."}</h2>
      <HomePanel variant="session-end" data={data} closing={closing} focusLabel={focusLabel} />
      <p className="sheet-note sage-note">
        if it comes up with someone tonight, try just this line.
      </p>
      {saveStatus !== "idle" ? (
        <p className="tiny-note">
          {saveStatus === "saving"
            ? "saving this run."
            : saveStatus === "saved"
              ? hasReturnLink
                ? "saved with a private return link."
                : "saved."
              : "could not save this run yet."}
        </p>
      ) : null}
      <div className="email-capture">
        {/*
          Was "want me to bring this back tomorrow?" -- a promise an email alone cannot
          keep. It buys a private token link to this one session; being remembered is a
          different thing and needs an account.
        */}
        <label htmlFor="return-email">email me a link back to this session</label>
        <div>
          <input
            id="return-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={returnEmail}
            onChange={(event) => {
              setReturnEmail(event.target.value);
              setReturnEmailStatus("idle");
            }}
          />
          <button
            type="button"
            disabled={!returnEmail.trim() || returnEmailStatus === "saving"}
            onClick={onSendLink}
          >
            {returnEmailStatus === "saving" ? "sending" : "send it"}
          </button>
        </div>
        {returnEmailStatus === "saved" ? <small>sent — that link opens this session.</small> : null}
        {returnEmailStatus === "error" ? <small>couldn&apos;t save yet. try once more.</small> : null}
      </div>
      {/*
        The account ask used to be repeated here.

        It was gated on `authedEmail` being null, exactly like the one on the
        verdict -- which meant it could only ever appear to somebody who had just
        been asked and said no. Asking a second time is what every other app does
        and what this one bans elsewhere: no streaks, no praise for silence, no
        nagging. One ask, at the verdict, where the rescue and the diagnosis are
        still on screen to justify it.

        If the numbers ever say people leave before the verdict converts, this is
        where it comes back -- but that is a question for real instrumentation
        (docs/TODO.md 1.2), not for a guess.
      */}
      <div className="sheet-split-actions">
        <button type="button" onClick={onReviewTranscript}>
          review transcript
        </button>
        <button type="button" onClick={onKeepGoing}>
          keep going
        </button>
      </div>
      {/*
        The only way into "what OutLoud knows about you". That card and the evidence
        card behind it opened each other and nothing else opened either -- a closed loop
        with no door, so the surface that is supposed to prove the app remembers your
        problem (#50) could not be reached at all. The end of a session is the right
        door: it is the moment the learner is already looking at what just happened.
      */}
      <button className="sheet-link sage-link" type="button" onClick={onWhatWeKnow}>
        what OutLoud knows about you
      </button>
      <button className="sheet-primary" type="button" onClick={onDone}>
        done
      </button>
    </section>
  );
}

/**
 * The speaking journey, on its own.
 *
 * Reached only from the profile sheet, and a dead end once opened — there is no button in it that
 * changes `overlay`, so the sheet handle is the only way out. Worth knowing before adding one.
 */
export function JourneySheet({
  data,
  focusLabel,
}: {
  data: DashboardData;
  focusLabel?: string | null;
}) {
  return (
    <section className="room-sheet" aria-label="Speaking journey">
      <h2>your speaking journey</h2>
      <JourneyPath moments={data.moments} focusLabel={focusLabel} />
    </section>
  );
}
