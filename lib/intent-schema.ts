import { z } from "zod";

/**
 * What the learner said on the way in, turned into one of the things the app can act on.
 *
 * See `VOICE_ENTRY.md` for the design. The short version: a microphone offers no vocabulary, so
 * the header teaches what to say and this decides what was said. Both halves ship together --
 * inviting someone to describe their week and then running the default intake anyway is the
 * failure this whole engine exists to prevent.
 *
 * Why its own engine rather than a mode on an existing one:
 *
 * - `/api/coach` is the intake and is driven entirely by turn index. Routing has no turns.
 * - `/api/converse` IS a character in a scene. There is no scene yet when this runs.
 * - `/api/aside` is the closest relative and the wrong shape: it is a conversation that ends in an
 *   offer, five turns long. This is one turn, no conversation, no persuasion.
 *
 * It classifies and it reads back. It does not teach, does not correct, and never judges the
 * Spanish -- the evaluator has not run and has nothing to say yet.
 */

/**
 * resume       - something already open: a saved moment, or the next go at a planned event.
 * new_scenario - a real situation from their life they want to practise. #30, and it runs now:
 *                the event is dated, broken into the goes there is time for, and worked through
 *                one at a time. See `lib/event-plan.ts`.
 * ask_phrase   - a QUESTION: there is something they want to be able to say. "how do I say I’ll
 *                take care of it". Answered by `/api/lifeline`, which already runs with no scene,
 *                and then they have to SAY it — which is the attempt every engine downstream
 *                needs. See `docs/features/router-talk-feat.md`.
 * stung        - a real moment where it did not come out. "I froze at the pharmacy today." The
 *                room’s existing `stung` intake is built for exactly this; it just never had a
 *                way in from here.
 * talk         - open-ended conversation, and the one intent that will never get an engine:
 *                `more-xavier-stuff.md` lists free-chat mode under the hard bans. Kept as its own
 *                answer because "we understood you and we are not doing that" is a different
 *                sentence from "we did not catch that", and the learner deserves the true one.
 * unclear      - a first-class outcome, never a fallback. Silently starting the default intake
 *                after someone has told you what they wanted is the trust-killer.
 *
 * The three used to be one label. They wanted three different answers, and two of them had
 * engines sitting unused, so the label split rather than growing a mode.
 */
export const entryIntents = ["resume", "new_scenario", "ask_phrase", "stung", "talk", "unclear"] as const;
export type EntryIntent = (typeof entryIntents)[number];

export const intentResponseSchema = z.object({
  intent: z.enum(entryIntents),
  /**
   * The contract line, shown before anything happens. In THEIR words, never a category:
   * "friday. her parents. her mum talks fast." -- not "starting a new scenario."
   *
   * Empty on `unclear`, and the server treats an empty one on any other intent as `unclear`:
   * acting without showing what was understood is the thing this field exists to stop.
   */
  readBackEn: z.string(),
  /** resume only: which open thing they meant. Validated against what we sent. */
  resumeId: z.string().nullable(),
  /**
   * Shared by `new_scenario` and `stung`, because the shape is the same either way: a real
   * situation of theirs, with whoever is in it and whenever it is. The intent is what says which
   * tense the room plays it in — `stung` already happened, `new_scenario` has not yet.
   *
   * Required on `new_scenario` and on `stung`: an intent that names a situation without carrying
   * one is downgraded to `unclear` rather than acted on.
   */
  scenario: z
    .object({
      /** One sentence, as they described it. */
      situationEn: z.string(),
      /** Who is in it, if they said. */
      whoEn: z.string().nullable(),
      /** When it is, if they said. A date is what makes this a deadline instead of a topic. */
      whenEn: z.string().nullable(),
    })
    .nullable(),
  /**
   * ask_phrase only: what they want to be able to say, in English, as a sentence they could mean.
   * "how do I say I’ll take care of it" -> "I’ll take care of it."
   *
   * This is the one field the whole chain hangs on. It becomes `originalText` in the rescue, which
   * is the thing normally missing when there is no scene — and here it is simply what they asked
   * for. Strip the asking off it: what is left has to be the sentence itself.
   */
  askEn: z.string().nullable(),
  /** talk only: what they want to talk about. Kept for the refusal copy, which names it back. */
  topicEn: z.string().nullable(),
});

export type IntentResponse = z.infer<typeof intentResponseSchema>;

/** Hand-written twin of the Zod schema above. Both change together or neither is correct. */
export const intentResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "readBackEn", "resumeId", "scenario", "askEn", "topicEn"],
  properties: {
    intent: { type: "string", enum: [...entryIntents] },
    readBackEn: { type: "string" },
    resumeId: { type: ["string", "null"] },
    scenario: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["situationEn", "whoEn", "whenEn"],
          properties: {
            situationEn: { type: "string" },
            whoEn: { type: ["string", "null"] },
            whenEn: { type: ["string", "null"] },
          },
        },
        { type: "null" },
      ],
    },
    askEn: { type: ["string", "null"] },
    topicEn: { type: ["string", "null"] },
  },
} as const;

/**
 * Which intents this build can actually carry out.
 *
 * `new_scenario` joined the list on 2026-09-07, when #30 got an engine: a named event is dated,
 * broken into the goes there is time for, and run one at a time. Before that it took the honest
 * refusal in section 7 of `VOICE_ENTRY.md`, which is what collected the evidence for building it.
 *
 * `stung` joined on 2026-09-07 and needed no engine at all: the room has had a `stung` intake
 * since long before the entry screen existed, and this only gave it a way in.
 *
 * `ask_phrase` joined the same day. Its chain is the only genuinely new one: the lifeline answers
 * the question, the learner has to SAY the answer, and that is the attempt every engine downstream
 * has always needed and never had outside a session.
 *
 * `talk` — the genuinely open-ended one — is not "not yet". It is never: free-chat mode is a
 * hard ban in `more-xavier-stuff.md`. It stays on the list of things we can NAME so we can say so
 * honestly, and off the list of things we can DO.
 *
 * This is the record of what has an engine. `/dash` branches on the intent itself rather than on
 * this list, so the two can drift: adding an intent here without a branch there leaves a learner
 * being told their thing is not built when it is. Both change in the same commit, or neither.
 */
export const runnableIntents = [
  "resume",
  "new_scenario",
  "stung",
  "ask_phrase",
] as const satisfies readonly EntryIntent[];

export function canRun(intent: EntryIntent) {
  return (runnableIntents as readonly EntryIntent[]).includes(intent);
}
