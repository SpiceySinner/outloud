import type { EventBeat, EventStatus, PlannedBeat, StoredEvent } from "@/lib/event-schema";

/**
 * How many goes at a dreaded event there are, and which day each one falls on.
 *
 * All of it is deterministic and none of it is the model's business -- the same split as Pressure
 * Mode and the VAD profiles. A model asked to schedule will happily invent "seven daily sessions"
 * for an event three weeks out; the arithmetic here cannot.
 *
 * Dates are plain `YYYY-MM-DD` strings throughout and the CLIENT sends what today is. The server
 * has no idea what day it is where the learner lives, and a countdown that is off by one because
 * of a timezone is exactly the kind of small lie this app cannot afford.
 */

/**
 * How far apart the RUN-UP may be spaced. Not a bound on the whole plan: the gap between the
 * opening go and the run-up is deliberately long for a distant event -- see `scheduleBeats`.
 */
const maxGapDays = 7;

/** The most goes any event gets. Four is an evening: arriving, the middle, the hard bit, leaving. */
export const maxBeats = 4;

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Noon UTC, so adding days can never cross a daylight-saving boundary into the previous day.
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Whole days from `fromIso` to `toIso`. Negative when `toIso` is in the past. Null if unparseable. */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * How many goes fit before the event.
 *
 * Deliberately small numbers. The instinct is one session per day until the date, which for a
 * dinner three weeks out is twenty sessions nobody will do and a promise the app then breaks.
 * Three or four real goes at a specific evening is the offer.
 */
export function beatCountFor(daysUntil: number | null) {
  if (daysUntil === null) return 3;
  if (daysUntil <= 1) return 2;
  if (daysUntil <= 3) return 3;
  return maxBeats;
}

/**
 * Which day each go falls on.
 *
 * Two rules do the work. **Beat 1 is always today**: they said it out loud just now, and now is
 * when they mean it. **The rest close in on the event**, at most a week apart from each other,
 * with the last one the day before -- the evening itself is not a rehearsal slot.
 *
 * For a distant event that means one go now and then a run-up in the final weeks, rather than
 * either nagging them for a month or going quiet on the thing they just told us they dread. The
 * long gap that leaves between the first go and the second is the design, not a miss: it is the
 * one place the week bound deliberately does not apply.
 */
export function scheduleBeats(todayIso: string, happensOn: string | null, count: number): (string | null)[] {
  const total = Math.max(1, count);
  // An undated event has nothing to count down to. The beats come in order when they come back.
  if (!happensOn) return Array.from({ length: total }, () => null);
  if (total === 1) return [todayIso];

  const until = daysBetween(todayIso, happensOn) ?? 0;
  const lastOffset = Math.max(0, until - 1);
  const span = Math.min(lastOffset, maxGapDays * (total - 1));

  const offsets = [0];
  for (let i = 1; i < total; i += 1) {
    const fromEnd = total - 1 - i;
    offsets.push(Math.round(lastOffset - (span * fromEnd) / (total - 1)));
    // A tight event can round two goes onto the same day, which is fine -- "two goes today" is a
    // real offer the day before a dinner. Going backwards is not.
    offsets[i] = Math.max(offsets[i], offsets[i - 1]);
  }

  return offsets.map((offset) => addDays(todayIso, offset));
}

/**
 * Thins a full arc down to the number of goes there is actually time for, keeping its shape.
 *
 * **The beat they are dreading is kept first, before the opening and before the ending.** The
 * first version thinned by position and it threw the point away: "I have to call the landlord
 * tomorrow about the heating" came back as starting the call and ending the call, with the
 * complaint that the whole call is about dropped out of the middle. Position cannot tell which
 * beat somebody is afraid of, so the planner says which one it is.
 *
 * What survives after that is the opening -- walking in is its own skill and it is where people
 * freeze -- and then the ending, and then the rest in order. Whatever is kept is put back into
 * chronological order, because the arc is the thing that makes it an evening rather than a list.
 *
 * This is also why the model writes the whole arc every time and the count is decided afterwards:
 * the count depends on the date, and the date arrives in the same answer.
 */
export function pickBeats<T>(beats: T[], count: number, hardestIndex = -1): T[] {
  if (count >= beats.length || beats.length === 0) return beats;

  const order = [
    hardestIndex >= 0 && hardestIndex < beats.length ? hardestIndex : -1,
    0,
    beats.length - 1,
    ...beats.map((_, index) => index),
  ].filter((index) => index >= 0);

  const kept: number[] = [];
  for (const index of order) {
    if (kept.length >= count) break;
    if (!kept.includes(index)) kept.push(index);
  }

  return kept.sort((a, b) => a - b).map((index) => beats[index]);
}

/** The planner's beats, given their place in the calendar. */
export function buildPlan(planned: PlannedBeat[], todayIso: string, happensOn: string | null): EventBeat[] {
  const dates = scheduleBeats(todayIso, happensOn, planned.length);
  return planned.map((beat, index) => ({
    ...beat,
    index,
    dueOn: dates[index] ?? null,
    momentId: null,
    completedAt: null,
  }));
}

/** The next go the learner could actually do right now. Null when the next one is not due yet. */
export function dueBeat(beats: EventBeat[], todayIso: string): EventBeat | null {
  return beats.find((beat) => !beat.completedAt && (beat.dueOn === null || beat.dueOn <= todayIso)) ?? null;
}

/** The next go regardless of when it falls, so the screen can say what is coming. */
export function upcomingBeat(beats: EventBeat[]): EventBeat | null {
  return beats.find((beat) => !beat.completedAt) ?? null;
}

export function beatsDone(beats: EventBeat[]) {
  return beats.filter((beat) => beat.completedAt).length;
}

/**
 * Derived, never stored blind: the row is PATCHed to match this so the database stays honest, but
 * the screen can trust it before any write lands.
 *
 * `abandoned` is not derivable -- it means the learner said to drop it, and only they can say so.
 */
export function eventStatusFor(
  event: Pick<StoredEvent, "happensOn" | "beats" | "outcomeAt" | "status">,
  todayIso: string,
): EventStatus {
  if (event.status === "abandoned") return "abandoned";
  if (event.outcomeAt) return "answered";
  if (event.happensOn && (daysBetween(todayIso, event.happensOn) ?? 0) < 0) return "done";
  if (event.beats.some((beat) => beat.completedAt)) return "running";
  return "planned";
}

/**
 * How the screen says when it is. Written to sit inside a sentence -- "friday's dinner",
 * "tomorrow's dinner" -- so it is lowercase and never a bare date.
 *
 * Null once the event is in the past: at that point the copy is about how it went, not when it is.
 */
export function eventDayLabel(happensOn: string | null, todayIso: string): string | null {
  if (!happensOn) return null;
  const diff = daysBetween(todayIso, happensOn);
  if (diff === null || diff < 0) return null;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";

  const date = parseIsoDate(happensOn);
  const weekday = date
    ? date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase()
    : null;
  if (diff < 7 && weekday) return weekday;
  if (diff < 14 && weekday) return `next ${weekday}`;

  const weeks = Math.round(diff / 7);
  return `in ${weeks} weeks`;
}
