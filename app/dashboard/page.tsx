"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { formatSavedDate, resumeMomentKey, type ResumeMoment } from "@/lib/account-links";
import {
  daysOverdue,
  dueMoments,
  focusFromMoments,
  journeyPosition,
  journeyStages,
  masteryLabels,
  masteryRank,
  normalizeMastery,
  trendDirection,
  wordState,
  type ChatMessage,
  type DashboardData,
  type MomentCard,
} from "@/lib/dashboard-data";
import { mockChatReplies, mockDashboard } from "@/lib/dashboard-mock";

/**
 * Home. What a learner lands on once the funnel is behind them.
 *
 * The thing this screen is NOT allowed to become is a lesson menu. "One screen, no navigation" is
 * in section A of the build plan for a reason -- reviewers of every competitor complain about
 * being in and out of lesson lists. So there is exactly one primary action here, and everything
 * else on the page is either evidence of what happened or a door back into the same room.
 *
 * Three questions, in this order: what should I do right now, what did I already do, and where is
 * this going. Nothing on the page is a streak, and nothing here is configurable -- the focus is
 * set by the evidence, not by the learner picking a topic.
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

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [data, setData] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [extraChat, setExtraChat] = useState<ChatMessage[]>([]);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [wordFilter, setWordFilter] = useState<"all" | "new" | "used">("all");
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [usedChips, setUsedChips] = useState<string[]>([]);

  const load = useCallback(async () => {
    // The preview is checked before anything else: it is the only way to look at this screen
    // without an account and a month of sessions behind it.
    let wantsPreview = false;
    try {
      wantsPreview = new URLSearchParams(window.location.search).get("preview") === "1";
    } catch {
      // No URL to read: fall through to the real path.
    }
    if (wantsPreview) {
      setPreview(true);
      setData(mockDashboard);
      setState("ready");
      return;
    }

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
  }, []);

  useEffect(() => {
    // Deferred: load() can settle synchronously (missing config, or the preview), and setting
    // state inside the effect body triggers a cascading render.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const moments = useMemo(() => data?.moments ?? [], [data]);
  const words = data?.words ?? [];
  const focus = useMemo(() => focusFromMoments(moments), [moments]);
  const due = useMemo(() => dueMoments(moments), [moments]);
  const journey = useMemo(() => journeyPosition(moments), [moments]);
  const chat = useMemo(() => [...(data?.chat ?? []), ...extraChat], [data, extraChat]);

  const filteredWords = words.filter((word) => wordFilter === "all" || wordState(word) === wordFilter);

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

  function tapChip(label: string) {
    const reply = mockChatReplies[label];
    if (!reply) return;
    setExtraChat((current) => [...current, ...reply]);
    // Only the one just used goes away -- hiding the rest makes the section look finished after
    // a single tap, which is the opposite of what a preview is for.
    setUsedChips((current) => [...current, label]);
  }

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

      {preview ? (
        <p className="preview-ribbon">
          <strong>preview</strong> — invented sessions, invented words, for looking at the design. nothing here is
          yours. <Link href="/dashboard">show my real account</Link>
        </p>
      ) : null}

      {state === "loading" ? <p className="page-note">loading…</p> : null}

      {state === "signed-out" ? (
        <section className="page-empty">
          <h1>your words live here.</h1>
          <p>sign in from a session card to keep the words you collect, and pick a conversation back up.</p>
          <Link className="page-primary" href="/">
            start a session
          </Link>
          <Link className="page-secondary" href="/dashboard?preview=1">
            see what it looks like &rarr;
          </Link>
        </section>
      ) : null}

      {state === "error" ? <p className="page-note is-error">{message}</p> : null}

      {state === "ready" && data ? (
        <>
          {/*
            One primary action, always the same one. Review is offered underneath it rather than
            competing with it: a queue that greets you before the door does is a chore list.
          */}
          <section className="home-hero" aria-label="Today">
            <p className="page-kicker">today</p>
            <h1>{focus ? focus.label : "find out what actually trips you up"}</h1>
            <p className="home-hero-note">
              {focus?.trend
                ? (() => {
                    const { recent, recentTotal, earlier, earlierTotal } = focus.trend;
                    const now = `${recent} of your last ${recentTotal} sessions`;
                    const before = `${earlier} of ${earlierTotal} before that`;
                    const direction = trendDirection(focus.trend);
                    if (direction === "falling") return `${now}, down from ${before}. it is showing up less.`;
                    if (direction === "rising") return `${now}, up from ${before}. it is showing up more, not less.`;
                    return `${now}, ${before}. holding steady so far.`;
                  })()
                : moments.length
                  ? `${moments.length} ${moments.length === 1 ? "session" : "sessions"} so far — a couple more and this line can tell you whether it is moving.`
                  : "one conversation is enough to start."}
            </p>
            <Link className="page-primary" href="/">
              start talking
            </Link>
            {due.length ? (
              <p className="home-hero-second">
                <a href="#review">
                  or clear {due.length} {due.length === 1 ? "thing" : "things"} waiting for you &darr;
                </a>
              </p>
            ) : null}
          </section>

          {/*
            The retrieval loop, finally visible. Every moment has always been saved with a due
            date; the only thing ever built to act on it emails a link to a route that 404s.
          */}
          <section className="page-section" id="review" aria-label="Due for another go">
            <h2>another go</h2>
            {due.length ? (
              <>
                <p className="page-body home-section-note">
                  spaced out on purpose — these are the ones far enough back that saying them again actually
                  proves something.
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
                      <button type="button" onClick={() => continueSession(moment)}>
                        say it again
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="page-body">
                nothing due. things come back here a few days after you first got them — long enough that saying
                it again means you actually kept it.
              </p>
            )}
          </section>

          {/*
            #30 -- the biggest bet in the plan, and the reason this is a chat and not a chatbot:
            everything the learner says here about their real week can become the next scenario.
            No engine behind it yet, which the section says out loud instead of faking.
          */}
          <section className="page-section" aria-label="Talk it through">
            <h2>talk it through</h2>
            <p className="page-body home-section-note">
              in English, outside the roleplay. ask what a word is, tell it you froze at the pharmacy, or tell it
              what is coming up this week — and it turns that into the next thing you practise.
            </p>

            {chat.length ? (
              <>
                <button
                  className="chat-toggle"
                  type="button"
                  aria-expanded={chatOpen}
                  onClick={() => setChatOpen((open) => !open)}
                >
                  {chatOpen ? "hide the thread" : `open the thread (${chat.length})`}
                </button>
                {chatOpen ? (
                  <div className="chat-thread">
                    {chat.map((line) => (
                      <div key={line.id} className={line.from === "coach" ? "chat-line is-coach" : "chat-line is-you"}>
                        <p>{line.text}</p>
                        {line.offer ? (
                          <button
                            className="chat-offer"
                            type="button"
                            onClick={() => setPreviewNote("preview — this would open that scenario in the room.")}
                          >
                            <strong>{line.offer.label} &rarr;</strong>
                            <span>{line.offer.detail}</span>
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {Object.keys(mockChatReplies).some((label) => !usedChips.includes(label)) ? (
                      <div className="chat-chips">
                        {Object.keys(mockChatReplies)
                          .filter((label) => !usedChips.includes(label))
                          .map((label) => (
                            <button key={label} type="button" onClick={() => tapChip(label)}>
                              {label}
                            </button>
                          ))}
                      </div>
                    ) : null}
                    <input
                      className="chat-input"
                      type="text"
                      disabled
                      placeholder="no engine behind this yet — tap a suggestion to see the shape"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="page-note">
                not built yet. this is the piece that turns &ldquo;dinner at her parents on friday&rdquo; into
                friday&apos;s session. <Link href="/dashboard?preview=1">see the shape &rarr;</Link>
              </p>
            )}
          </section>

          {/*
            #51-54. A path made of conversations you could survive, not topics. Tapping a stage
            explains it and launches nothing -- the point is seeing that the path is long, which
            makes one bad session a step rather than a verdict.
          */}
          <section className="page-section" aria-label="The speaking journey">
            <h2>where this goes</h2>
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
                    <button type="button" aria-expanded={openStage === stage.key} onClick={() => setOpenStage(openStage === stage.key ? null : stage.key)}>
                      <span className="journey-dot" aria-hidden="true" />
                      <span className="journey-title">{stage.title}</span>
                      <span className="journey-meta">
                        {status === "done" && crossed
                          ? formatSavedDate(crossed)
                          : status === "current"
                            ? focus
                              ? focus.label
                              : "here"
                            : ""}
                      </span>
                    </button>
                    {openStage === stage.key ? <p className="journey-meaning">{stage.meaning}</p> : null}
                    {status === "current" && journey.toNext > 0 ? (
                      <p className="journey-meaning is-progress">
                        {journey.toNext} more unaided {journey.toNext === 1 ? "sentence" : "sentences"} and this
                        one is behind you.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="page-section" aria-label="Your words">
            <h2>your words</h2>
            {words.length ? (
              <>
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
                <ul className="word-grid">
                  {filteredWords.map((word) => (
                    <li key={word.id} className={wordState(word) === "used" ? "is-used" : ""}>
                      <strong>{word.spanish}</strong>
                      {word.meaning_en ? <small>{word.meaning_en}</small> : null}
                      <span className="word-meta">
                        {word.times_practiced > 0
                          ? `used ${word.times_practiced}×`
                          : formatSavedDate(word.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="page-note">nothing yet — finish a session and keep the words it hands you.</p>
            )}
          </section>

          <section className="page-section" aria-label="Your sessions">
            <h2>everything so far</h2>
            {moments.length ? (
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
                    <button type="button" onClick={() => continueSession(moment)}>
                      continue &rarr;
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="page-note">no saved sessions yet.</p>
            )}
          </section>

          {previewNote ? (
            <p className="page-note preview-note" role="status">
              {previewNote}
            </p>
          ) : null}

          <Link className="page-primary" href="/">
            start something new
          </Link>
        </>
      ) : null}
    </main>
  );
}

/** The ledger as five steps, so a moment shows how far it has actually come. */
function MasteryLadder({ state }: { state: MomentCard["ledgerState"] }) {
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
