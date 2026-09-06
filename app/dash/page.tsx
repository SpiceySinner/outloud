"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OrbCanvas } from "@/app/components/OrbCanvas";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { autoStartKey, resumeMomentKey, type ResumeMoment } from "@/lib/account-links";
import {
  daysOverdue,
  dueMoments,
  focusFromMoments,
  journeyPosition,
  journeyStages,
  normalizeMastery,
  type DashboardData,
  type MomentCard,
} from "@/lib/dashboard-data";
import { mockDashboard } from "@/lib/dashboard-mock";

/**
 * /dash -- one screen, no scroll, the orb in the middle.
 *
 * The premise is that the fastest possible read of "what matters" should sit around the thing you
 * actually came to do, rather than above it. So the page is a fixed viewport: a bar with **one**
 * thing to pick up, the orb, and a foot that says where this is going. Nothing else fits, and that
 * is the constraint doing the work -- every candidate for this screen has to beat something
 * already on it.
 *
 * `/dashboard` stays the long version. This is the door.
 *
 * The orb here cannot listen: the mic, the WebRTC session and the whole voice state machine live
 * in the room. Tapping plays the collapse and hands off through sessionStorage, so the room opens
 * already in a session. One tap, then talk -- the same promise, without a second microphone
 * fighting the first one for the device.
 */

type LibrarySession = {
  id: string;
  createdAt: string;
  summary: string;
  naturalVersion: string | null;
  keyPhrase: string | null;
  keyPhraseMeaning: string | null;
  pattern: string | null;
  blocker: string | null;
  ledgerState: string | null;
  dueAt: string | null;
  rescue: unknown;
};

/** How long the collapse runs before the room takes over. Matches the CSS. */
const leaveMs = 420;

/**
 * While this screen is still being designed it renders the preview account by default, because
 * looking at the layout should not require an account and a month of practice behind it.
 * `?preview=0` shows the real one.
 *
 * **This is the only line to change when the page is finished.** It is a constant rather than a
 * check scattered through the component so that switching it on cannot be half-done, and the
 * badge in the corner is wired to the same value -- a screen showing invented practice must never
 * be able to look like it is showing yours.
 */
const previewByDefault = true;

export default function DashPage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [data, setData] = useState<DashboardData | null>(null);
  const [preview, setPreview] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(async () => {
    let wantsPreview = previewByDefault;
    try {
      const flag = new URLSearchParams(window.location.search).get("preview");
      if (flag === "1") wantsPreview = true;
      if (flag === "0") wantsPreview = false;
    } catch {
      // No URL to read: keep the default.
    }
    if (wantsPreview) {
      setPreview(true);
      setData(mockDashboard);
      setState("ready");
      return;
    }

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setState("signed-out");
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setState("signed-out");
      return;
    }

    try {
      const response = await fetch("/api/library", { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json();
      if (!response.ok) throw new Error("nope");
      const sessions = (json.sessions ?? []) as LibrarySession[];
      setData({
        user: json.user,
        words: json.words ?? [],
        moments: sessions.map(
          (session): MomentCard => ({ ...session, ledgerState: normalizeMastery(session.ledgerState) }),
        ),
        chat: [],
      });
      setState("ready");
    } catch {
      // A failed load must not strand someone on a dead screen: the orb is the point, and it
      // works without any of this.
      setState("signed-out");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const moments = useMemo(() => data?.moments ?? [], [data]);
  const words = data?.words ?? [];
  const focus = useMemo(() => focusFromMoments(moments), [moments]);
  const due = useMemo(() => dueMoments(moments), [moments]);
  const journey = useMemo(() => journeyPosition(moments), [moments]);

  /**
   * The one thing on the bar. Something overdue beats the last thing they did: an overdue moment
   * is the app keeping a promise it already made, and that is the only claim on this screen that
   * has a deadline attached.
   */
  const pickUp: MomentCard | null = due[0] ?? moments[0] ?? null;
  const pickUpIsDue = due.length > 0;
  const stage = journeyStages[journey.index];

  function leaveTo(write: () => void) {
    if (leaving) return;
    try {
      write();
    } catch {
      // Storage blocked: the room simply starts fresh, which is still the right screen.
    }
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      router.push("/");
      return;
    }
    setLeaving(true);
    window.setTimeout(() => router.push("/"), leaveMs);
  }

  /**
   * Stays real even while the page shows the preview account. Starting a fresh session carries
   * nothing invented across -- the room builds its own -- so gating this would kill the one
   * interaction actually worth testing here for no honesty gain.
   */
  function startTalking() {
    leaveTo(() => window.sessionStorage.setItem(autoStartKey, "1"));
  }

  function pickUpThis() {
    if (!pickUp) return;
    if (preview) {
      // This one is different: it hands a saved rescue to the room, and an invented one would put
      // practice that never happened into a real account. Collapse only, then come back.
      setLeaving(true);
      window.setTimeout(() => setLeaving(false), leaveMs + 400);
      return;
    }
    const payload: ResumeMoment = { momentId: pickUp.id, summary: pickUp.summary, rescue: pickUp.rescue };
    leaveTo(() => window.sessionStorage.setItem(resumeMomentKey, JSON.stringify(payload)));
  }

  return (
    <main className={leaving ? "dash-shell is-leaving" : "dash-shell"} aria-label="OutLoud">
      <header className="dash-chrome">
        <Link className="dash-chrome-link" href="/dashboard">
          everything
        </Link>
        {preview ? (
          <Link className="dash-preview" href="/dash?preview=0">
            preview
          </Link>
        ) : null}
        <Link className="dash-avatar" href="/profile" aria-label="profile">
          {(data?.user.email ?? "?").slice(0, 1).toUpperCase()}
        </Link>
      </header>

      {/* The bar: exactly one thing, never a list. A list here would be a lesson menu. */}
      <div className="dash-bar">
        {state === "ready" && pickUp ? (
          <button className="dash-pickup" type="button" onClick={pickUpThis}>
            <span className="dash-pickup-kicker">
              {pickUpIsDue
                ? pickUp.dueAt && daysOverdue(pickUp.dueAt) > 0
                  ? `waiting ${daysOverdue(pickUp.dueAt)} ${daysOverdue(pickUp.dueAt) === 1 ? "day" : "days"}`
                  : "ready today"
                : "last time"}
            </span>
            <span className="dash-pickup-line">{pickUp.keyPhrase ?? pickUp.naturalVersion ?? pickUp.summary}</span>
            <span className="dash-pickup-meaning">{pickUp.keyPhraseMeaning ?? pickUp.summary}</span>
            <span className="dash-pickup-go" aria-hidden="true">
              &rarr;
            </span>
          </button>
        ) : (
          <p className="dash-bar-empty">
            {state === "loading" ? "" : "nothing waiting yet — the first conversation makes this bar."}
          </p>
        )}
      </div>

      {/* The middle. Everything above and below is context for this. */}
      <div className="dash-stage">
        <button className="dash-orb-wrap" type="button" onClick={startTalking} aria-label="start talking">
          <OrbCanvas state={leaving ? "listening" : "idle"} className="dash-orb" size={440} />
        </button>
        <p className="dash-cue">{leaving ? "listening…" : "tap, then talk"}</p>
        {focus ? <p className="dash-focus">today: {focus.label}</p> : null}
      </div>

      {/* The foot: where this is going, in one line. The long version is behind "everything". */}
      <footer className="dash-foot">
        {state === "ready" ? (
          <>
            <p className="dash-stage-line">
              <span>{stage?.title ?? "introduce yourself"}</span>
              <span className="dash-stage-count">
                {journey.index + 1} of {journeyStages.length}
              </span>
            </p>
            <span className="dash-rail" aria-hidden="true">
              <span style={{ width: `${((journey.index + 1) / journeyStages.length) * 100}%` }} />
            </span>
            <p className="dash-meta">
              {words.length} kept · {due.length} waiting · {journey.unaided} said unaided
            </p>
          </>
        ) : (
          <p className="dash-meta">
            <Link href="/dash?preview=1">see it with a month of practice &rarr;</Link>
          </p>
        )}
      </footer>
    </main>
  );
}
