import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthedUser } from "@/lib/auth-user";
import { eventStatuses, type EventBeat, type EventStatus, type StoredEvent } from "@/lib/event-schema";
import { maxBeats } from "@/lib/event-plan";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * The dreaded events a learner has planned, and the goes they have left before each one.
 *
 * **It cannot ride on `/api/library`.** That route 401s without a session, and the whole design of
 * `/dash` is that it works before anyone signs in -- somebody says "dinner at her parents on
 * friday" at the door, and the plan has to exist whether or not they ever make an account. So
 * identity here is the same anonymous pattern saved runs already use: the browser's
 * `outloud-session-id`, with the row claimed to a real `user_id` the first time an authed request
 * arrives from that device.
 *
 * Not a security boundary, and it should not pretend to be one: anyone holding a session id can
 * read the events planned against it, exactly as anyone holding a moment's link can read that.
 * What it does enforce is that a write names an event that belongs to the caller.
 */

const uuid = z.string().uuid();

const beatSchema = z.object({
  index: z.number().int().min(0).max(maxBeats - 1),
  titleEn: z.string().min(1).max(200),
  situationEn: z.string().min(1).max(800),
  characterName: z.string().min(1).max(80),
  characterRelation: z.string().max(160),
  characterTraitEn: z.string().max(300),
  targetCommunicativeFunction: z.string().max(300),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  momentId: z.string().max(80).nullable(),
  completedAt: z.string().max(40).nullable(),
});

const createSchema = z.object({
  id: uuid,
  sessionId: uuid,
  said: z.string().min(1).max(1200),
  nameEn: z.string().min(1).max(120),
  situationEn: z.string().min(1).max(600),
  whoEn: z.string().max(300).nullable().default(null),
  whenSaid: z.string().max(300).nullable().default(null),
  happensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  timezone: z.string().max(80).nullable().default(null),
  beats: z.array(beatSchema).min(2).max(maxBeats),
});

/**
 * Four separate things a learner can do to an event, kept as four shapes rather than one bag of
 * optional fields: "a beat is finished" and "the evening has been and gone" are different events
 * in their life, and a partial update that silently did both would be a bug nobody could see.
 */
const patchSchema = z.object({
  id: uuid,
  sessionId: uuid,
  /** Beat 1 finished and produced the rescue every later beat starts its scene from. */
  rescue: z.unknown().optional(),
  focusBlocker: z.string().max(80).nullable().optional(),
  /** A beat was done. */
  beat: z
    .object({
      index: z.number().int().min(0).max(maxBeats - 1),
      momentId: z.string().max(80).nullable(),
      completedAt: z.string().max(40),
    })
    .optional(),
  /** The evening happened, and they said how it went. Stored verbatim and unclassified. */
  outcomeSaid: z.string().max(1200).optional(),
  /** Whether they got to say any of it. One tap, no model -- see the mastery ladder. */
  outcomeSpoke: z.boolean().nullable().optional(),
  status: z.enum(eventStatuses).optional(),
});

type EventRow = {
  id: string;
  created_at: string;
  said: string;
  name_en: string;
  situation_en: string;
  who_en: string | null;
  when_said: string | null;
  happens_on: string | null;
  status: string;
  plan_json: unknown;
  rescue_json: unknown;
  focus_blocker: string | null;
  outcome_said: string | null;
  outcome_at: string | null;
  outcome_spoke: boolean | null;
};

const columns =
  "id, created_at, said, name_en, situation_en, who_en, when_said, happens_on, status, plan_json, rescue_json, focus_blocker, outcome_said, outcome_at, outcome_spoke";

function toStoredEvent(row: EventRow): StoredEvent {
  const beats = Array.isArray(row.plan_json) ? (row.plan_json as EventBeat[]) : [];
  return {
    id: row.id,
    createdAt: row.created_at,
    said: row.said,
    nameEn: row.name_en,
    situationEn: row.situation_en,
    whoEn: row.who_en,
    whenSaid: row.when_said,
    happensOn: row.happens_on,
    status: (eventStatuses as readonly string[]).includes(row.status) ? (row.status as EventStatus) : "planned",
    beats,
    rescue: row.rescue_json ?? null,
    focusBlocker: row.focus_blocker,
    outcomeSaid: row.outcome_said,
    outcomeAt: row.outcome_at,
    outcomeSpoke: row.outcome_spoke,
  };
}

export async function GET(request: Request) {
  const limited = checkRateLimit(request, "events-read", 300, 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const supabase = getSupabaseAdmin();
  // Not an error. A learner with no database behind them still gets the rest of the screen, and
  // saying "planned practice is not connected" on a page that otherwise works reads as broken.
  if (!supabase) return NextResponse.json({ ok: true, events: [] });

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const user = await getAuthedUser(request, supabase);
  if (!user && (!sessionId || !uuid.safeParse(sessionId).success)) {
    return NextResponse.json({ ok: true, events: [] });
  }

  // Signed in on the device that planned them: they are this person's events from now on. Same
  // move as /api/library claiming moments by email, one step earlier in the funnel.
  if (user && sessionId && uuid.safeParse(sessionId).success) {
    await supabase.from("events").update({ user_id: user.id }).eq("session_id", sessionId).is("user_id", null);
  }

  let query = supabase.from("events").select(columns).is("deleted_at", null);
  query = user && sessionId ? query.or(`user_id.eq.${user.id},session_id.eq.${sessionId}`) : user ? query.eq("user_id", user.id) : query.eq("session_id", sessionId!);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(10);
  if (error) return NextResponse.json({ error: "Could not load your planned events." }, { status: 502 });

  return NextResponse.json({ ok: true, events: ((data ?? []) as EventRow[]).map(toStoredEvent) });
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "events-write", Number(process.env.MAX_EVENTS_PER_DAY ?? 20), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Planned practice is not connected yet." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That event is incomplete." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "That event is incomplete." }, { status: 400 });

  const user = await getAuthedUser(request, supabase);
  const now = new Date().toISOString();

  // The FK needs a session row to point at. Ignoring duplicates keeps a returning device on the
  // one it already has -- same upsert the moment save does.
  const sessionInsert = await supabase.from("sessions").upsert(
    {
      id: parsed.data.sessionId,
      anonymous_identifier: parsed.data.sessionId,
      created_at: now,
      last_seen_at: now,
      device_json: { userAgent: request.headers.get("user-agent") ?? null },
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (sessionInsert.error) return NextResponse.json({ error: "Could not save that event." }, { status: 502 });

  const { data, error } = await supabase
    .from("events")
    .insert({
      id: parsed.data.id,
      session_id: parsed.data.sessionId,
      user_id: user?.id ?? null,
      created_at: now,
      said: parsed.data.said,
      name_en: parsed.data.nameEn,
      situation_en: parsed.data.situationEn,
      who_en: parsed.data.whoEn,
      when_said: parsed.data.whenSaid,
      happens_on: parsed.data.happensOn,
      timezone: parsed.data.timezone,
      status: "planned",
      plan_json: parsed.data.beats,
    })
    .select(columns)
    .single<EventRow>();

  if (error || !data) return NextResponse.json({ error: "Could not save that event." }, { status: 502 });
  return NextResponse.json({ ok: true, event: toStoredEvent(data) });
}

export async function PATCH(request: Request) {
  const limited = checkRateLimit(request, "events-write", Number(process.env.MAX_EVENTS_PER_DAY ?? 20) * 8, 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Planned practice is not connected yet." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That update is incomplete." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "That update is incomplete." }, { status: 400 });

  const user = await getAuthedUser(request, supabase);
  const { data: existing, error: readError } = await supabase
    .from("events")
    .select(`${columns}, session_id, user_id`)
    .eq("id", parsed.data.id)
    .is("deleted_at", null)
    .maybeSingle<EventRow & { session_id: string | null; user_id: string | null }>();

  if (readError) return NextResponse.json({ error: "Could not reach that event." }, { status: 502 });
  if (!existing) return NextResponse.json({ error: "That event is gone." }, { status: 404 });

  const owns = existing.session_id === parsed.data.sessionId || (user && existing.user_id === user.id);
  if (!owns) return NextResponse.json({ error: "That event is not yours." }, { status: 403 });

  const update: Record<string, unknown> = {};

  if (parsed.data.rescue !== undefined) update.rescue_json = parsed.data.rescue;
  if (parsed.data.focusBlocker !== undefined) update.focus_blocker = parsed.data.focusBlocker;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;

  if (parsed.data.beat) {
    const beats = Array.isArray(existing.plan_json) ? ([...existing.plan_json] as EventBeat[]) : [];
    const target = beats.findIndex((beat) => beat.index === parsed.data.beat!.index);
    if (target < 0) return NextResponse.json({ error: "That go is not part of this event." }, { status: 400 });
    beats[target] = { ...beats[target], momentId: parsed.data.beat.momentId, completedAt: parsed.data.beat.completedAt };
    update.plan_json = beats;
    // Doing one is what turns a plan into something under way, unless it is already further on.
    if (existing.status === "planned") update.status = "running";
  }

  if (parsed.data.outcomeSaid !== undefined) {
    update.outcome_said = parsed.data.outcomeSaid;
    update.outcome_at = new Date().toISOString();
    update.status = "answered";
  }
  if (parsed.data.outcomeSpoke !== undefined) update.outcome_spoke = parsed.data.outcomeSpoke;

  if (!Object.keys(update).length) return NextResponse.json({ ok: true, event: toStoredEvent(existing) });

  const { data, error } = await supabase
    .from("events")
    .update(update)
    .eq("id", parsed.data.id)
    .select(columns)
    .single<EventRow>();

  if (error || !data) return NextResponse.json({ error: "Could not update that event." }, { status: 502 });

  /*
   * The top of the mastery ladder is labelled "you used it for real", and until now nothing in
   * the app could ever honestly put anybody there: `deriveReviewLedgerState` infers it from a
   * perfect transfer evaluation, which is practice, not real life. Somebody telling us they went
   * to the dinner AND got some of it out is the first evidence that matches the label.
   *
   * Only on a yes. Going and freezing is not mastery, and turning up is not either -- which is
   * exactly why the question is asked separately from "how did it go?" instead of being read out
   * of whatever they said.
   */
  if (parsed.data.outcomeSpoke === true) {
    await supabase
      .from("moments")
      .update({ ledger_state: "confirmed_real_life" })
      .eq("event_id", parsed.data.id)
      .is("deleted_at", null);
  }

  return NextResponse.json({ ok: true, event: toStoredEvent(data) });
}
