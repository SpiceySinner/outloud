import { z } from "zod";

export const freezeSignalsSchema = z.object({
  timeToFirstWordSeconds: z.number().nullable(),
  hesitationCount: z.number().int().min(0),
  englishWordCount: z.number().int().min(0),
  summary: z.string(),
});

export const pronunciationCoachingSchema = z.object({
  intelligible: z.boolean(),
  fixWord: z.string().nullable(),
  coachingNoteEn: z.string(),
});

export const pronunciationCoachingJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intelligible", "fixWord", "coachingNoteEn"],
  properties: {
    intelligible: { type: "boolean" },
    fixWord: {
      type: ["string", "null"],
      description: "The one word or sound that would block listener understanding; null if none.",
    },
    coachingNoteEn: {
      type: "string",
      description: "One sentence only: either a plain affirmation or one concrete intelligibility fix, never both.",
    },
  },
} as const;

export type PronunciationCoaching = z.infer<typeof pronunciationCoachingSchema>;
