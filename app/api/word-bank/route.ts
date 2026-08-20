import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth-user";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * The signed-in learner's collected words and frames. Written at the end of a session (the
 * verdict card's "save"), read by the dashboard.
 */

const wordSchema = z.object({
  spanish: z.string().min(1).max(160),
  meaningEn: z.string().max(240).nullable().optional(),
  source: z.enum(["coach_tool", "rescue_phrase", "rescue_pattern"]).optional().default("coach_tool"),
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
    .select("id, spanish, meaning_en, source, times_practiced, last_practiced_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Could not load your words." }, { status: 502 });

  return NextResponse.json({ ok: true, words: data ?? [] });
}
