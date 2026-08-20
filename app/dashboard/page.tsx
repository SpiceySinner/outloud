"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { formatSavedDate, resumeMomentKey, type ResumeMoment } from "@/lib/account-links";

type WordRow = {
  id: string;
  spanish: string;
  meaning_en: string | null;
  source: string;
  times_practiced: number;
  created_at: string;
};

type SessionRow = {
  id: string;
  createdAt: string;
  summary: string;
  naturalVersion: string | null;
  keyPhrase: string | null;
  keyPhraseMeaning: string | null;
  pattern: string | null;
  blocker: string | null;
  rescue: unknown;
};

type LibraryResponse = {
  user: { email: string };
  words: WordRow[];
  sessions: SessionRow[];
};

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setState("error");
      setMessage("accounts aren't configured yet.");
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
      if (!response.ok) throw new Error(typeof json?.error === "string" ? json.error : "could not load your work.");
      setData(json as LibraryResponse);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "could not load your work.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    // Deferred: load() can settle synchronously (missing config), and setting state inside the
    // effect body triggers a cascading render.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function continueSession(session: SessionRow) {
    const payload: ResumeMoment = { momentId: session.id, summary: session.summary, rescue: session.rescue };
    try {
      window.sessionStorage.setItem(resumeMomentKey, JSON.stringify(payload));
    } catch {
      // Storage blocked: the room simply starts fresh instead of resuming.
    }
    router.push("/");
  }

  const words = data?.words ?? [];
  const sessions = data?.sessions ?? [];

  return (
    <main className="page-shell">
      <header className="page-header">
        <Link className="page-back" href="/">
          &larr; room
        </Link>
        <p className="page-kicker">your outloud</p>
        <Link className="page-avatar" href="/profile" aria-label="profile">
          {(data?.user.email ?? "?").slice(0, 1).toUpperCase()}
        </Link>
      </header>

      {state === "loading" ? <p className="page-note">loading your words…</p> : null}

      {state === "signed-out" ? (
        <section className="page-empty">
          <h1>your words live here.</h1>
          <p>sign in from a session card to keep the words you collect, and pick a conversation back up.</p>
          <Link className="page-primary" href="/">
            start a session
          </Link>
        </section>
      ) : null}

      {state === "error" ? <p className="page-note is-error">{message}</p> : null}

      {state === "ready" ? (
        <>
          <section className="page-stats" aria-label="Your progress">
            <article>
              <strong>{words.length}</strong>
              <span>words kept</span>
            </article>
            <article>
              <strong>{sessions.length}</strong>
              <span>sessions</span>
            </article>
            <article>
              <strong>{words.filter((word) => word.times_practiced > 0).length}</strong>
              <span>used again</span>
            </article>
          </section>

          <section className="page-section" aria-label="Your words">
            <h2>your words</h2>
            {words.length ? (
              <ul className="word-grid">
                {words.map((word) => (
                  <li key={word.id}>
                    <strong>{word.spanish}</strong>
                    {word.meaning_en ? <small>{word.meaning_en}</small> : null}
                    <span className="word-meta">{formatSavedDate(word.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="page-note">nothing yet — finish a session and save your words.</p>
            )}
          </section>

          <section className="page-section" aria-label="Your sessions">
            <h2>pick one back up</h2>
            {sessions.length ? (
              <ul className="session-list">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <div>
                      <p className="session-summary">{session.summary}</p>
                      {session.naturalVersion ? <p className="session-line">{session.naturalVersion}</p> : null}
                      <p className="session-meta">
                        {formatSavedDate(session.createdAt)}
                        {session.keyPhrase ? ` · ${session.keyPhrase}` : ""}
                      </p>
                    </div>
                    <button type="button" onClick={() => continueSession(session)}>
                      continue &rarr;
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="page-note">no saved sessions yet.</p>
            )}
          </section>

          <Link className="page-primary" href="/">
            start something new
          </Link>
        </>
      ) : null}
    </main>
  );
}
