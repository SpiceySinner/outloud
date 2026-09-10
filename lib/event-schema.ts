import { z } from "zod";

/**
 * A real thing that is about to happen to the learner, and the handful of goes we lay out
 * between now and then. Master plan #30: "build backward from one real dreaded event."
 *
 * Why this is its own engine rather than a mode on an existing one:
 *
 * - `/api/coach` is the intake. It needs somebody to have TRIED something; an event is named
 *   before anyone has tried anything.
 * - `/api/variation` builds a nearby situation from a moment that already happened, backwards
 *   from a rescue. This builds forwards, from a date, with no rescue in existence yet.
 * - `/api/intent` classifies one sentence and must stay that small.
 *
 * The division of labour inside this feature is the one that runs through the whole app: **the
 * model writes content, deterministic code owns counts and dates.** How many goes there are and
 * which day each falls on come from `lib/event-plan.ts`, never from the model. What each go IS
 * comes from the model, because only it can tell that a dinner has an arrival, a table and a
 * goodbye.
 */

export const eventStatuses = ["planned", "running", "done", "answered", "abandoned"] as const;
export type EventStatus = (typeof eventStatuses)[number];

/**
 * One go at the event, as the planner writes it. No dates here -- see `lib/event-plan.ts`.
 *
 * The character fields are #29 (name the person you are about to talk to). Naming them is
 * in-house behaviour the coach already does; giving them a history the learner never mentioned
 * is not, and the prompt says so.
 */
export const plannedBeatSchema = z.object({
  /**
   * What this go is, in the learner's register: "the bit where her mum asks what you do".
   * Lowercase and speakable, because `/dash` reads it out loud.
   */
  titleEn: z.string(),
  /** The scene itself, one sentence, as `scenarioContext` for `/api/converse`. */
  situationEn: z.string(),
  /** First name only. */
  characterName: z.string(),
  /** Their relation to the learner, e.g. "your girlfriend's mother". */
  characterRelation: z.string(),
  /** The one trait that makes them hard to talk to. */
  characterTraitEn: z.string(),
  /** What the learner has to be able to DO in this beat, e.g. "explain what your job involves". */
  targetCommunicativeFunction: z.string(),
});

export type PlannedBeat = z.infer<typeof plannedBeatSchema>;

export const eventPlanResponseSchema = z.object({
  /**
   * What to call this on the screen: a few words, the way they would refer to it themselves.
   *
   * `situationEn` is a sentence and cannot go in a header. This is the noun phrase that can --
   * "the dinner at her parents", "the landlord call" -- and it is the name the app then uses
   * every time it brings the event up, so it has to sound like theirs rather than like a record.
   */
  nameEn: z.string(),
  /**
   * The resolved date as `YYYY-MM-DD`, or null.
   *
   * Null is a first-class answer and the route double-checks it: a date the learner never named
   * is the same failure as a resumed session nobody asked for. Undated events still get a plan.
   */
  happensOn: z.string().nullable(),
  /**
   * The exact words from their own sentence that pinned the date, copied verbatim. Null when
   * nothing did.
   *
   * This is what turns "never invent a date" from an instruction into something the server can
   * check: the fragment has to actually appear in what they said, and it has to name a time. It
   * is the same move as the router only being allowed to return an id it was handed -- a claim
   * the model makes about the input, verifiable against the input.
   */
  dateFromWords: z.string().nullable(),
  /** The arc of the occasion, in the order the occasion happens. */
  beats: z.array(plannedBeatSchema),
  /**
   * Which beat is the one they are actually dreading, as an index into `beats`.
   *
   * It exists because the arc has to be thinned when there is not much time, and thinning by
   * position throws the wrong thing away: "I have to call the landlord tomorrow" came back as
   * the hello and the goodbye, with the complaint about the heating -- the entire reason for the
   * call -- dropped out of the middle. Position cannot tell which beat is the point. This can.
   */
  hardestBeat: z.number(),
});

export type EventPlanResponse = z.infer<typeof eventPlanResponseSchema>;

/** Hand-written twin of the Zod schema above. Both change together or neither is correct. */
export const eventPlanResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nameEn", "happensOn", "dateFromWords", "beats", "hardestBeat"],
  properties: {
    nameEn: { type: "string" },
    happensOn: { type: ["string", "null"] },
    dateFromWords: { type: ["string", "null"] },
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "titleEn",
          "situationEn",
          "characterName",
          "characterRelation",
          "characterTraitEn",
          "targetCommunicativeFunction",
        ],
        properties: {
          titleEn: { type: "string" },
          situationEn: { type: "string" },
          characterName: { type: "string" },
          characterRelation: { type: "string" },
          characterTraitEn: { type: "string" },
          targetCommunicativeFunction: { type: "string" },
        },
      },
    },
    hardestBeat: { type: "number" },
  },
} as const;

/**
 * A planned beat once it has a place in the calendar and a life of its own.
 *
 * `dueOn` is null for an undated event: those beats come in order whenever the learner returns,
 * which is honest about the fact that there is no deadline to count down to.
 */
export type EventBeat = PlannedBeat & {
  index: number;
  /** `YYYY-MM-DD`, or null when the event has no date. */
  dueOn: string | null;
  /** The saved run this beat produced, once it has been done. */
  momentId: string | null;
  completedAt: string | null;
};

/** What `/api/events` hands the client. Mirrors the row, minus anything server-only. */
export type StoredEvent = {
  id: string;
  createdAt: string;
  said: string;
  nameEn: string;
  situationEn: string;
  whoEn: string | null;
  whenSaid: string | null;
  happensOn: string | null;
  status: EventStatus;
  beats: EventBeat[];
  /** Present once beat 1 has run. Every later beat starts its scene from it. */
  rescue: unknown | null;
  focusBlocker: string | null;
  outcomeSaid: string | null;
  outcomeAt: string | null;
  outcomeSpoke: boolean | null;
};
