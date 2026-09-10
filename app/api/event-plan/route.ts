import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { eventPlanResponseJsonSchema, eventPlanResponseSchema, type EventPlanResponse } from "@/lib/event-schema";
import { beatCountFor, daysBetween, maxBeats, pickBeats } from "@/lib/event-plan";
import { buildMockEventPlan, isMockAiEnabled } from "@/lib/mock-ai";
import { backgroundModel } from "@/lib/model-config";
import { checkRateLimit, openAiRequestsPerDay } from "@/lib/rate-limit";

/**
 * The engine behind #30: one named event in, a date and an arc of practice out.
 *
 * Stateless, like `/api/intent` and `/api/aside`. It is called once when an event is created and
 * once more if the learner had to be asked when it is; there is nothing worth remembering between
 * those calls that the client is not already holding.
 *
 * **It writes content, not schedule.** How many goes there are and which day each falls on come
 * from `lib/event-plan.ts`, deterministically, and `beatCount` arrives here already decided. A
 * model left to schedule will produce "seven daily sessions" for a dinner three weeks away, which
 * is a promise the app then breaks.
 *
 * The one rule that outranks the others: **it never invents a date.** An undated event still gets
 * a plan and the screen says so plainly. An event with a made-up date sends somebody to rehearse
 * for the wrong night, and they only find out afterwards.
 */

const requestSchema = z.object({
  /** What they said, verbatim. English or Spanish -- they may describe their week in either. */
  said: z.string().min(1).max(1200),
  /** The router's reading of the situation. */
  situationEn: z.string().min(1).max(600),
  whoEn: z.string().max(300).nullable().optional().default(null),
  /** Their words for when, if they gave any. Kept separate so the date guard can see them. */
  whenSaid: z.string().max(300).nullable().optional().default(null),
  /**
   * Today, where the LEARNER is. The server has no idea, and a countdown that is a day out
   * because of a timezone is exactly the kind of small lie this app cannot afford.
   */
  todayIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  todayWeekday: z.string().max(20),
  timezone: z.string().max(80).nullable().optional().default(null),
});

type PlanInput = z.infer<typeof requestSchema>;

const systemPrompt = [
  "You plan practice for one real thing that is about to happen to a Spanish learner. They said it out loud a moment ago. You do two jobs and nothing else: work out WHEN it is, and break it into the goes they get before then.",
  "",
  "# The date",
  "happensOn is the calendar date of the event as YYYY-MM-DD, or null.",
  'Resolve it only from what they actually said, relative to the today you are given. "friday" is the next friday. "tomorrow" is the day after today. "the 14th" is the next 14th.',
  'If they did not pin a day -- "soon", "in a few weeks", "at some point", or nothing at all -- happensOn is null. That is a correct answer and not a failure.',
  "NEVER invent a date. An event with no date still gets a plan. An event with a made-up date sends somebody to rehearse for the wrong night, and they find out afterwards.",
  'dateFromWords: the words from THEIR sentence that pinned it, copied exactly as they said them -- "on friday", "the 14th", "christmas". Null when happensOn is null. If you cannot quote them, you did not read a date, you guessed one.',
  "",
  "# The name",
  'nameEn is what the app calls this from now on, every time it brings it up: a short noun phrase in their words, lowercase, three or four words. "the dinner at her parents", "the landlord call", "your sister\'s wedding". Not a sentence, not a category, and never "Upcoming Event".',
  "",
  "# The beats",
  `Write exactly ${maxBeats} of them. How many goes somebody actually gets, and when, is not your decision -- write the whole arc and it will be thinned to fit the time there is.`,
  "They are the ARC OF THE OCCASION, in the order it happens: arriving and the first hello, the middle once it is going, the bit they are actually dreading, leaving. Not four paraphrases of one moment.",
  'Each beat is one scene with EXACTLY ONE person in it, and characterName is that one person\'s first name: "Elena". Never "Elena and Carlos", never "the bride and groom", never a role instead of a name. The app plays that person for the whole scene and cannot be two people at once, so a second name in that field leaves it with nobody to be. If several people are there, pick the one who makes THIS beat hard and leave the others in situationEn.',
  "Give them the one trait that makes them hard to talk to.",
  'titleEn is how the app will say this beat OUT LOUD: their register, lowercase, never a heading. "the bit where her mum asks what you do", never "Beat 2: extended family interaction".',
  'KEEP IT UNDER 45 CHARACTERS. It is printed on a phone next to the name of the event, on one line, and a long one wraps into a paragraph nobody reads. "the bit where the groom asks about your relationship to the couple" is too long; "the groom asks how you know them" is the same beat and fits.',
  'targetCommunicativeFunction is what they have to be able to DO, not a grammar point: "explain what your job involves", not "the present tense".',
  "hardestBeat is the index of the beat they are ACTUALLY dreading -- the reason they brought this up at all. For a call about the heating it is the complaint, not the hello. When there is not much time before the event this is the beat that survives, so getting it wrong costs them the one go that mattered.",
  "",
  "# What you must never do",
  "Never invent facts about their life. You may give a character a first name, because they need somebody to talk to -- but not a job, a history, or an opinion they never mentioned.",
  'Never make the event bigger than they described it. "dinner at my girlfriend\'s parents" is a dinner; nobody is giving a speech.',
  "Never teach, correct, or say anything about their Spanish. It has not been evaluated and you know nothing about it.",
  "Never write Spanish here. Describe the scenes in English; the Spanish happens later, live, with the character.",
].join("\n");

/**
 * Words that put a time on something, in both languages the learner may use.
 *
 * The prompt forbids inventing a date and this exists because forbidding is not preventing --
 * the same lesson `/api/intent` learned when "hmm okay so" came back as `resume`.
 *
 * It judges the short fragment the model claims it read the date from, never the whole sentence.
 * Checking the sentence was the first version and it was wrong in both directions: "dinner at my
 * parents in law" contains no time word but neither does the fragment, while "christmas with her
 * family" would have been refused a perfectly real date and then asked "when is it?" -- to which
 * the only answer is "christmas" again.
 */
const timeWords = new Set([
  // english
  "today", "tonight", "tomorrow", "morning", "afternoon", "evening", "night", "noon", "midnight",
  "week", "weeks", "weekend", "month", "months", "day", "days", "hour", "hours", "soon",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "weds", "thu", "thur", "thurs", "fri", "sat", "sun",
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  // spanish
  "hoy", "manana", "mañana", "noche", "tarde", "madrugada", "semana", "semanas",
  "mes", "meses", "dia", "día", "dias", "días", "pronto", "viene", "proxima", "próxima",
  "proximo", "próximo", "lunes", "martes", "miercoles", "miércoles", "jueves", "viernes",
  "sabado", "sábado", "domingo", "finde",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  // Days that name themselves. A learner saying "christmas" has told us when.
  "christmas", "xmas", "easter", "thanksgiving", "halloween", "eve", "year", "fortnight",
  "navidad", "nochebuena", "nochevieja", "reyes", "pascua", "santa", "ano", "año",
]);

/** A date, an ordinal, or a clock time written in digits: "14th", "12/03", "2026-09-11", "8pm". */
const timePattern = /\d{1,2}(st|nd|rd|th)\b|\d{1,2}[./-]\d{1,2}|\b\d{4}-\d{2}-\d{2}\b|\d{1,2}\s?(am|pm)\b/i;

export function mentionsATime(text: string) {
  if (timePattern.test(text)) return true;
  return text
    .toLowerCase()
    .replace(/[.,!?¿¡…"'`\-—–]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .some((word) => timeWords.has(word));
}

/**
 * The server owns whether a date is trustworthy; the model owns only what it read.
 *
 * Every check here ends in `null` rather than in a nearby guess, for the same reason `/api/intent`
 * downgrades to `unclear`: the costs are wildly asymmetric. No date costs a countdown. A wrong
 * date costs somebody the evening they were preparing for.
 */
function normalizePlan(generated: EventPlanResponse, input: PlanInput): EventPlanResponse {
  // Indices are tracked through the filter so `hardestBeat` still points at the same beat if an
  // empty one is dropped out from under it.
  const usable = generated.beats
    .map((beat, index) => ({ beat, index }))
    .filter(({ beat }) => beat.titleEn.trim() && beat.situationEn.trim())
    .slice(0, maxBeats);
  // One person per scene, enforced rather than requested. The room plays a single character and
  // its prompt forbids it to switch or rename -- "Elena and Carlos" in this field would leave it
  // with nobody to be. The prompt says so too; this is what happens when the prompt loses.
  const written = usable.map(({ beat }) => ({ ...beat, characterName: firstPersonOnly(beat.characterName) }));
  const hardest = usable.findIndex(({ index }) => index === generated.hardestBeat);

  let happensOn: string | null = generated.happensOn?.trim() || null;
  const quoted = generated.dateFromWords?.trim() || null;

  if (happensOn && !/^\d{4}-\d{2}-\d{2}$/.test(happensOn)) happensOn = null;
  if (happensOn && Number.isNaN(new Date(`${happensOn}T12:00:00Z`).getTime())) happensOn = null;
  // Already past: whatever it read, it did not read a date for something that has not happened.
  if (happensOn && happensOn < input.todayIso) happensOn = null;
  // Beyond a year is not a thing anyone is dreading yet; it is a misparse.
  if (happensOn && daysApart(input.todayIso, happensOn) > 365) happensOn = null;
  // The deterministic half of "never invent a date", in two parts. The words it says it read the
  // date from have to actually be in what they said -- the same rule as the router only being
  // allowed to return an id it was handed -- and those words have to name a time, so that quoting
  // "dinner" back at us does not pass for having read a date.
  if (happensOn && (!quoted || !appearsIn(quoted, `${input.said} ${input.whenSaid ?? ""}`))) happensOn = null;
  if (happensOn && !mentionsATime(quoted ?? "")) happensOn = null;

  // Only now is the count knowable: it depends on the date, which arrived in this same answer.
  const beats = pickBeats(
    written,
    beatCountFor(happensOn ? daysBetween(input.todayIso, happensOn) : null),
    hardest,
  );

  return {
    ...generated,
    nameEn: generated.nameEn.trim() || input.situationEn,
    happensOn,
    dateFromWords: happensOn ? quoted : null,
    beats,
    // Re-pointed at what survived, so the field still means something to whoever reads it.
    hardestBeat: Math.max(0, beats.indexOf(written[hardest] ?? beats[0])),
  };
}

/** Keeps the first person named and drops whoever was bolted on after them. */
function firstPersonOnly(name: string) {
  const first = name.split(/\s*(?:,|&|\band\b|\by\b)\s*/i)[0]?.trim();
  return first || name.trim();
}

/** Accent- and punctuation-blind containment, so a quote survives being transcribed either way. */
function appearsIn(fragment: string, text: string) {
  const flatten = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const needle = flatten(fragment);
  return needle.length > 0 && flatten(text).includes(needle);
}

function daysApart(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T12:00:00Z`).getTime();
  const to = new Date(`${toIso}T12:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

async function buildPlanFor(input: PlanInput): Promise<EventPlanResponse> {
  if (isMockAiEnabled()) return normalizePlan(buildMockEventPlan(input), input);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: backgroundModel(),
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          theySaid: input.said,
          situation: input.situationEn,
          who: input.whoEn,
          theirWordsForWhen: input.whenSaid,
          today: input.todayIso,
          todayIsA: input.todayWeekday,
          timezone: input.timezone,
        }),
      },
    ],
    // Low, but not as low as the router's: the beats are written text and want a little room.
    temperature: 0.35,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "event_plan",
        strict: true,
        schema: eventPlanResponseJsonSchema,
      },
    },
  });

  const generated = eventPlanResponseSchema.parse(JSON.parse(response.output_text));
  return normalizePlan(generated, input);
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "event-plan", openAiRequestsPerDay(), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That plan request is incomplete." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "That plan request is incomplete." }, { status: 400 });
  }

  if (!isMockAiEnabled() && !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OutLoud's planning AI is not connected yet." }, { status: 500 });
  }

  try {
    const plan = await buildPlanFor(parsed.data);
    // Fewer than two goes is not a plan. Better to say so than to hand back a single scene
    // dressed up as a run-up to something.
    if (plan.beats.length < 2) {
      return NextResponse.json({ error: "OutLoud could not lay that one out yet." }, { status: 502 });
    }
    return NextResponse.json(plan);
  } catch {
    return NextResponse.json({ error: "OutLoud could not lay that one out yet. Try again." }, { status: 502 });
  }
}
