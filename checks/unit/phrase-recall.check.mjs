// Does a phrase the learner did NOT ask for come back -- and does the one they DID ask for still
// go first?
//
// Imports the real file. The last time this half was "tested" the test carried its own copy of
// the rule, so green meant only that two copies agreed.
//
// The bug behind it: the closing card promises "your words come back on Tuesday", and three gates
// only let a phrase into the recall queue if `source === "asked"`. Everything on that card is
// `coach_tool` or `rescue_*` -- so the promise was made about exactly the phrases excluded from
// keeping it, on the one screen where we ask for an account.
import { loadLib } from "../harness/load.mjs";

export const about = "every saved phrase is scheduled, asked still sorts first, and the guards hold";

const { duePhrases, pickForScene, maxResurfaces } = await loadLib("lib/phrase-recall.ts");

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-11T12:00:00Z").getTime();
const ago = (days) => new Date(now - days * day).toISOString();

const phrase = (over) => ({
  id: over.id,
  spanish: over.spanish ?? "me encargo yo",
  meaningEn: null,
  source: over.source ?? "coach_tool",
  // `in`, not `??`: the whole point of one case is a dueAt that is deliberately null.
  dueAt: "dueAt" in over ? over.dueAt : ago(1),
  resurfacedCount: over.resurfacedCount ?? 0,
  landedAt: over.landedAt ?? null,
  createdAt: over.createdAt ?? ago(5),
});
const ids = (list) => list.map((p) => p.id);

export default async function run(t) {
  // --- the bug itself: a phrase from the verdict card was permanently ineligible
  t.equal(ids(duePhrases([phrase({ id: "tool", source: "coach_tool" })], now)), ["tool"],
    "a coach_tool phrase with a date is due");
  t.equal(ids(duePhrases([phrase({ id: "resc", source: "rescue_phrase" })], now)), ["resc"],
    "a rescue phrase with a date is due");
  t.equal(ids(duePhrases([phrase({ id: "old", dueAt: null })], now)), [],
    "no date is still no return — rows written before the fix, until the backfill runs");

  // --- widening the pool must not cost the strongest cue its place
  t.equal(
    ids(duePhrases([
      phrase({ id: "tool", source: "coach_tool", dueAt: ago(9) }),
      phrase({ id: "asked", source: "asked", dueAt: ago(1) }),
    ], now)),
    ["asked", "tool"],
    "asked outranks handed-over even when the handed-over one is more overdue",
  );
  t.equal(
    ids(duePhrases([phrase({ id: "newer", dueAt: ago(1) }), phrase({ id: "older", dueAt: ago(6) })], now)),
    ["older", "newer"],
    "among equals, the most overdue still wins",
  );

  // --- the guards that stop this becoming a quiz
  t.equal(ids(duePhrases([phrase({ id: "done", landedAt: ago(2) })], now)), [],
    "landed never comes back");
  t.equal(ids(duePhrases([phrase({ id: "tired", resurfacedCount: maxResurfaces })], now)), [],
    "past the cap it drops out");
  t.equal(ids(duePhrases([phrase({ id: "later", dueAt: new Date(now + day).toISOString() })], now)), [],
    "not due yet");
  t.equal(
    ids(duePhrases([phrase({ id: "fresh", createdAt: new Date(now - 3600_000).toISOString(), dueAt: ago(1) })], now)),
    [],
    "saved an hour ago is due by the clock and wrong by every other measure",
  );

  // --- frequency is set by the roll, never by how many are due
  const many = Array.from({ length: 40 }, (_, i) => phrase({ id: `p${i}`, dueAt: ago(i + 1) }));
  t.equal(pickForScene(many, { nowMs: now, roll: 0 })?.id, "p39", "a full pool still yields at most one");
  t.equal(pickForScene(many, { nowMs: now, roll: 0.9 }), null, "and nothing at all two scenes in three");
}
