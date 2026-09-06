import { blockerFocusLabels, normalizeObservedBlocker } from "@/lib/blocker-taxonomy";
import type { BlockerType } from "@/lib/types";

/**
 * The shape the home screen reads, and the derivations that turn `/api/library` into it.
 *
 * Deliberately one shape for real data and for the preview: `lib/dashboard-mock.ts` builds a
 * `DashboardData` and nothing else, so wiring the preview to reality is deleting a file rather
 * than rewriting a page.
 *
 * The derivations live here rather than in the page for the reason the profile page is about to
 * stop being an exception: the same claim ("this is what trips you up, and it is moving") was
 * computed in two places, and two copies of a claim about the learner is how an app ends up
 * telling someone two different things about themselves.
 */

export type MasteryState =
  | "needed_full_help"
  | "needed_hint"
  | "answered_on_own"
  | "used_new_situation"
  | "confirmed_real_life";

export const masteryRank: Record<MasteryState, number> = {
  needed_full_help: 0,
  needed_hint: 1,
  answered_on_own: 2,
  used_new_situation: 3,
  confirmed_real_life: 4,
};

/**
 * Second person and plain, because this is read by the learner. `ledgerLabels` in
 * lib/learning-loop.ts is the same ladder written for a log line.
 */
export const masteryLabels: Record<MasteryState, string> = {
  needed_full_help: "we built it together",
  needed_hint: "you got there with a nudge",
  answered_on_own: "you said it unaided",
  used_new_situation: "you reused it somewhere new",
  confirmed_real_life: "you used it for real",
};

export function normalizeMastery(value: string | null | undefined): MasteryState {
  return value && value in masteryRank ? (value as MasteryState) : "needed_full_help";
}

export type MomentCard = {
  id: string;
  createdAt: string;
  summary: string;
  naturalVersion: string | null;
  keyPhrase: string | null;
  keyPhraseMeaning: string | null;
  pattern: string | null;
  blocker: string | null;
  ledgerState: MasteryState;
  dueAt: string | null;
  rescue: unknown;
};

export type WordCard = {
  id: string;
  spanish: string;
  meaning_en: string | null;
  source: string;
  times_practiced: number;
  created_at: string;
};

/** A coach turn in the home chat. `offer` is what makes it a doorway instead of a chatbot. */
export type ChatMessage = {
  id: string;
  from: "coach" | "you";
  text: string;
  offer?: { label: string; detail: string } | null;
};

export type FocusReading = {
  blocker: BlockerType;
  label: string;
  /** Null until there are enough sessions for a before and an after. */
  trend: { recent: number; recentTotal: number; earlier: number; earlierTotal: number } | null;
};

export type DashboardData = {
  user: { email: string };
  moments: MomentCard[];
  words: WordCard[];
  chat: ChatMessage[];
};

// ---------------------------------------------------------------- the focus ---

/**
 * The dimension that shows up most, and whether it is moving. Two windows rather than a chart:
 * with a handful of sessions a line is noise dressed as insight, and "3 of your last 5, down from
 * 4 of 5" is a claim a person can check against their own memory.
 *
 * Needs four sessions before it will call a trend. Below that there is no before and after, and
 * comparing two sessions to two sessions turns one good day into a direction.
 */
export function focusFromMoments(moments: Pick<MomentCard, "blocker">[]): FocusReading | null {
  const counts = new Map<BlockerType, number>();
  for (const moment of moments) {
    if (!moment.blocker) continue;
    const blocker = normalizeObservedBlocker(moment.blocker);
    counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return null;

  let trend: FocusReading["trend"] = null;
  if (moments.length >= 4) {
    const half = Math.floor(moments.length / 2);
    const hits = (window: Pick<MomentCard, "blocker">[]) =>
      window.filter((item) => item.blocker && normalizeObservedBlocker(item.blocker) === top).length;
    const recentWindow = moments.slice(0, half);
    const earlierWindow = moments.slice(half);
    trend = {
      recent: hits(recentWindow),
      recentTotal: recentWindow.length,
      earlier: hits(earlierWindow),
      earlierTotal: earlierWindow.length,
    };
  }

  return { blocker: top, label: blockerFocusLabels[top], trend };
}

/**
 * Whether the dimension is actually moving, or just wobbling.
 *
 * This used to call any difference at all a direction -- `recent > earlier` -- so three of your
 * last six against two of six, a difference of **one session**, printed "it is showing up more,
 * not less" at the top of the home screen. The function above exists precisely to avoid "noise
 * dressed as insight", and then this undid it.
 *
 * Two guards, and a claim has to clear both. Rates, because the windows differ in size whenever
 * the session count is odd; and raw counts, because at these sample sizes a single session can
 * swing a rate by twenty points on its own.
 *
 * The numbers are invented and deliberately conservative. Telling someone their problem is getting
 * worse is the most consequential sentence on the screen, and it should stay silent until it is
 * sure -- saying nothing costs a beat, saying it wrongly costs the trust in everything else.
 */
const trendMinRateGap = 0.2;
const trendMinSessionGap = 2;

export function trendDirection(trend: NonNullable<FocusReading["trend"]>): "falling" | "rising" | "steady" {
  const recent = trend.recent / trend.recentTotal;
  const earlier = trend.earlier / trend.earlierTotal;
  if (Math.abs(trend.recent - trend.earlier) < trendMinSessionGap) return "steady";
  if (Math.abs(recent - earlier) < trendMinRateGap) return "steady";
  if (recent < earlier) return "falling";
  if (recent > earlier) return "rising";
  return "steady";
}

// ------------------------------------------------------------- what is due ---

/**
 * The retrieval loop, which the database has been running the whole time -- every moment is
 * saved with a `retrieval_due_at` -- and which nothing in the app has ever shown anyone. The
 * only surface built for it emails a link to `/m/<id>`, a route that does not exist.
 *
 * Anything already at `confirmed_real_life` is done: the ladder has a top, and asking someone to
 * re-practise a phrase they have used in their actual life is how a review queue becomes a chore.
 */
export function dueMoments(moments: MomentCard[], now = new Date()): MomentCard[] {
  return moments
    .filter((moment) => moment.ledgerState !== "confirmed_real_life")
    .filter((moment) => moment.dueAt !== null && new Date(moment.dueAt).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());
}

export function daysOverdue(dueAt: string, now = new Date()) {
  const diff = now.getTime() - new Date(dueAt).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

// --------------------------------------------------------------- the journey ---

export type JourneyStage = {
  key: string;
  title: string;
  meaning: string;
  /** Unaided moments needed before this stage counts as behind you. */
  threshold: number;
};

/**
 * #51 -- the path is conversations you can survive, not lessons. Tapping a stage explains what it
 * means and never launches anything; the value of seeing it is that it is visibly long, which
 * reframes a bad session as one step rather than as failure.
 */
export const journeyStages: JourneyStage[] = [
  { key: "introduce", title: "introduce yourself", meaning: "say who you are and what you do without rehearsing it first.", threshold: 1 },
  { key: "ask", title: "ask simple questions", meaning: "get something you actually need — where it is, how much, what time.", threshold: 3 },
  { key: "stories", title: "tell short stories", meaning: "two or three sentences about something that happened, in the past.", threshold: 6 },
  { key: "follow-ups", title: "handle follow-up questions", meaning: "keep going when they ask something back, instead of stopping.", threshold: 10 },
  { key: "pressure", title: "speak under pressure", meaning: "hold it together when they talk fast and do not slow down for you.", threshold: 15 },
  { key: "ten-minutes", title: "hold a ten-minute conversation", meaning: "stay in Spanish long enough to forget you are practising.", threshold: 22 },
  { key: "detail", title: "tell a detailed story", meaning: "the version with the side details, not the compressed one.", threshold: 30 },
  { key: "slang", title: "understand slang", meaning: "follow the words nobody puts in a textbook.", threshold: 40 },
  { key: "argue", title: "argue your opinion", meaning: "disagree, and stay disagreeing, without losing the thread.", threshold: 55 },
];

export type JourneyPosition = {
  /** Index of the stage the learner is standing on. */
  index: number;
  unaided: number;
  /** When each cleared stage was crossed: the date of the moment that met its threshold. */
  crossedAt: Record<string, string>;
  toNext: number;
};

/**
 * #53 -- position derives from the ledger, never from a self-report or a level, so it cannot be
 * gamed and it cannot lie about what someone can do.
 *
 * What counts is an unaided moment: `answered_on_own` or better, which is #27's definition of
 * success (produced with no model, frame, or translation in front of them).
 *
 * The thresholds on the stages are invented. Nothing here has been calibrated against a real
 * learner, and the honest version of this needs sessions from strangers before the curve means
 * anything. It is a placeholder with the right *shape*, not a measurement.
 */
export function journeyPosition(moments: MomentCard[]): JourneyPosition {
  const unaidedMoments = moments
    .filter((moment) => masteryRank[moment.ledgerState] >= masteryRank.answered_on_own)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const unaided = unaidedMoments.length;

  const crossedAt: Record<string, string> = {};
  let index = 0;
  for (const stage of journeyStages) {
    if (unaided >= stage.threshold) {
      crossedAt[stage.key] = unaidedMoments[stage.threshold - 1]?.createdAt ?? "";
      index += 1;
    }
  }
  // Standing on the last stage rather than past the end of the path.
  index = Math.min(index, journeyStages.length - 1);
  const toNext = Math.max(0, (journeyStages[index]?.threshold ?? 0) - unaided);
  return { index, unaided, crossedAt, toNext };
}

// ------------------------------------------------------------------ words ---

/** New / used again — the only distinction `word_bank` can actually support today. */
export function wordState(word: WordCard): "new" | "used" {
  return word.times_practiced > 0 ? "used" : "new";
}
