"use client";

import posthog from "posthog-js";

import { getClientSessionId } from "@/lib/client-session";

/**
 * Product analytics, in one closed catalogue.
 *
 * See `docs/features/tracking.md` for the seven questions this exists to answer and, for each,
 * the decision it feeds. Two things about the design are load-bearing.
 *
 * **The catalogue is closed.** `trackedEvents` below is the whole vocabulary; `track()` will not
 * compile with a name that is not in it or a property that is not declared for it. This is not
 * tidiness. The last analytics layer this app had died of `step_viewed` -- 324 of its 644 rows
 * were one generic event with a `step` string, which can tell you somebody moved and never what
 * they decided. A catch-all is always easier to reach for than a name, so the type system refuses
 * to offer one.
 *
 * **Nothing free-text ever leaves.** This database holds what somebody could not say to their
 * partner's mother. PostHog gets event names, enums from fixed lists, counts, durations and
 * booleans. No transcripts, no attempts, no rescues, no email. Every property type below is a
 * boolean, a number, or a union of literals -- there is deliberately not a single bare `string`
 * in the catalogue, so a sentence cannot be attached by accident.
 *
 * Inert without a key, like everything else configurable here: a missing `NEXT_PUBLIC_POSTHOG_KEY`
 * makes every call a no-op rather than a crash.
 */

/**
 * The catalogue. The value is a type carrier only -- it is never read at runtime.
 *
 * Adding an event means adding a line here AND a line in the doc explaining which question it
 * answers. An event that cannot name its question does not get added.
 */
export const trackedEvents = {
  // -------------------------------------------------------------- Q1: do people speak at all?
  /** The entry screen is ready and the learner is looking at it. */
  dash_arrived: {} as {
    signedIn: boolean;
    /** How much was waiting for them. Zero is a very different screen from four. */
    openItems: number;
    hasEvent: boolean;
  },
  /** They reached for the microphone. The single most important conversion in the app. */
  dash_mic_opened: {} as {
    /** True when this follows a miss, so a retry is not counted as fresh intent. */
    afterRetry: boolean;
  },
  /** The window closed. `spoke` false is somebody who opened the mic and said nothing. */
  dash_mic_closed: {} as { spoke: boolean; heldMs: number },

  // -------------------------------------------------------------- Q2/Q3: the router
  /** One utterance routed. The intent distribution is the "were we right?" number. */
  dash_routed: {} as {
    intent: "resume" | "new_scenario" | "ask_phrase" | "stung" | "talk" | "unclear";
    /** Whether this build can act on it, or whether it takes the honest refusal. */
    runnable: boolean;
    hadOpenItems: boolean;
    /** Bucketed, never the sentence. Length is a signal; content is not ours to send. */
    saidLength: "short" | "medium" | "long";
  },
  /** Understood, and nothing behind it. The corpus of what to build next. */
  dash_kept: {} as { intent: "ask_phrase" | "stung" | "talk" | "unclear" },

  // -------------------------------------------------------------- Q4: does a session finish?
  /** A session began, and how they got into it. */
  session_started: {} as {
    entry: "intake" | "resume" | "event_beat" | "stung" | "ask_phrase" | "landing";
    signedIn: boolean;
  },
  /** The intake produced a rescue: the first point where the app has given something back. */
  rescue_reached: {} as { turns: number; blocker: string },
  /** A turn of the practice conversation came back judged. */
  scene_turn: {} as {
    index: number;
    assistanceUsed: "none" | "hint" | "full" | "unknown";
    meaning: "clear" | "unclear" | "insufficient_evidence" | "unknown";
  },
  /** The verdict panel rendered. Everything after this is the closing half. */
  verdict_reached: {} as { ledgerState: string; usedTargetChunk: boolean },
  /** The closing card rendered: they saw the whole session through. */
  session_closed: {} as { turns: number; saved: boolean },

  // -------------------------------------------------------------- Q5: the account
  /** The ask was on screen. Denominator for everything below it. */
  account_ask_seen: {} as { unclaimedRuns: number },
  /** They opened the dialog. Intent, separate from completion. */
  account_dialog_opened: {} as { mode: "signup" | "signin" },
  /** An account now exists. */
  account_created: {} as { unclaimedRuns: number },

  // -------------------------------------------------------------- the event engine (#30)
  /** A real dreaded evening got planned, and into how many goes. */
  event_planned: {} as { beats: number; dated: boolean; daysAway: number | null },
  /** One go at it was started. */
  event_beat_started: {} as { index: number; of: number },
  /** They came back and said how it went. The rarest and most valuable row in the app. */
  event_outcome: {} as { spoke: boolean },

  // -------------------------------------------------------------- Q7: the phrase that returns
  /** A phrase they asked for was kept. */
  phrase_asked: {} as Record<string, never>,
  /** A due phrase was pushed into a scene. Never announced to the learner. */
  phrase_resurfaced: {} as { resurfacedCount: number; daysSinceAsked: number },
  /** They produced it, unaided. This is the aha, and the reason the feature exists. */
  phrase_landed: {} as { resurfacedCount: number; daysSinceAsked: number },
} as const;

export type TrackedEventName = keyof typeof trackedEvents;

/**
 * Everything session replay must blank out.
 *
 * The list is content, never chrome. Buttons, headers, phase labels and the orb keep recording,
 * because those are what tell you WHERE somebody stopped -- which is the entire reason replay is
 * on. What gets blanked is what they said, what the coach said back, and anything derived from
 * either.
 *
 * **`.private` is the escape hatch, and the rule for new work:** any component that renders a
 * learner's words, a coach line, a rescue or a transcript carries `className="... private"`. This
 * list will fall behind the UI otherwise -- it is a snapshot of one afternoon's class names, and
 * the next panel somebody adds will not be in it.
 */
const contentSelectors = [
  ".private",
  // the room: rescue, verdict and the tools that quote either
  ".natural-line",
  ".moment-before",
  ".moment-after",
  ".verdict-evidence",
  ".verdict-moment",
  ".verdict-loot",
  ".coach-tool-es",
  ".coach-tool-en",
  ".coach-tool-example",
  ".coach-tool-note",
  ".ask-natural",
  ".ask-verdict",
  ".transcript-list",
  ".room-translation",
  ".room-note",
  // the entry screen: the read-back IS their own sentence, and the cards quote saved practice
  ".dash-lead",
  ".dash-pickup-line",
  ".dash-pickup-meaning",
  ".dash-steps-title",
  ".dash-step-title",
].join(", ");

let started = false;

function key() {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY;
}

/**
 * Starts PostHog once, or does nothing at all.
 *
 * `distinct_id` is the browser's `outloud-session-id` -- the same pseudonym `sessions`,
 * `moments` and `events` are keyed on. That is what lets a funnel here and a SQL query there be
 * about the same person without an email ever crossing between them.
 */
export function initTracking() {
  if (started || typeof window === "undefined") return;
  const token = key();
  if (!token) return;

  const sessionId = getClientSessionId();
  started = true;

  posthog.init(token, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    // The room is one screen that never navigates, so a pageview per load says nothing and a
    // pageleave says less. Everything worth knowing is an explicit event below.
    capture_pageview: false,
    capture_pageleave: false,
    /*
     * Session replay is ON, deliberately. Watching somebody give up is the only way to see WHY
     * they gave up: a funnel says they left at the rescue, a replay says they sat on it for
     * ninety seconds first, and those two facts lead to different fixes.
     *
     * The masking is what makes it keepable, and it is not PostHog's default. This app's screens
     * carry what somebody could not say to their partner's mother, so both halves are covered:
     *
     *   maskAllInputs     -- everything typed. The attempt, the retry, the email.
     *   maskTextSelector  -- and the RENDERED text as well, which is the unusual part. A DOM
     *                        recording would otherwise capture the rescue, the coach's lines and
     *                        the transcript as plainly readable text. `.private` marks those
     *                        blocks; the chrome you actually need in order to see where somebody
     *                        stopped -- buttons, headers, the orb, the phase -- records normally.
     *
     * The result is a replay you can watch for behaviour and cannot read for content. That is the
     * trade this app has to make rather than picking one side of it.
     */
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: contentSelectors,
      // Request and response bodies would carry the same sentences straight back out again.
      recordHeaders: false,
      recordBody: false,
    },
    autocapture: false,
    persistence: "localStorage",
    ...(sessionId ? { bootstrap: { distinctID: sessionId } } : {}),
  });

  if (sessionId) posthog.identify(sessionId);
}

/**
 * One event, or nothing.
 *
 * Never throws. A tracker that can break a session is worse than no tracker: the numbers are for
 * us and the session is for them.
 */
export function track<K extends TrackedEventName>(
  name: K,
  properties: (typeof trackedEvents)[K],
): void {
  if (!key() || typeof window === "undefined") return;
  try {
    posthog.capture(name, properties);
  } catch {
    // Blocked, offline, or not started. Nothing here is worth interrupting anybody for.
  }
}

/**
 * Ties this browser to an account.
 *
 * The Supabase user id, never the email address. PostHog has no reason to hold an address, and
 * the id is what the database joins on anyway.
 */
export function identifyAccount(userId: string) {
  if (!key() || typeof window === "undefined") return;
  try {
    posthog.alias(userId);
    posthog.people?.set({ has_account: true });
  } catch {
    // As above.
  }
}

/** Bucketed length for the router. The sentence itself never leaves the browser. */
export function saidLength(said: string): "short" | "medium" | "long" {
  const words = said.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 3) return "short";
  if (words <= 12) return "medium";
  return "long";
}
