import { normalizeObservedBlocker } from "@/lib/blocker-taxonomy";
import type { BlockerType, SavedMoment } from "@/lib/types";

export type ObservationFactsResult =
  | { kind: "none" }
  | { kind: "observations"; facts: string[]; forward: string | null };

/**
 * Blocker types that have a natural "you almost never need X help" framing.
 * (sentence_assembly / hesitation_pressure / naturalness_register / follow_up_pressure /
 * insufficient_evidence don't read naturally as "help" categories, so they're excluded.)
 */
const helpPhraseForBlocker: Partial<Record<BlockerType, string>> = {
  vocabulary_retrieval: "vocabulary help",
  pronunciation_intelligibility: "pronunciation help",
  grammar_control: "grammar help",
};

const trackedHelpBlockers = Object.keys(helpPhraseForBlocker) as BlockerType[];

/**
 * Plain-language phrase for "you freeze on ___" -- used only for real, evidenced gaps.
 * Exported so other features (e.g. the retrieval-session context line) that need to describe
 * the same gapType read the same way as the "I've noticed" card, rather than re-deriving a
 * slightly different phrasing.
 */
export const freezePhraseForBlocker: Partial<Record<BlockerType, string>> = {
  vocabulary_retrieval: "finding words",
  sentence_assembly: "putting sentences together",
  hesitation_pressure: "pressure",
  pronunciation_intelligibility: "pronunciation",
  grammar_control: "grammar",
  naturalness_register: "sounding natural",
  follow_up_pressure: "follow-up questions",
};

/** Plain-language phrase for "tomorrow we're practicing ___". Always defined so a forward
 * statement is always computable from the current moment alone. */
const forwardPhraseForBlocker: Record<BlockerType, string> = {
  vocabulary_retrieval: "pulling up vocabulary faster",
  sentence_assembly: "building full sentences",
  hesitation_pressure: "starting without freezing",
  pronunciation_intelligibility: "pronunciation",
  grammar_control: "grammar control",
  naturalness_register: "making it sound natural",
  follow_up_pressure: "follow-up questions",
  insufficient_evidence: "getting a clearer read on what's tripping you up",
};

/**
 * Exported so other features that need to attribute a moment to a single blocker type
 * (e.g. the skill-profile dimension builder) reuse the same attribution logic rather than
 * re-deriving an equivalent-but-slightly-different rule.
 */
export function primaryBlockerOf(moment: SavedMoment): BlockerType {
  return moment.teachingPolicy?.primaryObservedBlocker ?? normalizeObservedBlocker(moment.rescue.observed_blocker.type);
}

/**
 * (A) Rarely-needs-X strength signal. Looks at up to the last 8 moments (current + prior).
 * Only runs with >= 5 moments in the window. For each "help"-framable blocker type, counts
 * how many windowed moments had it as the primary observed blocker. If a blocker type's
 * count is <= 1 across the window, that's real evidence of "almost never needed." Caps at
 * one candidate (the lowest count; ties broken by declaration order for determinism).
 */
function computeRareBlockerFact(current: SavedMoment, priorMoments: SavedMoment[]): string | null {
  const window = [current, ...priorMoments].slice(0, 8);
  if (window.length < 5) return null;

  const counts = trackedHelpBlockers.map((blocker) => ({
    blocker,
    count: window.filter((moment) => primaryBlockerOf(moment) === blocker).length,
  }));
  const eligible = counts.filter((entry) => entry.count <= 1);
  if (!eligible.length) return null;

  eligible.sort((a, b) => a.count - b.count || trackedHelpBlockers.indexOf(a.blocker) - trackedHelpBlockers.indexOf(b.blocker));
  const strongest = eligible[0];
  return `you almost never need ${helpPhraseForBlocker[strongest.blocker]}`;
}

/**
 * (B) Recurring freeze / gap signal. Only looks at the CURRENT moment's focusGap, and only
 * produces a fact when there's a real, non-empty evidence string already written by an
 * evaluation step. gapType is free text, so it's always run through normalizeObservedBlocker
 * before being compared with the canonical BlockerType values.
 * turnIndex is 0-indexed (see ConverseResponse.turnIndex / app/api/converse/route.ts), so it's
 * rendered as an ordinal ("turn N+1"). No duration is ever attached -- that data doesn't exist
 * per-turn.
 *
 * Gated on having at least one prior moment: the client-side focus-gap derivation
 * always returns a non-null focusGap with real evidence via its fallback chain, so without
 * this guard a user's very first-ever save would get an "i've noticed" framing built from a
 * single fresh diagnostic read -- presumptuous for a feature about noticing patterns, and
 * redundant with the rescue card they just saw. A true first-timer gets the forward statement
 * alone instead.
 */
function computeFreezeGapFact(current: SavedMoment, priorMoments: SavedMoment[]): { fact: string; blocker: BlockerType } | null {
  if (priorMoments.length === 0) return null;
  const gap = current.focusGap;
  if (!gap || !gap.evidence || !gap.evidence.trim()) return null;

  const normalized = normalizeObservedBlocker(gap.gapType);
  if (normalized === "insufficient_evidence") return null;

  const phrase = freezePhraseForBlocker[normalized];
  if (!phrase) return null;

  const turnRef = typeof gap.turnIndex === "number" ? ` (turn ${gap.turnIndex + 1})` : "";
  return { fact: `you slow down on ${phrase}${turnRef} — ${gap.evidence.trim()}`, blocker: normalized };
}

/**
 * (C) Persistent assistance-dependency signal. Only runs when there are at least 3 moments
 * (current + 2 prior). If at least 2 of the last 3 needed a sentence frame (on either the
 * rebuild or transfer stage), that's real evidence of persistent dependency. Deliberately
 * narrow: only sentence_frame, not any other assistance type.
 */
function computeSentenceFrameFact(current: SavedMoment, priorMoments: SavedMoment[]): string | null {
  const window = [current, ...priorMoments].slice(0, 3);
  if (window.length < 3) return null;

  const count = window.filter(
    (moment) =>
      moment.rebuildEvaluation?.assistanceUsed === "sentence_frame" ||
      moment.transferEvaluation?.assistanceUsed === "sentence_frame",
  ).length;
  if (count < 2) return null;

  return "you're still using sentence frames.";
}

/**
 * Forward-looking statement, always computable from the current moment's primary observed
 * blocker alone. If any facts were produced above, it references them generically ("because
 * of this") rather than restating a specific number/detail -- the actual referent is whichever
 * fact renders directly above it. Preference order for "the reason" (not literally embedded in
 * the string, just documented intent) is B (freeze/gap) > C (assistance dependency) > A (rare
 * blocker), matching the order facts are computed/pushed below.
 */
function computeForward(current: SavedMoment, hasFacts: boolean): string | null {
  const blocker = primaryBlockerOf(current);
  const phrase = forwardPhraseForBlocker[blocker];
  if (!phrase) return null;
  return `tomorrow we're practicing ${phrase}${hasFacts ? " because of this" : ""}.`;
}

/**
 * Deterministically computes candidate "I've noticed" fact strings plus one forward-looking
 * statement from the just-saved current moment and full prior history (newest-first, current
 * not included in priorMoments). Every fact is already-true, already-worded, and directly
 * backed by stored fields -- nothing here is inferred, estimated, or invented. Each category is
 * independently gated by its own minimum-evidence threshold and is skipped entirely (not
 * padded) when that threshold isn't met.
 */
export function buildObservationFacts(current: SavedMoment, priorMoments: SavedMoment[]): ObservationFactsResult {
  const facts: string[] = [];

  const freezeGap = computeFreezeGapFact(current, priorMoments);
  if (freezeGap) facts.push(freezeGap.fact);

  const sentenceFrameFact = computeSentenceFrameFact(current, priorMoments);
  if (sentenceFrameFact) facts.push(sentenceFrameFact);

  const rareBlockerFact = computeRareBlockerFact(current, priorMoments);
  if (rareBlockerFact) facts.push(rareBlockerFact);

  const forward = computeForward(current, facts.length > 0);

  if (facts.length === 0 && !forward) return { kind: "none" };
  return { kind: "observations", facts, forward };
}
