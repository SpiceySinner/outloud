"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HomePanel from "@/app/components/HomePanel";
import { formatSavedDate, leftRoomKey, resumeMomentKey, type ResumeMoment } from "@/lib/account-links";
import { focusFromMoments, trendDirection, type MomentCard } from "@/lib/dashboard-data";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useLibraryData } from "@/lib/use-library-data";

/**
 * Your account, and everything OutLoud has of yours.
 *
 * `/dashboard` and `/profile` merged into this on 2026-09-11, and the merge is the point rather
 * than a tidy-up. `/dashboard`'s own header comment called it *"Home. What a learner lands on once
 * the funnel is behind them"* — which is the room's job now that the landing screen knows who is
 * looking. A second screen claiming to be home is how a learner ends up with two front doors and
 * no idea which one is theirs.
 *
 * So what is left here is the half neither screen was: **who you are, what you have done, and the
 * way out.** One primary action, at the bottom, pointing back at the room.
 *
 * Two things deliberately did NOT come across:
 *
 * - **The hero.** `/dashboard` opened with the focus label as a headline and "start talking"
 *   under it. The room's landing carries both now, against live data, so a second copy would be
 *   the same claim in two places with nothing keeping them honest.
 * - **The coach chat.** It had no engine, a disabled input saying so, and canned replies behind a
 *   preview flag. Timo's call in TODO 1.5. `lib/dashboard-mock.ts` still holds `mockChatReplies`
 *   and `ChatMessage` is still in `lib/dashboard-data.ts`, because #30 is a real plan and this is
 *   the shape it was drawn in — but an unbuilt feature does not get to sit on the account page
 *   pretending.
 *
 * The trend sentence below existed in both old files, in two different wordings, which is exactly
 * the fault `lib/dashboard-data.ts` warns about in its own header. There is one now. It is written
 * inline rather than moved into lib because there is one caller; the moment there are two, it
 * moves.
 */

type Identity = {
  /** "google", "email", and so on. Straight off the session — `/api/library` does not carry it. */
  provider: string;
  memberSince: string;
};

export default function AccountPage() {
  const router = useRouter();
  const { state, data, message, preview } = useLibraryData();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);

  const moments = useMemo(() => data?.moments ?? [], [data]);
  const focus = useMemo(() => focusFromMoments(moments), [moments]);

  /*
   * The two fields `/api/library` has no business returning: how you signed in, and when you
   * started. They live on the auth session, so they come from there rather than being added to a
   * route that every screen calls.
   */
  const loadIdentity = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return;
    setIdentity({
      provider: session.user.app_metadata?.provider ?? "email",
      memberSince: session.user.created_at ?? "",
    });
  }, []);

  useEffect(() => {
    // Deferred for the same reason `useLibraryData` defers its own load: this can settle
    // synchronously when Supabase is not configured, and setting state inside an effect body
    // triggers a cascading render.
    const timer = window.setTimeout(() => void loadIdentity(), 0);
    return () => window.clearTimeout(timer);
  }, [loadIdentity]);

  function continueSession(moment: MomentCard) {
    if (preview) {
      setPreviewNote("preview — this would drop you back into that conversation in the room.");
      return;
    }
    const payload: ResumeMoment = { momentId: moment.id, summary: moment.summary, rescue: moment.rescue };
    try {
      window.sessionStorage.setItem(resumeMomentKey, JSON.stringify(payload));
    } catch {
      // Storage blocked: the room simply starts fresh instead of resuming.
    }
    router.push("/");
  }

  async function signOut() {
    /*
     * The room may have written itself down on the way here, expecting to be picked back up. After
     * a sign-out it must not be: the practice is still on the device, but restoring it would put
     * one account's conversation in front of whoever is signed in next.
     */
    try {
      window.sessionStorage.removeItem(leftRoomKey);
    } catch {
      // Storage blocked, so nothing was written on the way in either.
    }
    await getSupabaseBrowser()?.auth.signOut();
    router.push("/");
  }

  const email = data?.user.email ?? "";

  return (
    <main className="page-shell">
      <header className="page-header">
        <Link className="page-back" href="/">
          &larr; room
        </Link>
        <p className="page-kicker">account</p>
        <span className="page-header-spacer" aria-hidden="true" />
      </header>

      {preview ? (
        <p className="preview-ribbon">
          <strong>preview</strong> — invented sessions, invented words, for looking at the design. nothing here
          is yours. <Link href="/account">show my real account</Link>
        </p>
      ) : null}

      {state === "loading" ? <p className="page-note">loading…</p> : null}
      {state === "error" ? <p className="page-note is-error">{message}</p> : null}

      {state === "signed-out" ? (
        <section className="page-empty">
          <h1>no account yet.</h1>
          <p>
            finish a session and keep your words — that&apos;s where the account comes from. nothing
            here asks you to sign up first.
          </p>
          <Link className="page-primary" href="/">
            start a session
          </Link>
          <Link className="page-secondary" href="/account?preview=1">
            see what it looks like full
          </Link>
        </section>
      ) : null}

      {state === "ready" && data ? (
        <>
          <section className="profile-identity">
            <span className="profile-avatar" aria-hidden="true">
              {email.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="profile-email">{email}</p>
              <p className="profile-meta">
                {identity ? `signed in with ${identity.provider}` : "signed in"}
                {identity?.memberSince ? ` · since ${formatSavedDate(identity.memberSince)}` : ""}
              </p>
            </div>
          </section>

          <section className="page-stats" aria-label="Your numbers">
            <article>
              <strong>{data.words.length}</strong>
              <span>words kept</span>
            </article>
            <article>
              <strong>{moments.length}</strong>
              <span>sessions</span>
            </article>
            <article>
              <strong>{moments[0] ? formatSavedDate(moments[0].createdAt) : "—"}</strong>
              <span>last one</span>
            </article>
          </section>

          <section className="page-section" aria-label="What OutLoud is working on">
            <h2>what we&apos;re working on</h2>
            <p className="page-body">
              {focus
                ? `${focus.label} — it showed up most across your sessions.`
                : "not enough sessions yet to call a pattern."}
            </p>
            {focus?.trend ? (
              <p className="page-body">
                {(() => {
                  const { recent, recentTotal, earlier, earlierTotal } = focus.trend;
                  const now = `${recent} of your last ${recentTotal} sessions`;
                  const before = `it was ${earlier} of ${earlierTotal} before that`;
                  const direction = trendDirection(focus.trend);
                  if (direction === "falling") return `${now} — ${before}. it is showing up less.`;
                  if (direction === "rising") return `${now} — ${before}. it is showing up more, not less.`;
                  return `${now} — ${before}. not enough of a change to call it either way.`;
                })()}
              </p>
            ) : null}
          </section>

          {/* The evidence, and the same component the room renders at the end of a session. */}
          <HomePanel variant="home" data={data} focusLabel={focus?.label ?? null} onContinue={continueSession} />

          {previewNote ? (
            <p className="page-note preview-note" role="status">
              {previewNote}
            </p>
          ) : null}

          <div className="profile-actions">
            <Link className="page-primary" href="/">
              start talking
            </Link>
            <button className="page-secondary" type="button" onClick={() => void signOut()}>
              sign out
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}
