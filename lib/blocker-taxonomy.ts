import type { BlockerType, SelfReportedBlocker } from "@/lib/types";

/**
 * Normalizes free-text blocker descriptions (wording varies across AI-generated evidence
 * fields) into the canonical `BlockerType` enum.
 *
 * Lives in its own leaf module (no runtime dependencies besides `@/lib/types`, which is
 * type-only) because `lib/learning-loop.ts` and `lib/observation-facts.ts` both need it, and
 * this used to live in `lib/teaching-policy.ts`. Importing it from there created a real
 * circular import once `learning-loop.ts` started depending on `teaching-policy.ts` and
 * `observation-facts.ts` (both of which already depended on `teaching-policy.ts` for this
 * function): `teaching-policy -> learning-loop -> teaching-policy`, and
 * `teaching-policy -> learning-loop -> observation-facts -> teaching-policy`. Real ESM bundlers
 * tolerate that cycle, but it broke the hand-rolled standalone test loaders in
 * tests/teaching-policy.test.mjs, tests/learning-loop.test.mjs, and tests/mock-ai-loop.test.mjs,
 * which each compile a closed, acyclic slice of the dependency graph.
 *
 * `lib/teaching-policy.ts` re-exports this so existing
 * `import { normalizeObservedBlocker } from "@/lib/teaching-policy"` call sites keep working
 * unchanged.
 */
export function normalizeObservedBlocker(value: string | undefined): BlockerType {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("word order") || normalized.includes("assembly") || normalized.includes("structure")) {
    return "sentence_assembly";
  }
  if (normalized.includes("vocab") || normalized.includes("word") || normalized.includes("missing")) return "vocabulary_retrieval";
  if (normalized.includes("grammar") || normalized.includes("tense") || normalized.includes("conjug")) return "grammar_control";
  if (normalized.includes("pronunciation") || normalized.includes("intelligib") || normalized.includes("sound")) {
    return "pronunciation_intelligibility";
  }
  if (normalized.includes("natural") || normalized.includes("register") || normalized.includes("tone")) return "naturalness_register";
  if (normalized.includes("follow")) return "follow_up_pressure";
  if (normalized.includes("pressure") || normalized.includes("hesitat") || normalized.includes("freeze")) return "hesitation_pressure";
  if (normalized.includes("insufficient") || normalized.includes("skipped")) return "insufficient_evidence";
  return "sentence_assembly";
}

/**
 * The runtime counterpart of the `SelfReportedBlocker` union in `lib/types.ts`, which is a
 * type-only module. Lives here rather than there because two things need these values at
 * runtime: `lib/coach-schema.ts` builds a Zod enum and a structured-output JSON schema from
 * them, and the client normalizes whatever the coach returns. Keeping it in this leaf module
 * avoids pulling `lib/teaching-policy.ts` (and its `learning-loop` dependency) into the schema.
 *
 * Order matters only for readability; nothing indexes into it.
 */
export const selfReportedBlockers = [
  "words_to_sentences",
  "freeze_under_pressure",
  "missing_words",
  "pronunciation_nerves",
  "sounds_unnatural",
  "grammar_falls_apart",
  "follow_ups_break_me",
  "not_sure",
] as const satisfies readonly SelfReportedBlocker[];

/**
 * Guards a value that crossed a wire or came out of `localStorage` back into the union.
 * Falls back to `not_sure`, which is the honest answer for "we could not tell" -- it maps to
 * `insufficient_evidence` in `blockerHypothesisMap` and therefore to the neutral teaching
 * policy, so a bad value degrades to generic help rather than to confident wrong help.
 */
export function normalizeSelfReportedBlocker(value: unknown): SelfReportedBlocker {
  return (selfReportedBlockers as readonly string[]).includes(value as string)
    ? (value as SelfReportedBlocker)
    : "not_sure";
}

/**
 * How OutLoud says a blocker out loud. `formatBlockerLabel`-style underscore stripping produces
 * jargon ("vocabulary retrieval"), which is fine in a debug string and wrong in a goal line the
 * learner reads every session.
 */
export const blockerFocusLabels: Record<BlockerType, string> = {
  vocabulary_retrieval: "the words that go missing",
  sentence_assembly: "putting the sentence together",
  hesitation_pressure: "getting it out under pressure",
  pronunciation_intelligibility: "making the sound land",
  grammar_control: "keeping the grammar steady",
  naturalness_register: "sounding like a person, not a textbook",
  follow_up_pressure: "surviving the follow-up question",
  insufficient_evidence: "finding out what actually trips you up",
};

/**
 * The runtime counterpart of the `BlockerType` union, for the same reason `selfReportedBlockers`
 * exists: `lib/types.ts` is type-only, and a schema that has to accept one of these values across
 * a wire needs the list at runtime.
 *
 * All eight, including `insufficient_evidence` -- callers that cannot act on "we don't know yet"
 * filter it out themselves (see `redirectableBlockers` in lib/aside-schema.ts) rather than this
 * list quietly disagreeing with the type it mirrors.
 */
export const blockerTypes = [
  "vocabulary_retrieval",
  "sentence_assembly",
  "hesitation_pressure",
  "pronunciation_intelligibility",
  "grammar_control",
  "naturalness_register",
  "follow_up_pressure",
  "insufficient_evidence",
] as const satisfies readonly BlockerType[];
