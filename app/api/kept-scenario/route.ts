import { NextResponse } from "next/server";
import { z } from "zod";

import { entryIntents } from "@/lib/intent-schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * What a learner asked for that this build cannot run yet.
 *
 * Section 7 of `VOICE_ENTRY.md`: when the router understands someone perfectly and there is no
 * engine behind it, the honest thing is to read it back, say so plainly, and **keep it**. Keeping
 * it does two jobs. For the learner it turns a dead end into a promise. For us it is the corpus
 * the upcoming-event engine needs and does not have -- real situations real people asked for, in
 * their own words -- which the master plan's own self-audit says we do not have. The failure state
 * becomes the research.
 *
 * No auth: the entry screen is reachable signed out, and requiring an account here would collect
 * only from the people we already know the most about. Nothing about a person is stored beyond the
 * sentence they chose to say to us.
 *
 * It writes to `kept_requests`, which exists for exactly this and nothing else.
 *
 * It used to write to `analytics_events`, a table belonging to an older product that shared this
 * Supabase account. That was always a borrowed shelf, and it stopped being available on
 * 2026-09-10 when behaviour moved to PostHog and the table was dropped.
 *
 * This is the one thing that could NOT move to PostHog with the rest: it is free text about
 * somebody's life, and no free text leaves for a third party (`docs/features/tracking.md`
 * section 2). It is also not a metric. A count of refusals is a PostHog number; the sentence
 * behind it is a corpus, and corpora live next to the rows they describe.
 */

const requestSchema = z.object({
  said: z.string().min(1).max(1200),
  intent: z.enum(entryIntents),
  readBackEn: z.string().max(400).optional().default(""),
  situationEn: z.string().max(800).nullable().optional().default(null),
  whoEn: z.string().max(200).nullable().optional().default(null),
  whenEn: z.string().max(200).nullable().optional().default(null),
  askEn: z.string().max(400).nullable().optional().default(null),
  topicEn: z.string().max(400).nullable().optional().default(null),
  /** The browser's identity, so a kept request can be tied to the rest of what that person did. */
  sessionId: z.string().max(120).nullable().optional().default(null),
  at: z.string().max(40).optional(),
});

const uuid = z.string().uuid();

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "kept-scenario", 40, 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Nothing to keep." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Deliberately not an error the learner ever sees: the screen has already promised to keep it,
  // and the local copy is what makes that promise true. This is the research copy.
  if (!supabase) {
    return NextResponse.json({ ok: true, stored: false });
  }

  const { said, intent, readBackEn, situationEn, whoEn, whenEn, askEn, topicEn, sessionId } = parsed.data;
  const { error } = await supabase.from("kept_requests").insert({
    session_id: sessionId && uuid.safeParse(sessionId).success ? sessionId : null,
    intent,
    said,
    read_back_en: readBackEn || null,
    situation_en: situationEn,
    who_en: whoEn,
    when_en: whenEn,
    ask_en: askEn,
    topic_en: topicEn,
  });

  if (error) {
    return NextResponse.json({ ok: true, stored: false });
  }
  return NextResponse.json({ ok: true, stored: true });
}
