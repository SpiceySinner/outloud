import { z } from "zod";

export const rescueResponseSchema = z.object({
  confirmed_intent: z.object({
    english: z.string(),
    spanish: z.string(),
  }),
  intended_meaning_check: z.string(),
  meaning_result: z.enum(["clear", "partial", "unclear", "skipped"]),
  /**
   * How the observed evidence relates to what the learner said trips them up. The learner told
   * OutLoud their problem; if nothing visibly comes back about it, the honest reaction is "what
   * was the point of telling it my problem?" -- so this is rendered as the verdict headline.
   */
  stated_vs_observed: z
    .object({
      result: z.enum(["confirm", "correct", "both", "not_enough"]),
      line_en: z.string(),
    })
    // Optional on READ only. `rescueJsonSchema` still lists it as required, so the model must
    // emit it; this keeps every moment saved before the field existed parseable. Without it,
    // `generateDelayedRetrievalVariation` would safeParse those rows, fail, and silently return
    // null -- killing the retrieval email for the entire existing corpus.
    .optional(),
  observed_blocker: z.object({
    type: z.string(),
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z.string(),
    explanation_en: z.string(),
  }),
  one_correction: z.string(),
  primary_correction: z.object({
    original_fragment: z.string(),
    corrected_fragment: z.string(),
    explanation_en: z.string(),
  }),
  actionable_feedback: z.object({
    issueType: z.enum([
      "vocabulary_retrieval",
      "sentence_assembly",
      "hesitation_pressure",
      "pronunciation_intelligibility",
      "grammar_control",
      "naturalness_register",
      "follow_up_pressure",
      "insufficient_evidence",
    ]),
    observedEvidence: z.string(),
    explanationEn: z.string(),
    nextActionEn: z.string(),
    targetFragmentEs: z.string().nullable(),
    correctedFragmentEs: z.string().nullable(),
  }),
  natural_version: z.string(),
  important_phrase: z.object({
    spanish: z.string(),
    meaning_en: z.string(),
  }),
  transferableChunk: z.object({
    patternEs: z.string(),
    meaningEn: z.string(),
    communicativeFunction: z.string(),
    whyItHelpsEn: z.string(),
    exampleFromMomentEs: z.string(),
  }),
  tone_note: z.string(),
  spoken_note: z.string(),
  dialect_version: z.string().nullable(),
  pronunciationTargets: z.array(
    z.object({
      word: z.string(),
      syllables: z.array(z.string()).min(1).max(6),
      stressedSyllableIndex: z.number().int().min(0),
    }),
  ).max(3),
});

export type RescueResponseFromSchema = z.infer<typeof rescueResponseSchema>;
