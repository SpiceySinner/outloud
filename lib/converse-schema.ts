import { z } from "zod";

export const converseResponseSchema = z.object({
  conversationId: z.string(),
  turnIndex: z.number().int().min(0).max(5),
  characterLineEs: z.string(),
  characterMeaningEn: z.string(),
  meaningChunks: z.array(
    z.object({
      es: z.string(),
      en: z.string(),
    }),
  ),
  keyWord: z
    .object({
      es: z.string(),
      en: z.string(),
    })
    .nullable(),
  expectedCommunicativeFunction: z.string(),
  suggestedReplyFrameEs: z.string(),
  suggestedReplyEs: z.string(),
  responseGuidanceEn: z.string(),
  shouldClose: z.boolean(),
  closingReason: z.string().nullable(),
  isRepairTurn: z.boolean(),
  repairType: z.enum(["non_comprehension", "mishearing"]).nullable(),
});

export const converseResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "conversationId",
    "turnIndex",
    "characterLineEs",
    "characterMeaningEn",
    "meaningChunks",
    "keyWord",
    "expectedCommunicativeFunction",
    "suggestedReplyFrameEs",
    "suggestedReplyEs",
    "responseGuidanceEn",
    "shouldClose",
    "closingReason",
    "isRepairTurn",
    "repairType",
  ],
  properties: {
    conversationId: { type: "string" },
    turnIndex: { type: "number" },
    characterLineEs: { type: "string" },
    characterMeaningEn: { type: "string" },
    meaningChunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["es", "en"],
        properties: {
          es: { type: "string" },
          en: { type: "string" },
        },
      },
    },
    keyWord: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["es", "en"],
          properties: {
            es: { type: "string" },
            en: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    expectedCommunicativeFunction: { type: "string" },
    suggestedReplyFrameEs: { type: "string" },
    suggestedReplyEs: { type: "string" },
    responseGuidanceEn: { type: "string" },
    shouldClose: { type: "boolean" },
    closingReason: { type: ["string", "null"] },
    isRepairTurn: { type: "boolean" },
    repairType: { type: ["string", "null"], enum: ["non_comprehension", "mishearing", null] },
  },
} as const;
