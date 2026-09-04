"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { formatSavedDate } from "@/lib/account-links";
import { blockerFocusLabels, normalizeObservedBlocker } from "@/lib/blocker-taxonomy";

type ProfileState = {
  email: string;
  provider: string;
  memberSince: string;
  words: number;
  sessions: number;
  lastSession: string | null;
  topBlocker: string | null;
  /** #50 -- the top dimension's share of the most recent sessions versus the ones before them. */
  trend: { label: string; recent: number; recentTotal: number; earlier: number; earlierTotal: number } | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setState("error");
      setMessage("accounts aren't configured yet.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      setState("signed-out");
      return;
    }

    try {
      const response = await fetch("/api/library", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(typeof json?.error === "string" ? json.error : "could not load your profile.");

      const sessions = (json.sessions ?? []) as Array<{ createdAt: string; blocker: string | null }>;
      const blockerCounts = new Map<string, number>();
      for (const item of sessions) {
        if (!item.blocker) continue;
        blockerCounts.set(item.blocker, (blockerCounts.get(item.blocker) ?? 0) + 1);
      }
      const topBlocker = [...blockerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      /**
       * #50 -- the dimension the learner named has to be visible *moving*, not just named. The
       * sessions come back newest first, so the first half is the recent window. Two windows
       * rather than a chart: with a handful of sessions a line is noise dressed as insight, and
       * "3 of your last 5, down from 4 of 5" is a claim a person can check against their memory.
       *
       * Needs at least four sessions. Below that there is no before and after, and comparing two
       * sessions to two sessions would turn one good day into a trend.
       */
      let trend: ProfileState["trend"] = null;
      if (topBlocker && sessions.length >= 4) {
        const half = Math.floor(sessions.length / 2);
        const recentWindow = sessions.slice(0, half);
        const earlierWindow = sessions.slice(half);
        const hits = (window: typeof sessions) =>
          window.filter((item) => item.blocker && normalizeObservedBlocker(item.blocker) === normalizeObservedBlocker(topBlocker)).length;
        trend = {
          label: blockerFocusLabels[normalizeObservedBlocker(topBlocker)],
          recent: hits(recentWindow),
          recentTotal: recentWindow.length,
          earlier: hits(earlierWindow),
          earlierTotal: earlierWindow.length,
        };
      }

      setProfile({
        email: session.user.email ?? "",
        provider: session.user.app_metadata?.provider ?? "email",
        memberSince: session.user.created_at ?? "",
        words: (json.words ?? []).length,
        sessions: sessions.length,
        lastSession: sessions[0]?.createdAt ?? null,
        topBlocker,
        trend,
      });
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "could not load your profile.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    // Deferred: load() can settle synchronously (missing config), and setting state inside the
    // effect body triggers a cascading render.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function signOut() {
    await getSupabaseBrowser()?.auth.signOut();
    router.push("/");
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <Link className="page-back" href="/dashboard">
          &larr; your outloud
        </Link>
        <p className="page-kicker">profile</p>
        <span className="page-header-spacer" aria-hidden="true" />
      </header>

      {state === "loading" ? <p className="page-note">loading…</p> : null}
      {state === "error" ? <p className="page-note is-error">{message}</p> : null}

      {state === "signed-out" ? (
        <section className="page-empty">
          <h1>no account yet.</h1>
          <p>finish a session and keep your words — that&apos;s where the account comes from.</p>
          <Link className="page-primary" href="/">
            start a session
          </Link>
        </section>
      ) : null}

      {state === "ready" && profile ? (
        <>
          <section className="profile-identity">
            <span className="profile-avatar" aria-hidden="true">
              {profile.email.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="profile-email">{profile.email}</p>
              <p className="profile-meta">
                signed in with {profile.provider}
                {profile.memberSince ? ` · since ${formatSavedDate(profile.memberSince)}` : ""}
              </p>
            </div>
          </section>

          <section className="page-stats" aria-label="Your numbers">
            <article>
              <strong>{profile.words}</strong>
              <span>words kept</span>
            </article>
            <article>
              <strong>{profile.sessions}</strong>
              <span>sessions</span>
            </article>
            <article>
              <strong>{profile.lastSession ? formatSavedDate(profile.lastSession) : "—"}</strong>
              <span>last one</span>
            </article>
          </section>

          <section className="page-section" aria-label="What OutLoud is working on">
            <h2>what we&apos;re working on</h2>
            <p className="page-body">
              {profile.topBlocker
                ? `${blockerFocusLabels[normalizeObservedBlocker(profile.topBlocker)]} — it showed up most across your sessions.`
                : "not enough sessions yet to call a pattern."}
            </p>
            {profile.trend ? (
              <p className="page-body">
                {(() => {
                  const { recent, recentTotal, earlier, earlierTotal } = profile.trend;
                  const before = `it was ${earlier} of ${earlierTotal} before that`;
                  const now = `${recent} of your last ${recentTotal} sessions`;
                  // Rates, not counts: the two windows differ in size when the session count is odd.
                  const falling = recent / recentTotal < earlier / earlierTotal;
                  const rising = recent / recentTotal > earlier / earlierTotal;
                  if (falling) return `${now} — ${before}. it is showing up less.`;
                  if (rising) return `${now} — ${before}. it is showing up more, not less.`;
                  return `${now} — ${before}. holding steady so far.`;
                })()}
              </p>
            ) : null}
          </section>

          <div className="profile-actions">
            <Link className="page-primary" href="/dashboard">
              your words
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
