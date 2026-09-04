import { z } from "zod";

import { selfReportedBlockers } from "@/lib/blocker-taxonomy";

/**
 * One turn of the adaptive coach. The model owns the conversation (what to ask, when to help,
 * when it has seen enough) and picks at most one UI tool per turn from a fixed catalog so the
 * client stays deterministic.
 */

export const coachToolTypes = [
  "none",
  "keyword_card",
  "sentence_frame",
  "english_explanation",
  "say_it_back",
  "slow_repeat",
  "preparation_time",
  "path_choice",
] as const;

export type CoachToolType = (typeof coachToolTypes)[number];

export const coachIntents = ["probe", "teach", "retry", "advance", "wrap_up"] as const;

/**
 * framing  - English: mirror what trips them up, offer two directions (path_choice).
 * scenario - English: invite them to show what they would say in the chosen scenario.
 * coaching - Spanish: the actual cold-water-with-a-lifeline conversation.
 * closing  - the done turn.
 */
export const coachPhases = ["framing", "scenario", "coaching", "closing"] as const;
export type CoachPhase = (typeof coachPhases)[number];

export const coachResponseSchema = z.object({
  coachId: z.string(),
  turnIndex: z.number().int().min(0).max(12),
  /** What the coach says out loud. Spanish by default; English only for english_explanation. */
  sayEs: z.string().min(1),
  meaningEn: z.string(),
  intent: z.enum(coachIntents),
  phase: z.enum(coachPhases),
  expectedCommunicativeFunction: z.string(),
  tool: z.object({
    type: z.enum(coachToolTypes),
    /** keyword_card: the word. sentence_frame: frame with one ___. say_it_back: the phrase. slow_repeat: unused. */
    primaryEs: z.string().nullable(),
    /** English meaning of primaryEs. */
    primaryEn: z.string().nullable(),
    /** sentence_frame: one filled-in example. */
    exampleEs: z.string().nullable(),
    /** english_explanation: the explanation. keyword_card: when to use it. preparation_time: the way in. */
    noteEn: z.string().nullable(),
    /** path_choice: exactly two directions the learner can pick (tap or say). */
    options: z
      .array(
        z.object({
          labelEn: z.string(),
          scenarioEn: z.string(),
        }),
      )
      .nullable(),
  }),
  /** What the last learner attempt showed. Null on the opening turn. */
  evidence: z
    .object({
      observedBlocker: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
      noteEn: z.string(),
    })
    .nullable(),
  /**
   * The learner's OWN hypothesis, classified from their opening answer -- not a diagnosis.
   * Set on the framing turn (the one turn that has just read that answer) and null on every
   * turn after it, so a later turn cannot quietly overwrite what they actually said.
   */
  selfReportedBlocker: z.enum(selfReportedBlockers).nullable(),
  /**
   * Who the learner is about to talk to (#29). Set on the scenario turn, where the coach names
   * them out loud, and carried forward so the practice session that follows is with the same
   * person rather than an anonymous "Spanish coach". Null on every other turn.
   */
  sceneCharacter: z
    .object({
      /** First name only. */
      name: z.string(),
      /** Their relation to the learner, e.g. "your girlfriend's aunt", "the barista". */
      relation: z.string(),
      /** The one trait that makes them hard to talk to. */
      traitEn: z.string(),
    })
    .nullable(),
  done: z.boolean(),
  doneReason: z.string().nullable(),
});

export type CoachResponse = z.infer<typeof coachResponseSchema>;

const nullableString = { type: ["string", "null"] } as const;

export const coachResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "coachId",
    "turnIndex",
    "sayEs",
    "meaningEn",
    "intent",
    "phase",
    "expectedCommunicativeFunction",
    "tool",
    "evidence",
    "selfReportedBlocker",
    "sceneCharacter",
    "done",
    "doneReason",
  ],
  properties: {
    coachId: { type: "string" },
    turnIndex: { type: "number" },
    sayEs: { type: "string" },
    meaningEn: { type: "string" },
    intent: { type: "string", enum: [...coachIntents] },
    phase: { type: "string", enum: [...coachPhases] },
    expectedCommunicativeFunction: { type: "string" },
    tool: {
      type: "object",
      additionalProperties: false,
      required: ["type", "primaryEs", "primaryEn", "exampleEs", "noteEn", "options"],
      properties: {
        type: { type: "string", enum: [...coachToolTypes] },
        primaryEs: nullableString,
        primaryEn: nullableString,
        exampleEs: nullableString,
        noteEn: nullableString,
        options: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["labelEn", "scenarioEn"],
                properties: {
                  labelEn: { type: "string" },
                  scenarioEn: { type: "string" },
                },
              },
            },
            { type: "null" },
          ],
        },
      },
    },
    evidence: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["observedBlocker", "confidence", "noteEn"],
          properties: {
            observedBlocker: { type: "string" },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            noteEn: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    selfReportedBlocker: {
      anyOf: [{ type: "string", enum: [...selfReportedBlockers] }, { type: "null" }],
    },
    sceneCharacter: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "relation", "traitEn"],
          properties: {
            name: { type: "string" },
            relation: { type: "string" },
            traitEn: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    done: { type: "boolean" },
    doneReason: nullableString,
  },
} as const;
