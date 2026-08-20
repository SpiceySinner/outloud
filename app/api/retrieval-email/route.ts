import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendVerificationEmail, upsertEmailSubscription } from "@/lib/persistence";

const requestSchema = z.object({
  email: z.email().max(320),
  sessionId: z.string().max(120).nullable().optional(),
  momentId: z.string().max(120).nullable().optional(),
  todayLine: z.string().max(500),
  tomorrowWork: z.string().max(140),
  evidence: z.string().max(800).nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Email did not save." }, { status: 400 });
  }

  const payload = parsed.data;
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return NextResponse.json({ ok: true, saved: false, status: "not_configured" });
  }

  try {
    const now = new Date().toISOString();
    const subscription = await upsertEmailSubscription(supabase, payload.email, now);
    if (payload.sessionId) {
      await supabase.from("sessions").update({ email: payload.email, last_seen_at: now }).eq("id", payload.sessionId);
    }
    if (payload.momentId) {
      await supabase
        .from("moments")
        .update({
          email: payload.email,
          email_subscription_id: subscription.id,
          retrieval_sent_at: null,
          retrieval_status: null,
          retrieval_last_error: null,
        })
        .eq("id", payload.momentId);
    }
    const verification =
      subscription.verifiedAt || subscription.unsubscribedAt
        ? { status: subscription.verifiedAt ? "already_verified" : "unsubscribed" }
        : await sendVerificationEmail(subscription, new URL(request.url).origin);
    return NextResponse.json({ ok: true, saved: true, id: subscription.id, emailStatus: verification.status });
  } catch {
    return NextResponse.json({ error: "Email did not save." }, { status: 502 });
  }
}
