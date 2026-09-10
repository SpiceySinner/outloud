import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthedUser } from "@/lib/auth-user";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const uuid = z.string().uuid();

/**
 * Everything the dashboard and profile pages show for a signed-in learner: their collected
 * words plus the sessions they saved, newest first.
 */

type MomentRow = {
  id: string;
  created_at: string;
  original_text: string;
  rescue_json: unknown;
  ledger_state: string | null;
  retrieval_due_at: string | null;
};

export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Saved practice is not connected yet." }, { status: 503 });

  const user = await getAuthedUser(request, supabase);
  if (!user) return NextResponse.json({ error: "Sign in to see your saved work." }, { status: 401 });

  /*
   * Runs saved before the account existed, claimed once so the dashboard shows a learner's whole
   * history rather than only what came after signing up.
   *
   * There are TWO ways in, because there are two ways a run gets saved without an account, and
   * for a long time only one of them was handled:
   *
   *   by email      -- they typed a real address into the box on the closing card.
   *   by session id -- they typed nothing. The run is stored against the browser's identity with
   *                    the synthetic `anonymous+<session-id>@outloud.local` in the email column,
   *                    which by construction can never equal anybody's real address. Claiming by
   *                    email alone therefore never reached these rows: the practice was saved and
   *                    permanently unreachable, while the closing card promised it would come
   *                    with them.
   *
   * `/api/events` has done the session-id half since #30 and its own comment named this as the
   * missing piece one route over. This is that piece.
   *
   * The trade, stated: signing in on a shared browser claims whatever anonymous practice is
   * sitting in it. That is the same trust model events already run on -- the session id lives in
   * that device's localStorage, so possession of the device is the credential -- and it is the
   * only model under which "your practice follows you" is true for somebody who never typed an
   * address.
   */
  await supabase.from("moments").update({ user_id: user.id }).eq("email", user.email).is("user_id", null);
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (sessionId && uuid.safeParse(sessionId).success) {
    await supabase.from("moments").update({ user_id: user.id }).eq("session_id", sessionId).is("user_id", null);
  }

  const [{ data: words, error: wordsError }, { data: moments, error: momentsError }] = await Promise.all([
    supabase
      .from("word_bank")
      .select("id, spanish, meaning_en, source, times_practiced, last_practiced_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("moments")
      .select("id, created_at, original_text, rescue_json, ledger_state, retrieval_due_at")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (wordsError || momentsError) {
    return NextResponse.json({ error: "Could not load your saved work." }, { status: 502 });
  }

  const sessions = ((moments ?? []) as MomentRow[]).map((moment) => {
    const rescue = (moment.rescue_json ?? {}) as {
      natural_version?: string;
      important_phrase?: { spanish?: string; meaning_en?: string };
      transferableChunk?: { patternEs?: string; meaningEn?: string; communicativeFunction?: string };
      observed_blocker?: { type?: string };
    };
    return {
      id: moment.id,
      createdAt: moment.created_at,
      // The stored originalText is a long engine prompt; the card only needs the human part.
      summary: shortSummary(moment.original_text),
      naturalVersion: rescue.natural_version ?? null,
      keyPhrase: rescue.important_phrase?.spanish ?? null,
      keyPhraseMeaning: rescue.important_phrase?.meaning_en ?? null,
      pattern: rescue.transferableChunk?.patternEs ?? null,
      patternMeaning: rescue.transferableChunk?.meaningEn ?? null,
      blocker: rescue.observed_blocker?.type ?? null,
      ledgerState: moment.ledger_state,
      dueAt: moment.retrieval_due_at,
      rescue: moment.rescue_json,
    };
  });

  return NextResponse.json({
    ok: true,
    user: { email: user.email },
    words: words ?? [],
    sessions,
  });
}

function shortSummary(originalText: string) {
  const quoted = originalText.match(/"([^"]{4,140})"/);
  if (quoted) return quoted[1];
  const scenario = originalText.match(/Chosen scenario: ([^.]{4,120})\./);
  if (scenario) return scenario[1];
  return originalText.slice(0, 120);
}
