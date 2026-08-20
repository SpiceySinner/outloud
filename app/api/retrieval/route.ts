import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  createAccessToken,
  ensureDelayedRetrievalVariation,
  hashAccessToken,
  json,
  momentFromRow,
  refreshSubscriptionActionToken,
  sendRetrievalEmail,
  type MomentRow,
} from "@/lib/persistence";

export async function POST(request: Request) {
  return handleRetrievalRequest(request);
}

// Vercel Cron invokes its target with GET (carrying `Authorization: Bearer $CRON_SECRET`), so
// the scheduled run needs this alongside the manual POST. Same auth, same work.
export async function GET(request: Request) {
  return handleRetrievalRequest(request);
}

async function handleRetrievalRequest(request: Request) {
  if (process.env.CRON_SECRET && request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const result = await runRetrieval(new URL(request.url).origin);
  return json(result, result.error ? 500 : 200);
}

async function runRetrieval(requestOrigin: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { sent: 0, failed: 0, skipped: 0, error: "Saved practice is not connected yet." };
  if (!process.env.RESEND_API_KEY || !(process.env.EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL)) {
    return { sent: 0, failed: 0, skipped: 0, error: "Email is not configured." };
  }

  const now = new Date().toISOString();
  const staleClaimCutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: rows, error: dueError } = await supabase
    .from("moments")
    .select(
      `id, email, original_text, entry_mode, context_json, self_reported_blocker,
       self_reported_blockers_json, teaching_policy_json, intervention_outcomes_json, personal_teaching_model_json,
       first_attempt, first_attempt_transcript_edited, retry_attempt, rebuild_evaluation_json,
       transfer_prompt_json, transfer_attempt, transfer_evaluation_json, conversation_turns_json,
       focus_gap_json, attempt_voice_json, retry_voice_json, rescue_json, ledger_state,
       retrieval_due_at, email_subscription_id, created_at, deep_link_moment_id,
       email_subscriptions!inner(id, verified_at, unsubscribed_at)`,
    )
    .not("email_subscription_id", "is", null)
    .not("email_subscriptions.verified_at", "is", null)
    .is("email_subscriptions.unsubscribed_at", null)
    .lte("retrieval_due_at", now)
    .is("retrieval_sent_at", null)
    .is("deleted_at", null)
    .or(`retrieval_claimed_at.is.null,retrieval_claimed_at.lte.${staleClaimCutoff}`)
    .order("retrieval_due_at", { ascending: true })
    .limit(25)
    .returns<MomentRow[]>();

  if (dueError) return { sent: 0, failed: 0, skipped: 0, error: dueError.message };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows ?? []) {
    const { data: claimedRows, error: claimError } = await supabase
      .rpc("claim_due_moment", {
        p_moment_id: row.id,
        p_claimed_at: now,
        p_stale_claim_cutoff: staleClaimCutoff,
      })
      .returns<{ id: string }[]>();
    if (claimError || !Array.isArray(claimedRows) || !claimedRows.length) {
      skipped += 1;
      continue;
    }

    const delivery = await claimRetrievalDelivery(row, now, staleClaimCutoff);
    if (delivery.status === "already_sent") {
      skipped += 1;
      await supabase
        .from("moments")
        .update({ retrieval_sent_at: delivery.sentAt, retrieval_claimed_at: null, retrieval_status: "sent", retrieval_last_error: null })
        .eq("id", row.id);
      continue;
    }
    if (delivery.status !== "claimed") {
      skipped += 1;
      await supabase
        .from("moments")
        .update({ retrieval_claimed_at: null, retrieval_status: "skipped_duplicate", retrieval_last_error: "Delivery was already claimed." })
        .eq("id", row.id);
      continue;
    }

    const delayedVariation = await ensureDelayedRetrievalVariation(supabase, row, now);
    if (!delayedVariation) {
      failed += 1;
      await supabase
        .from("retrieval_deliveries")
        .update({ claimed_at: null, status: "variation_failed", last_error: "Could not generate a delayed retrieval variation." })
        .eq("idempotency_key", delivery.idempotencyKey);
      await supabase
        .from("moments")
        .update({ retrieval_claimed_at: null, retrieval_status: "variation_failed", retrieval_last_error: "Could not generate a delayed retrieval variation." })
        .eq("id", row.id);
      continue;
    }

    const moment = momentFromRow(row);
    moment.transferPrompt = delayedVariation as typeof moment.transferPrompt;
    const accessToken = createAccessToken();
    const tokenHash = await hashAccessToken(accessToken);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? requestOrigin;
    const reviewUrl = `${appUrl.replace(/\/$/, "")}/m/${encodeURIComponent(moment.id)}?token=${encodeURIComponent(accessToken)}`;
    const subscriptionActionToken = row.email_subscription_id
      ? await refreshSubscriptionActionToken(supabase, row.email_subscription_id, now)
      : null;
    const unsubscribeUrl = subscriptionActionToken
      ? `${appUrl.replace(/\/$/, "")}/api/email-unsubscribe?email=${encodeURIComponent(moment.email)}&token=${encodeURIComponent(subscriptionActionToken)}`
      : null;
    const accessTokenId = crypto.randomUUID();
    await supabase.from("moment_access_tokens").insert({
      id: accessTokenId,
      moment_id: moment.id,
      token_hash: tokenHash,
      created_at: now,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      revoked_at: null,
    });

    const result = await sendRetrievalEmail(moment, reviewUrl, unsubscribeUrl);
    if (result.status === "sent") {
      sent += 1;
      const sentAt = new Date().toISOString();
      await supabase
        .from("retrieval_deliveries")
        .update({ sent_at: sentAt, status: "sent", last_error: null })
        .eq("idempotency_key", delivery.idempotencyKey);
      await supabase
        .from("moments")
        .update({ retrieval_sent_at: sentAt, retrieval_claimed_at: null, retrieval_status: "sent", retrieval_last_error: null })
        .eq("id", moment.id);
    } else {
      failed += 1;
      await supabase.from("moment_access_tokens").delete().eq("id", accessTokenId);
      await supabase
        .from("retrieval_deliveries")
        .update({ claimed_at: null, status: result.status, last_error: result.error ?? result.status })
        .eq("idempotency_key", delivery.idempotencyKey);
      await supabase
        .from("moments")
        .update({ retrieval_claimed_at: null, retrieval_status: result.status, retrieval_last_error: result.error ?? result.status })
        .eq("id", moment.id);
    }
  }

  return { sent, failed, skipped };
}

async function claimRetrievalDelivery(
  row: MomentRow,
  claimedAt: string,
  staleClaimCutoff: string,
): Promise<
  | { status: "claimed"; idempotencyKey: string }
  | { status: "already_sent"; idempotencyKey: string; sentAt: string }
  | { status: "busy"; idempotencyKey: string }
> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { status: "busy", idempotencyKey: "" };
  const reviewStage = "delayed_retrieval";
  const idempotencyKey = `${row.id}:${row.retrieval_due_at}:${reviewStage}`;
  const { data, error } = await supabase
    .rpc("claim_retrieval_delivery", {
      p_id: crypto.randomUUID(),
      p_moment_id: row.id,
      p_review_stage: reviewStage,
      p_due_at: row.retrieval_due_at,
      p_claimed_at: claimedAt,
      p_idempotency_key: idempotencyKey,
      p_stale_claim_cutoff: staleClaimCutoff,
    })
    .maybeSingle<{ status: "claimed" | "already_sent" | "busy"; idempotency_key: string; sent_at: string | null }>();
  if (error || !data) return { status: "busy", idempotencyKey };
  if (data.status === "already_sent" && data.sent_at) return { status: "already_sent", idempotencyKey, sentAt: data.sent_at };
  return data.status === "claimed" ? { status: "claimed", idempotencyKey } : { status: "busy", idempotencyKey };
}
