"use client";

import { useCallback, useEffect, useState } from "react";
import { getClientSessionId } from "@/lib/client-session";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { normalizeMastery, type DashboardData, type MomentCard } from "@/lib/dashboard-data";
import { mockDashboard } from "@/lib/dashboard-mock";

/**
 * Everything a learner has done, loaded once, for whichever screen is showing it.
 *
 * Two screens read this -- the entry screen and the full dashboard -- and they used to do it with
 * two copies of the same forty lines. The copies had already begun to differ in what a failed load
 * meant, which is exactly the kind of drift that ends with one screen quietly showing nothing.
 *
 * The preview account is a fallback for somebody with nothing to show, never a default. Looking at
 * a screen built around a month of practice should not require a month of practice -- but a learner
 * who IS signed in has their own, and showing them an invented one instead is the worst version of
 * this screen: a month of somebody else's progress, wearing their account.
 *
 * So the order is: an explicit `?preview=1` wins, then the real session, and only a signed-out
 * visitor falls back to the invented one. `?preview=0` still refuses the fallback outright.
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

export type LibraryState = "loading" | "signed-out" | "ready" | "error";

export type LibraryData = {
  state: LibraryState;
  data: DashboardData | null;
  /** Set only alongside `state === "error"`. */
  message: string | null;
  /** True when what is on screen is invented. Nothing may act on invented practice. */
  preview: boolean;
};

export function useLibraryData(options: { previewByDefault?: boolean } = {}): LibraryData {
  const { previewByDefault = false } = options;
  const [state, setState] = useState<LibraryState>("loading");
  const [data, setData] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    const showPreview = () => {
      setPreview(true);
      setData(mockDashboard);
      setState("ready");
    };

    // `null` is "nobody said" -- which is not the same as "no", and conflating the two is what put
    // the invented account in front of signed-in learners.
    let forced: boolean | null = null;
    try {
      const flag = new URLSearchParams(window.location.search).get("preview");
      if (flag === "1") forced = true;
      if (flag === "0") forced = false;
    } catch {
      // No URL to read: nobody said.
    }

    // Asked for by name. The only route to the preview that does not first check who is asking,
    // because somebody typing `?preview=1` is looking at the layout on purpose.
    if (forced === true) {
      showPreview();
      return;
    }
    setPreview(false);

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setState("error");
      setMessage("accounts aren't configured yet.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      // Nothing of theirs to show. A screen calling itself the entry to your practice, empty, tells
      // a first-time visitor less than the same screen full of somebody's -- as long as it says so,
      // which the badge does. `?preview=0` is how you ask for the empty truth anyway.
      if (previewByDefault && forced !== false) {
        showPreview();
        return;
      }
      setState("signed-out");
      return;
    }

    try {
      // The session id travels so the route can claim what this browser practised anonymously.
      // Without it, a run saved with no email is never claimed by anyone, ever.
      const sessionId = getClientSessionId();
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      const response = await fetch(`/api/library${query}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(typeof json?.error === "string" ? json.error : "could not load your work.");
      const sessions = (json.sessions ?? []) as LibrarySession[];
      setData({
        user: json.user,
        words: json.words ?? [],
        moments: sessions.map(
          (session): MomentCard => ({ ...session, ledgerState: normalizeMastery(session.ledgerState) }),
        ),
        // No engine behind the home chat yet. An empty thread renders the honest version of the
        // section rather than a fabricated conversation.
        chat: [],
      });
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "could not load your work.");
      setState("error");
    }
  }, [previewByDefault]);

  useEffect(() => {
    // Deferred: load() can settle synchronously (missing config, or the preview), and setting
    // state inside the effect body triggers a cascading render.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return { state, data, message, preview };
}
