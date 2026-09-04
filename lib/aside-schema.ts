import { z } from "zod";

import type { BlockerType } from "@/lib/types";

/**
 * The "step out" conversation: the learner leaves the roleplay mid-scene and talks to the coach,
 * in English, about what is actually in their way.
 *
 * Why this is its own engine rather than a mode on an existing one:
 *
 * - `/api/converse` IS the character. It cannot step outside the fiction without stopping being
 *   the person the learner is talking to, which is the one thing the scene depends on.
 * - `/api/coach` is the intake conversation and is driven entirely by turn index
 *   (`phaseForTurn`), so a mid-session detour would have to fight that state machine for every
 *   turn it borrowed.
 * - `/api/lifeline` (the `ask` chip) answers exactly one question and keeps no history. It is a
 *   dictionary, not a conversation.
 *
 * The register is the whole point and the easiest thing to lose: the learner has just said "hold
 * on, this isn't my problem". Answering that with a Spanish lesson is the failure mode. The coach
 * listens first, asks ONE question, and only reaches for a concrete move once it can name what
 * the learner actually wants changed.
 */

/**
 * listen  - take in what they said, no question yet. Only for the first beat of a real vent.
 * probe   - one question that narrows what is actually wrong.
 * reframe - say back what you now think the problem is, in their words.
 * offer   - name a concrete move and attach it to `offer`.
 * close   - the aside is finished; the offer carries what happens next.
 */
export const asideIntents = ["listen", "probe", "reframe", "offer", "close"] as const;
export type AsideIntent = (typeof asideIntents)[number];

/**
 * resume          - back to the same scene, nothing changed. The honest default: most asides are
 *                   someone thinking out loud, and inventing a change for them is worse than none.
 * change_scenario - the situation itself is wrong for them. New scene, new person.
 * change_focus    - the situation is fine, the diagnosis is not. Re-points the focus line and,
 *                   through `assistanceOrderFor`, the order of the help ladder.
 */
export const asideOfferKinds = ["resume", "change_scenario", "change_focus"] as const;
export type AsideOfferKind = (typeof asideOfferKinds)[number];

/**
 * What `change_focus` is allowed to point at: every `BlockerType` except `insufficient_evidence`,
 * which means "we have not seen enough yet". That is a state of the evaluator, never something a
 * learner can ask to work on.
 *
 * Spelled out as a tuple rather than filtered from `blockerTypes` so Zod gets a literal union
 * instead of `string[]`; the `satisfies` keeps it honest against the type it draws from.
 */
export const redirectableBlockers = [
  "vocabulary_retrieval",
  "sentence_assembly",
  "hesitation_pressure",
  "pronunciation_intelligibility",
  "grammar_control",
  "naturalness_register",
  "follow_up_pressure",
] as const satisfies readonly BlockerType[];

export const asideResponseSchema = z.object({
  turnIndex: z.number().int().min(0).max(8),
  /** What the coach says, in English. Spoken aloud, so: one idea, short. */
  sayEn: z.string().min(1),
  intent: z.enum(asideIntents),
  offer: z
    .object({
      kind: z.enum(asideOfferKinds),
      /** Button text, 2-5 words, lowercase. */
      labelEn: z.string(),
      /** One quiet line under the button saying what changes and why. */
      reasonEn: z.string(),
      /** change_focus only. */
      newFocus: z.enum(redirectableBlockers).nullable(),
      /** change_scenario only: one sentence describing the new scene. */
      newScenarioEn: z.string().nullable(),
      /** change_scenario only: who is in it, in the same shape the coach's scenario turn uses. */
      newCharacter: z
        .object({
          name: z.string(),
          relation: z.string(),
          traitEn: z.string(),
        })
        .nullable(),
    })
    .nullable(),
  done: z.boolean(),
});

export type AsideResponse = z.infer<typeof asideResponseSchema>;

export const asideResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["turnIndex", "sayEn", "intent", "offer", "done"],
  properties: {
    turnIndex: { type: "number" },
    sayEn: { type: "string" },
    intent: { type: "string", enum: [...asideIntents] },
    offer: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "labelEn", "reasonEn", "newFocus", "newScenarioEn", "newCharacter"],
          properties: {
            kind: { type: "string", enum: [...asideOfferKinds] },
            labelEn: { type: "string" },
            reasonEn: { type: "string" },
            newFocus: {
              anyOf: [{ type: "string", enum: [...redirectableBlockers] }, { type: "null" }],
            },
            newScenarioEn: { type: ["string", "null"] },
            newCharacter: {
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
          },
        },
        { type: "null" },
      ],
    },
    done: { type: "boolean" },
  },
} as const;
