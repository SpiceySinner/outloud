import { z } from "zod";

export const assistanceUsedSchema = z.enum([
  "full_model",
  "sentence_frame",
  "keyword",
  "repeat",
  "slower_audio",
  "english_explanation",
  "none",
]);

export const attemptEvaluationSchema = z.object({
  meaningResult: z.enum(["clear", "partial", "unclear", "insufficient_evidence"]),
  communicatedMeaningEn: z.string(),
  missingMeaningEn: z.string().nullable(),
  usedTargetChunk: z.boolean(),
  correctedPrimaryIssue: z.boolean().nullable(),
  assistanceUsed: assistanceUsedSchema,
  observedBlocker: z.object({
    type: z.enum([
      "vocabulary_retrieval",
      "sentence_assembly",
      "grammar_control",
      "hesitation_pressure",
      "pronunciation_intelligibility",
      "naturalness_register",
      "follow_up_pressure",
      "insufficient_evidence",
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z.string(),
  }),
  conciseFeedbackEn: z.string(),
  /**
   * The user's own attempt, repaired -- their meaning, their content words, roughly their length.
   * Null when there is nothing to repair. Deliberately not the practised sentence: the correction
   * card used to show `rescue.natural_version`, which is fixed at placement time and therefore
   * showed the same sentence for every reply, dropping whatever the user had actually meant.
   */
  correctedAttemptEs: z.string().nullable(),
  pronunciationTargets: z.array(
    z.object({
      word: z.string(),
      syllables: z.array(z.string()).min(1).max(6),
      stressedSyllableIndex: z.number().int().min(0),
    }),
  ).max(3),
});

export const retrievalVariationSchema = z.object({
  situationEn: z.string(),
  roleEs: z.string(),
  openingLineEs: z.string(),
  openingMeaningEn: z.string(),
  targetCommunicativeFunction: z.string(),
  targetChunkPatternEs: z.string(),
  changedElements: z.array(z.string()),
  expectedMeaningPoints: z.array(z.string()),
  difficultyReason: z.string(),
});

export const attemptEvaluationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "meaningResult",
    "communicatedMeaningEn",
    "missingMeaningEn",
    "usedTargetChunk",
    "correctedPrimaryIssue",
    "assistanceUsed",
    "observedBlocker",
    "conciseFeedbackEn",
    // Nullable, not optional: with strict: true every property must appear in `required`, so
    // "may be absent" is expressed through the type. Same shape as missingMeaningEn below.
    "correctedAttemptEs",
    "pronunciationTargets",
  ],
  properties: {
    meaningResult: { type: "string", enum: ["clear", "partial", "unclear", "insufficient_evidence"] },
    communicatedMeaningEn: { type: "string" },
    missingMeaningEn: { type: ["string", "null"] },
    usedTargetChunk: { type: "boolean" },
    correctedPrimaryIssue: { type: ["boolean", "null"] },
    assistanceUsed: {
      type: "string",
      enum: ["full_model", "sentence_frame", "keyword", "repeat", "slower_audio", "english_explanation", "none"],
    },
    observedBlocker: {
      type: "object",
      additionalProperties: false,
      required: ["type", "confidence", "evidence"],
      properties: {
        type: {
          type: "string",
          enum: [
            "vocabulary_retrieval",
            "sentence_assembly",
            "grammar_control",
            "hesitation_pressure",
            "pronunciation_intelligibility",
            "naturalness_register",
            "follow_up_pressure",
            "insufficient_evidence",
          ],
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        evidence: { type: "string" },
      },
    },
    conciseFeedbackEn: { type: "string" },
    correctedAttemptEs: { type: ["string", "null"] },
    pronunciationTargets: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "syllables", "stressedSyllableIndex"],
        properties: {
          word: { type: "string" },
          syllables: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
          stressedSyllableIndex: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

export const retrievalVariationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "situationEn",
    "roleEs",
    "openingLineEs",
    "openingMeaningEn",
    "targetCommunicativeFunction",
    "targetChunkPatternEs",
    "changedElements",
    "expectedMeaningPoints",
    "difficultyReason",
  ],
  properties: {
    situationEn: { type: "string" },
    roleEs: { type: "string" },
    openingLineEs: { type: "string" },
    openingMeaningEn: { type: "string" },
    targetCommunicativeFunction: { type: "string" },
    targetChunkPatternEs: { type: "string" },
    changedElements: { type: "array", items: { type: "string" } },
    expectedMeaningPoints: { type: "array", items: { type: "string" } },
    difficultyReason: { type: "string" },
  },
} as const;
