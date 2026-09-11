import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth-user";
import { maxResurfaces, nextDueAt } from "@/lib/phrase-recall";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * The signed-in learner's collected words and frames. Written at the end of a session (the
 * verdict card's "save"), read by the dashboard.
 *
 * Since 2026-09-07 it is also the recall queue. Every saved phrase gets a date to come back on,
 * and PATCH records what happened when it did. The schedule lives on the phrase's own row rather
 * than in a second table because the unique index already guarantees one row per phrase per
 * learner, and a second copy of the Spanish string is the drift this codebase keeps paying for.
 */

const wordSchema = z.object({
  spanish: z.string().min(1).max(160),
  meaningEn: z.string().max(240).nullable().optional(),
  /**
   * `asked` is the odd one out: every other source is a phrase WE handed over mid-session, and
   * this is the only one the learner went looking for. They were curious enough to ask,
   * unprompted, which is a stronger cue than anything we would have chosen for them.
   *
   * That no longer decides whether it comes back — everything saved does — but it still decides
   * what comes back FIRST. `duePhrases` sorts on it.
   */
  source: z.enum(["coach_tool", "rescue_phrase", "rescue_pattern", "asked"]).optional().default("coach_tool"),
});

const requestSchema = z.object({
  momentId: z.string().uuid().nullable().optional(),
  words: z.array(wordSchema).min(1).max(30),
});

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Saved practice is not connected yet." }, { status: 503 });

  const user = await getAuthedUser(request, supabase);
  if (!user) return NextResponse.json({ error: "Sign in to keep your words." }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Those words could not be saved." }, { status: 400 });

  const rows = parsed.data.words.map((word) => ({
    user_id: user.id,
    moment_id: parsed.data.momentId ?? null,
    spanish: word.spanish.trim(),
    meaning_en: word.meaningEn?.trim() || null,
    source: word.source,
    /*
     * Every saved phrase gets a date. (Timo, 2026-09-11.)
     *
     * This used to read `word.source === "asked"`, on the argument that queueing everything would
     * "make every scene a quiz within a week". That argument was wrong, and wrong in a way worth
     * writing down: **the pool size does not set the frequency.** `pickForScene` returns at most
     * one phrase and skips two scenes in three no matter how many are due, so widening the pool
     * changes WHICH phrase comes back, never HOW OFTEN one does.
     *
     * What it did instead was make the closing card lie. That card promises "we'll bring this back
     * in a new situation, with a little less help" about the phrases from the session -- which are
     * `coach_tool` and `rescue_*`, every one of them excluded here. So the one screen where we ask
     * for an account was arguing for it with a thing that could not happen.
     *
     * A re-save restarts the clock, deliberately: the same phrase coming back out of a second
     * session is evidence they are still reaching for it, and that is a reason to schedule it
     * afresh rather than leave it where it was.
     */
    due_at: nextDueAt(0),
  }));

  // The unique index is on (user_id, lower(spanish)), so a repeated phrase updates its meaning
  // and moment link rather than piling up duplicates.
  const { error } = await supabase.from("word_bank").upsert(rows, { onConflict: "user_id,spanish" });
  if (error) {
    // Fall back to inserting only the phrases this learner does not have yet: some Postgres
    // versions cannot use an expression index as an ON CONFLICT target.
    const { data: existing } = await supabase.from("word_bank").select("spanish").eq("user_id", user.id);
    const known = new Set((existing ?? []).map((row) => String(row.spanish).toLowerCase()));
    const fresh = rows.filter((row) => !known.has(row.spanish.toLowerCase()));
    if (!fresh.length) return NextResponse.json({ ok: true, saved: 0 });
    const retry = await supabase.from("word_bank").insert(fresh);
    if (retry.error) return NextResponse.json({ error: "Those words could not be saved." }, { status: 502 });
    return NextResponse.json({ ok: true, saved: fresh.length });
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}

export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Saved practice is not connected yet." }, { status: 503 });

  const user = await getAuthedUser(request, supabase);
  if (!user) return NextResponse.json({ error: "Sign in to see your words." }, { status: 401 });

  const { data, error } = await supabase
    .from("word_bank")
    .select(
      "id, spanish, meaning_en, source, times_practiced, last_practiced_at, created_at, due_at, resurfaced_count, landed_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Could not load your words." }, { status: 502 });

  return NextResponse.json({ ok: true, words: data ?? [] });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  /**
   * `resurfaced` -- it was put in front of them in a scene. `landed` -- they produced it there,
   * unaided. The client decides which, because the client is the only thing that saw the scene;
   * the server owns what each one MEANS for the schedule, because a date nobody can argue with is
   * the whole reason this is not in a prompt.
   */
  outcome: z.enum(["resurfaced", "landed"]),
});

export async function PATCH(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Saved practice is not connected yet." }, { status: 503 });

  const user = await getAuthedUser(request, supabase);
  if (!user) return NextResponse.json({ error: "Sign in to keep your words." }, { status: 401 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That phrase could not be updated." }, { status: 400 });

  // Scoped to this user on the read as well as the write: `word_bank` is service-role only, so an
  // id from somewhere else would otherwise be a way to move another learner's schedule.
  const { data: row } = await supabase
    .from("word_bank")
    .select("id, resurfaced_count, landed_at")
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "That phrase is not yours." }, { status: 404 });

  // Landing is once and final. A phrase they have produced alone is theirs, and a later scene
  // that happened to contain it again must not reopen the question.
  if (row.landed_at) return NextResponse.json({ ok: true, changed: false });

  if (parsed.data.outcome === "landed") {
    const { error } = await supabase
      .from("word_bank")
      .update({ landed_at: new Date().toISOString(), last_practiced_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "That phrase could not be updated." }, { status: 502 });
    return NextResponse.json({ ok: true, changed: true, landed: true });
  }

  const count = Number(row.resurfaced_count ?? 0) + 1;
  // Past the cap it stops being scheduled at all rather than being deleted: they asked for it, and
  // the row is still the record of that. `duePhrases` reads the count and leaves it alone.
  const { error } = await supabase
    .from("word_bank")
    .update({ resurfaced_count: count, due_at: count >= maxResurfaces ? null : nextDueAt(count) })
    .eq("id", row.id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "That phrase could not be updated." }, { status: 502 });
  return NextResponse.json({ ok: true, changed: true, resurfacedCount: count });
}
