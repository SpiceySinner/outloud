import { z } from "zod";

export const lifelineOptionSchema = z.object({
  spanish: z.string(),
  meaningEn: z.string(),
  useWhenEn: z.string(),
});

export const lifelineResponseSchema = z.object({
  queryEn: z.string(),
  options: z.array(lifelineOptionSchema).min(1).max(3),
  fallbackFrameEs: z.string(),
  noteEn: z.string(),
});

export const lifelineResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["queryEn", "options", "fallbackFrameEs", "noteEn"],
  properties: {
    queryEn: { type: "string" },
    options: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["spanish", "meaningEn", "useWhenEn"],
        properties: {
          spanish: { type: "string" },
          meaningEn: { type: "string" },
          useWhenEn: { type: "string" },
        },
      },
    },
    fallbackFrameEs: { type: "string" },
    noteEn: { type: "string" },
  },
} as const;
