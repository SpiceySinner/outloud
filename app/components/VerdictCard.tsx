"use client";

import Link from "next/link";
import type { RescueResponse } from "@/lib/types";

/**
 * The card at the end of the intake: what OutLoud heard, what it hands over, and the one ask.
 *
 * Lifted out of `app/page.tsx` on 2026-09-11 as the first of thirteen sheets, unchanged. It is the
 * highest-stakes screen in the app and it earns its own file for two reasons: it is where the
 * diagnosis is delivered, and it is the only place the account is asked for. Master-plan **#18**,
 * as Timo restated it, puts that ask after a win rather than in front of a paywall — so everything
 * above the ask is the argument for it, made out of the learner's own sentences.
 *
 * **Presentational, and strictly so.** Every value below is decided by the room and handed down
 * finished. Nothing is recomputed here — not the loot list, not which attempt counts as "before",
 * not how many runs are unclaimed. That is the rule from `lib/dashboard-data.ts`: the same claim
 * about a learner, computed in two places, is how an app ends up telling somebody two different
 * things about themselves.
 */
export default function VerdictCard({
  rescue,
  authedEmail,
  momentBefore,
  momentAfter,
  lootItems,
  unclaimedRuns,
  returnEmail,
  returnEmailStatus,
  emailFallbackOpen,
  setReturnEmail,
  setReturnEmailStatus,
  setEmailFallbackOpen,
  onSaveWords,
  onSignOut,
  onCreateAccount,
  onStart,
}: {
  rescue: RescueResponse | null;
  /** Null when signed out, which swaps the whole bottom half of the card. */
  authedEmail: string | null;
  /**
   * The two sentences the contrast is made of. Typed by what is actually read rather than as
   * `PlacementAttempt`, which lives in `app/page.tsx` — importing it back would make the room and
   * its own sheet depend on each other.
   */
  momentBefore: { userAttempt: string } | null;
  momentAfter: { userAttempt: string } | null;
  /** What they reached for, already deduped and capped by the room. */
  lootItems: Array<{ es: string; en: string | null }>;
  /** Runs saved on this device that no account has claimed. Null until it is known. */
  unclaimedRuns: number | null;
  returnEmail: string;
  returnEmailStatus: "idle" | "saving" | "saved" | "error";
  emailFallbackOpen: boolean;
  setReturnEmail: (value: string) => void;
  setReturnEmailStatus: (value: "idle" | "saving" | "saved" | "error") => void;
  /** The setter itself, not a toggle: the card calls it with a function. */
  setEmailFallbackOpen: (update: (current: boolean) => boolean) => void;
  onSaveWords: (emailOverride?: string) => void;
  onSignOut: () => void;
  onCreateAccount: () => void;
  onStart: () => void;
}) {
  return (
    <section className="room-sheet verdict-card" aria-label="Verdict">
      <p className="verdict-kicker">what OutLoud heard</p>
      {/*
        This used to be the sentence above, hardcoded -- the same claim for every
        learner, printed where a diagnosis belongs. It is now the model's read of what
        they said trips them up against what actually happened (#46). The old string
        survives only as the fallback for moments saved before the field existed.
      */}
      <h2>
        {rescue?.stated_vs_observed?.line_en ||
          "you have enough Spanish. the gap is getting it out fast enough."}
      </h2>
      {/*
        Telling someone their own read was wrong is the highest-stakes sentence in the
        app, so it never stands alone: when the verdict contradicts or complicates what
        they said, the evidence for it is shown right underneath.
      */}
      {(rescue?.stated_vs_observed?.result === "correct" || rescue?.stated_vs_observed?.result === "both") &&
      rescue.observed_blocker.evidence ? (
        <p className="verdict-evidence">{rescue.observed_blocker.evidence}</p>
      ) : null}
      {momentAfter ? (
        <div className="verdict-moment">
          <span>your moment</span>
          {momentBefore && momentBefore.userAttempt !== momentAfter.userAttempt ? (
            <p className="moment-before">&ldquo;{momentBefore.userAttempt}&rdquo;</p>
          ) : null}
          <p className="moment-after">&ldquo;{momentAfter.userAttempt}&rdquo;</p>
          <small>
            {momentBefore && momentBefore.userAttempt !== momentAfter.userAttempt
              ? "same session, a few replies apart."
              : "you said this today — out loud."}
          </small>
        </div>
      ) : null}
      {lootItems.length ? (
        <div className="verdict-loot">
          <span>what you reached for</span>
          <ul>
            {lootItems.map((item) => (
              <li key={item.es}>
                <strong>{item.es}</strong>
                {item.en ? <small>{item.en}</small> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="verdict-plan">
        <span>next time</span>
        <p>same words, new situation — let&apos;s see if they come out on their own.</p>
      </div>
      <div className="verdict-account">
        {authedEmail ? (
          <>
            <p className="capture-sub">signed in as {authedEmail}.</p>
            <button
              className="account-button"
              type="button"
              disabled={returnEmailStatus === "saving"}
              onClick={() => {
                setReturnEmail(authedEmail);
                onSaveWords(authedEmail);
              }}
            >
              {returnEmailStatus === "saved"
                ? "words saved — see you tomorrow"
                : returnEmailStatus === "saving"
                  ? "saving"
                  : "save today's words"}
            </button>
            {returnEmailStatus === "saved" ? (
              <Link className="quiet-link" href="/account">
                see all your words &rarr;
              </Link>
            ) : null}
            <button className="quiet-link" type="button" onClick={onSignOut}>
              sign out
            </button>
          </>
        ) : (
          <>
            {/*
              This used to say the words "disappear when you close this", which is both an
              understatement and the wrong problem. The run IS saved -- with whatever email
              is given and `user_id: null` -- but reading anything back goes through
              `getAuthedUser`, so without an account OutLoud greets a returning learner as a
              stranger while their practice sits in the database. Someone hit exactly that.
              So the card now says what an account does, why the line is drawn at a login,
              and that signing up on the same address claims what is already there (which
              /api/library really does, on first load).
            */}
            {/*
              #32, and the half of it that took longest to be true. The ask used to
              promise a future the learner had no way to check. It points at what is
              already sitting in this browser instead, which is only honest because
              `/api/library` now claims on session id as well as email -- before that,
              these runs came with nobody. Under two there is nothing worth pointing
              at, so it says the other thing.
            */}
            <p className="capture-sub">
              {unclaimedRuns && unclaimedRuns > 1
                ? `${unclaimedRuns} sessions are saved on this device and nothing is holding on to them. an account is what keeps them — and what lets OutLoud remember what trips you up.`
                : "nothing here comes back on its own. an account is what lets OutLoud remember you — what trips you up, every session, all of it."}
            </p>
            <button className="account-button" type="button" onClick={onCreateAccount}>
              create a free account
            </button>
            <p className="capture-fineprint">
              your practice is tied to a login, not to a typed-in address — otherwise anyone
              who guessed your email could read it. signing up on this device brings
              everything you already practised with you, whether or not you ever gave us
              an address.
            </p>
            <button
              className="quiet-link"
              type="button"
              onClick={() => setEmailFallbackOpen((current) => !current)}
            >
              or just email me a link to this one
            </button>
            {emailFallbackOpen ? (
              <div className="email-capture verdict-capture">
                <div>
                  <input
                    id="verdict-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    aria-label="email for your words"
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
                    onClick={() => onSaveWords()}
                  >
                    {returnEmailStatus === "saving" ? "saving" : "save them"}
                  </button>
                </div>
                {returnEmailStatus === "saved" ? (
                  <small>sent. that link opens this session only — it won&apos;t know you next time.</small>
                ) : null}
                {returnEmailStatus === "error" ? <small>couldn&apos;t save yet. try once more.</small> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <button className="sheet-primary" type="button" onClick={onStart}>
        start the conversation
      </button>
    </section>
  );
}
