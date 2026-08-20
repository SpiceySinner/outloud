import type { BlockerType } from "@/lib/types";

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
