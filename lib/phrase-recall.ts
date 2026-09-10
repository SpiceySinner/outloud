import { reviewSpacingDaysAfterReview } from "@/lib/learning-loop";

/**
 * Which asked-for phrase comes back, and when.
 *
 * Pure and AI-free, the twin of `lib/event-plan.ts` and for the same reason: **the model writes
 * content, deterministic code owns counts and dates.** A scheduler that a language model can talk
 * itself out of is not a scheduler.
 *
 * The thing being built here is the moment in `docs/features/router-talk-feat.md` section 3: a
 * learner asks how to say something on Tuesday, and on Friday, inside a scene built for something
 * else entirely, they land in a spot where exactly that phrase is what is needed -- and reach for
 * it themselves. The feeling is "I know this one". The goal is that they feel smart, and that only
 * happens if the retrieval is theirs.
 *
 * Everything in this file exists to protect that from the six ways it dies, all of which ship fine
 * and quietly teach nothing:
 *
 * - resurfacing in the same session          -> `minimumGapHours`
 * - it firing every time                     -> `pickForScene` returns at most one, often none
 * - keeping a phrase in rotation forever     -> `maxResurfaces`
 * - the character saying the phrase          -> not here; the injected instruction, and the fact
 *                                               that `/api/variation` builds a situation that
 *                                               NEEDS a pattern without stating it
 * - help offered before they have tried      -> not here; the help ladder
 * - announcing it on the way in              -> not here; the copy says nothing beforehand
 */

/** A `word_bank` row, only the columns this file reasons about. */
export type RecallPhrase = {
  id: string;
  spanish: string;
  meaningEn: string | null;
  source: string;
  /** When it is next worth putting in front of them. Null means never scheduled. */
  dueAt: string | null;
  /** How many times it has come back without being produced. */
  resurfacedCount: number;
  /** When it was produced unaided in a real scene. Set once; a phrase with this is theirs. */
  landedAt: string | null;
  createdAt: string;
};

/**
 * Never in the same session, and not later the same evening either.
 *
 * The whole point is that it comes back once they have stopped thinking about it. Same-session
 * resurfacing is a quiz, reads as one, and turns "I know this one" into "it is testing me" --
 * which is the difference between the learner feeling smart and the app looking clever.
 */
export const minimumGapHours = 20;

/**
 * How many times a phrase may come back without being produced before it drops out.
 *
 * Something that keeps failing to surface is either too hard for them right now or simply wrong
 * for them, and a third and fourth attempt is the app nagging. Dropping it is not giving up on the
 * phrase -- they can ask again, and asking again is a better signal than anything we would have
 * inferred from making them fail at it twice more.
 */
export const maxResurfaces = 3;

const dayMs = 24 * 60 * 60 * 1000;

/**
 * When a phrase should next come back, given how many times it has already been offered.
 *
 * Reuses the spacing the app already applies to saved moments rather than inventing a second
 * curve: two learning schedules in one product drift, and the one that drifts is always the one
 * nobody is looking at. A phrase that has just been asked for is at the bottom of the ladder --
 * `needed_full_help` -- because it is, by definition, a thing they could not say.
 */
export function nextDueAt(resurfacedCount: number, fromMs: number = Date.now()) {
  const ledger = resurfacedCount === 0 ? "needed_full_help" : resurfacedCount === 1 ? "answered_on_own" : "used_new_situation";
  const days = reviewSpacingDaysAfterReview(ledger);
  return new Date(fromMs + days * dayMs).toISOString();
}

function hoursSince(iso: string, nowMs: number) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (nowMs - then) / (60 * 60 * 1000);
}

/**
 * Every phrase that is worth bringing back right now, strongest first.
 *
 * The priority is the one in the feature doc, in order:
 *   1. has it ever landed unaided -- if yes it stops competing, it is theirs
 *   2. how long since it came due -- the most overdue is the most valuable to catch
 *   3. how many fruitless returns -- something already offered twice ranks below something fresh
 */
export function duePhrases(phrases: RecallPhrase[], nowMs: number = Date.now()) {
  return phrases
    .filter((phrase) => {
      if (phrase.landedAt) return false;
      if (phrase.resurfacedCount >= maxResurfaces) return false;
      if (!phrase.dueAt) return false;
      if (new Date(phrase.dueAt).getTime() > nowMs) return false;
      // A phrase asked for an hour ago is due by the clock and wrong by every other measure.
      return hoursSince(phrase.createdAt, nowMs) >= minimumGapHours;
    })
    .sort((a, b) => {
      const overdue = new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime();
      if (overdue !== 0) return overdue;
      return a.resurfacedCount - b.resurfacedCount;
    });
}

/** One scene in three. Not tuned against anything yet -- nobody has the evidence. */
export const sceneChance = 1 / 3;

/**
 * At most one phrase for this scene, and often none.
 *
 * A scene built around a saved phrase EVERY time is a vocabulary quiz in a costume, and learners
 * find that pattern fast -- at which point every scene is read as a test and the aha is gone for
 * good. So the frequency is deliberately less than one: roughly one scene in three carries a
 * phrase.
 *
 * `roll` is injected rather than read from `Math.random` so this stays pure and testable; the
 * caller passes the randomness in.
 */
export function pickForScene(
  phrases: RecallPhrase[],
  { nowMs = Date.now(), roll = Math.random() }: { nowMs?: number; roll?: number } = {},
): RecallPhrase | null {
  const due = duePhrases(phrases, nowMs);
  if (!due.length) return null;
  if (roll >= sceneChance) return null;
  return due[0];
}

/**
 * Did the phrase actually come out?
 *
 * Deterministic containment, accent- and punctuation-blind, the same shape as `appearsIn` in
 * `/api/event-plan`. This measures that the words appeared, not that they were MEANT, which is
 * honest for a first build and much better than inventing an evaluator field on a guess: the
 * evaluator's own `usedTargetChunk` judges the rescue's chunk, which in a resurfacing scene is a
 * different string entirely.
 */
export function containsPhrase(transcript: string, phrase: string) {
  // Same flattening as `appearsIn` in `/api/event-plan`, deliberately: a phrase has to survive
  // being transcribed with or without its accents, and the two checks must not disagree.
  const flatten = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const hay = flatten(transcript);
  const hasGap = /_{2,}|\.{3,}/.test(phrase);

  if (!hasGap) {
    const needle = flatten(phrase);
    return needle.length > 0 && hay.includes(needle);
  }

  /*
   * A pattern is stored with its blank in it -- "me encargo de ___" -- and nobody says the blank,
   * so what can be matched is the part before it. Without this every resurfaced pattern would be
   * recorded as a miss no matter how well it went.
   *
   * Two words minimum, and this is the guard that matters: "quiero ___" reduces to "quiero", which
   * appears in a huge share of everything anybody says in Spanish. Counting that as the pattern
   * having landed would fill the record with ahas that never happened -- and a phrase wrongly
   * marked as landed never comes back, so the learner silently loses it. A pattern too short to
   * recognise is one we decline to score rather than one we guess at.
   */
  const stem = flatten(phrase.split(/_{2,}|\.{3,}/)[0] ?? "");
  return stem.split(" ").filter(Boolean).length >= 2 && hay.includes(stem);
}

/**
 * The aha, recorded.
 *
 * Both halves are required and neither is negotiable. Produced, and produced ALONE: if the help
 * ladder handed them the phrase before they tried, we destroyed the thing we were building and
 * writing it down as a success would make the record lie about it.
 */
export function landed(transcript: string, phrase: string, assistanceUsed: string) {
  return containsPhrase(transcript, phrase) && assistanceUsed === "none";
}
