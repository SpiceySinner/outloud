import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { backgroundModel } from "@/lib/model-config";
import { buildRetrievalVariationPrompt } from "@/lib/practice-prompts";
import { retrievalVariationJsonSchema, retrievalVariationSchema } from "@/lib/practice-schema";
import { rescueResponseSchema } from "@/lib/rescue-schema";
import { derivePersonalTeachingModel } from "@/lib/teaching-policy";
import { ledgerLabels, nextReviewAt } from "@/lib/learning-loop";
import type { AssistanceUsed, RescueContext, SavedMoment } from "@/lib/types";

export type EmailSubscription = {
  id: string;
  email: string;
  verificationToken: string;
  verifiedAt: string | null;
  unsubscribedAt: string | null;
};

export type MomentPayload = {
  id: string;
  sessionId: string | null;
  email: string;
  originalText: string;
  entryMode: string;
  context: Record<string, unknown>;
  selfReportedBlocker: string | null;
  selfReportedBlockers: unknown[] | null;
  teachingPolicy: Record<string, unknown> | null;
  interventionOutcomes: unknown[] | null;
  personalTeachingModel: Record<string, unknown> | null;
  attempt: string;
  attemptTranscriptEdited: boolean;
  retry: string;
  rebuildEvaluation: Record<string, unknown> | null;
  transferPrompt: Record<string, unknown> | null;
  transferAttempt: string | null;
  transferEvaluation: Record<string, unknown> | null;
  conversationTurns: unknown[] | null;
  focusGap: Record<string, unknown> | null;
  attemptVoice: Record<string, unknown> | null;
  retryVoice: Record<string, unknown> | null;
  rescue: Record<string, unknown>;
  ledgerState: string;
  createdAt: string;
  deepLinkMomentId: string | null;
  /**
   * Which planned event this run was one go at (#30), and absent for everything else.
   *
   * Optional rather than nullable-and-required so that `SavedMoment`, which predates events,
   * still satisfies this shape -- making it required deepens an existing break in
   * `app/api/retrieval/route.ts` instead of leaving it exactly as it was.
   */
  eventId?: string | null;
};

export type MomentRow = {
  id: string;
  email: string;
  original_text: string;
  entry_mode: string;
  context_json: unknown;
  self_reported_blocker: string | null;
  self_reported_blockers_json: unknown;
  teaching_policy_json: unknown;
  intervention_outcomes_json: unknown;
  personal_teaching_model_json: unknown;
  first_attempt: string;
  first_attempt_transcript_edited: number | boolean | null;
  retry_attempt: string;
  rebuild_evaluation_json: unknown;
  transfer_prompt_json: unknown;
  transfer_attempt: string | null;
  transfer_evaluation_json: unknown;
  conversation_turns_json: unknown;
  focus_gap_json: unknown;
  attempt_voice_json: unknown;
  retry_voice_json: unknown;
  rescue_json: unknown;
  ledger_state: string;
  retrieval_due_at: string;
  retrieval_attempt_count?: number | null;
  email_subscription_id: string | null;
  created_at: string;
  deep_link_moment_id: string | null;
};

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function htmlResponse(title: string, message: string, status = 200) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://outloud-beta.iamexman.chatgpt.site";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;color:#1F1B16;margin:0;padding:32px;"><main style="max-width:620px;margin:0 auto;background:white;border:1px solid #DED5CA;border-radius:20px;padding:28px;"><p style="margin:0 0 12px;color:#C4451F;font-size:12px;font-weight:800;text-transform:uppercase;">outloud</p><h1 style="margin:0;font-family:Georgia,serif;font-size:34px;line-height:1.05;">${escapeHtml(title)}</h1><p style="margin:18px 0 0;color:#8A8079;font-size:16px;line-height:1.6;">${escapeHtml(message)}</p><a href="${escapeHtml(appUrl)}" style="display:block;text-align:center;margin-top:24px;padding:16px 20px;border-radius:13px;background:#C4451F;color:white;font-weight:800;text-decoration:none;">Open OutLoud</a></main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export function supabaseErrorMessage(error: { message?: string } | null | undefined, fallback: string) {
  return error?.message ? `${fallback}: ${error.message}` : fallback;
}

export function readString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function readOptionalString(value: unknown, maxLength: number) {
  const text = readString(value, maxLength);
  return text.length ? text : null;
}

export function normalizeEmail(value: unknown) {
  const email = readString(value, 240).toLowerCase();
  return email.includes("@") ? email : "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readOptionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function readOptionalArray(value: unknown, maxItems: number): unknown[] | null {
  return Array.isArray(value) ? value.slice(0, maxItems) : null;
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseJsonArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createAccessToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashAccessToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function upsertEmailSubscription(
  supabase: SupabaseClient,
  emailValue: string,
  now: string,
): Promise<EmailSubscription> {
  const email = normalizeEmail(emailValue);
  const { data: existing, error: selectError } = await supabase
    .from("email_subscriptions")
    .select("id, verification_token_hash, verified_at, unsubscribed_at")
    .eq("email", email)
    .maybeSingle<{
      id: string;
      verification_token_hash: string | null;
      verified_at: string | null;
      unsubscribed_at: string | null;
    }>();
  if (selectError) throw new Error(supabaseErrorMessage(selectError, "Email subscription lookup failed"));

  const verificationToken = createAccessToken();
  const tokenHash = await hashAccessToken(verificationToken);
  if (existing) {
    const nextTokenHash = !existing.verified_at || existing.unsubscribed_at ? tokenHash : (existing.verification_token_hash ?? tokenHash);
    const { error } = await supabase
      .from("email_subscriptions")
      .update({
        verification_token_hash: nextTokenHash,
        verified_at: existing.unsubscribed_at ? null : existing.verified_at,
        unsubscribed_at: null,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) throw new Error(supabaseErrorMessage(error, "Email subscription update failed"));
    return {
      id: existing.id,
      email,
      verificationToken,
      verifiedAt: existing.unsubscribed_at ? null : existing.verified_at,
      unsubscribedAt: null,
    };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("email_subscriptions").insert({
    id,
    email,
    verification_token_hash: tokenHash,
    verified_at: null,
    unsubscribed_at: null,
    created_at: now,
    updated_at: now,
  });
  if (error) throw new Error(supabaseErrorMessage(error, "Email subscription insert failed"));
  return { id, email, verificationToken, verifiedAt: null, unsubscribedAt: null };
}

export async function refreshSubscriptionActionToken(supabase: SupabaseClient, subscriptionId: string, now: string) {
  const token = createAccessToken();
  const tokenHash = await hashAccessToken(token);
  const { data, error } = await supabase
    .from("email_subscriptions")
    .update({ verification_token_hash: tokenHash, updated_at: now })
    .eq("id", subscriptionId)
    .is("unsubscribed_at", null)
    .select("id");
  return !error && data?.length ? token : null;
}

export async function sendVerificationEmail(
  subscription: EmailSubscription,
  requestOrigin: string,
): Promise<{ status: "verification_sent" | "verification_failed" | "verification_not_configured"; error?: string }> {
  const from = process.env.EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;
  if (!process.env.RESEND_API_KEY || !from) return { status: "verification_not_configured" };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? requestOrigin;
  const baseUrl = appUrl.replace(/\/$/, "");
  const verifyUrl = `${baseUrl}/api/email-verify?email=${encodeURIComponent(subscription.email)}&token=${encodeURIComponent(subscription.verificationToken)}`;
  const unsubscribeUrl = `${baseUrl}/api/email-unsubscribe?email=${encodeURIComponent(subscription.email)}&token=${encodeURIComponent(subscription.verificationToken)}`;
  const text =
    `OutLoud\n\nConfirm this email so OutLoud can send private replay links for what you practiced.\n\n` +
    `Verify email: ${verifyUrl}\n\nUnsubscribe: ${unsubscribeUrl}`;
  const html = `
    <div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;color:#1F1B16;padding:28px;">
      <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #DED5CA;border-radius:20px;padding:28px;">
        <p style="margin:0 0 12px;color:#C4451F;font-size:12px;font-weight:800;text-transform:uppercase;">outloud</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:34px;line-height:1.05;">confirm return emails</h1>
        <p style="margin:18px 0 0;color:#8A8079;font-size:16px;line-height:1.6;">OutLoud will only send private replay links after you verify this address.</p>
        <a href="${verifyUrl}" style="display:block;text-align:center;margin-top:24px;padding:16px 20px;border-radius:13px;background:#C4451F;color:white;font-weight:800;text-decoration:none;">Verify email</a>
        <p style="margin:18px 0 0;color:#8A8079;font-size:13px;line-height:1.6;"><a href="${unsubscribeUrl}" style="color:#8A8079;">Unsubscribe</a></p>
      </div>
    </div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: subscription.email,
        subject: "confirm OutLoud return emails",
        text,
        html,
      }),
    });
    if (!response.ok) return { status: "verification_failed", error: await response.text() };
    return { status: "verification_sent" };
  } catch (error) {
    return { status: "verification_failed", error: error instanceof Error ? error.message : "Unknown email error" };
  }
}

export function normalizeMomentPayload(value: unknown): MomentPayload {
  if (!isRecord(value)) throw new Error("Saved practice needs a few details.");
  const id = readString(value.id, 80);
  const originalText = readString(value.originalText, 4000);
  const entryMode = readString(value.entryMode, 40);
  const context = readOptionalRecord(value.context);
  const retry = readString(value.retry, 4000);
  const rescue = readOptionalRecord(value.rescue);
  if (!id || !originalText || !retry || !entryMode || !context || !rescue) {
    throw new Error("Saved practice needs an id, situation, type, and reply.");
  }
  return {
    id,
    sessionId: readOptionalString(value.sessionId, 120),
    email: readString(value.email, 240),
    originalText,
    entryMode,
    context,
    selfReportedBlocker: readOptionalString(value.selfReportedBlocker, 80),
    selfReportedBlockers: readOptionalArray(value.selfReportedBlockers, 8),
    teachingPolicy: readOptionalRecord(value.teachingPolicy),
    interventionOutcomes: readOptionalArray(value.interventionOutcomes, 20),
    personalTeachingModel: readOptionalRecord(value.personalTeachingModel),
    attempt: readString(value.attempt, 4000),
    attemptTranscriptEdited: value.attemptTranscriptEdited === true,
    retry,
    rebuildEvaluation: readOptionalRecord(value.rebuildEvaluation),
    transferPrompt: readOptionalRecord(value.transferPrompt),
    transferAttempt: readOptionalString(value.transferAttempt, 4000),
    transferEvaluation: readOptionalRecord(value.transferEvaluation),
    conversationTurns: readOptionalArray(value.conversationTurns, 8),
    focusGap: readOptionalRecord(value.focusGap),
    attemptVoice: readOptionalRecord(value.attemptVoice),
    retryVoice: readOptionalRecord(value.retryVoice),
    rescue,
    ledgerState: readString(value.ledgerState, 80) || "needed_full_help",
    createdAt: readOptionalString(value.createdAt, 80) ?? new Date().toISOString(),
    deepLinkMomentId: readOptionalString(value.deepLinkMomentId, 120),
    eventId: readOptionalString(value.eventId, 120),
  };
}

export function normalizeLedgerState(value: string): SavedMoment["ledgerState"] {
  return value in ledgerLabels ? (value as SavedMoment["ledgerState"]) : "needed_full_help";
}

export function normalizeAssistanceUsed(value: unknown): AssistanceUsed {
  const assistance = readOptionalString(value, 80);
  if (
    assistance === "full_model" ||
    assistance === "sentence_frame" ||
    assistance === "keyword" ||
    assistance === "repeat" ||
    assistance === "slower_audio" ||
    assistance === "english_explanation" ||
    assistance === "none"
  ) {
    return assistance;
  }
  return "none";
}

export function anonymousStorageEmail(sessionId: string) {
  return `anonymous+${sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80)}@outloud.local`;
}

export function momentFromRow(row: MomentRow): SavedMoment {
  return {
    id: row.id,
    sessionId: undefined,
    email: row.email,
    originalText: row.original_text,
    entryMode: row.entry_mode === "received_spanish" ? "received_spanish" : "wanted_to_say",
    context: (parseJsonRecord(row.context_json) ?? { who: "someone", dialect: "Latin America", tone: "warm" }) as RescueContext,
    selfReportedBlocker: row.self_reported_blocker as SavedMoment["selfReportedBlocker"],
    selfReportedBlockers: (parseJsonArray(row.self_reported_blockers_json) ?? undefined) as SavedMoment["selfReportedBlockers"],
    attempt: row.first_attempt,
    attemptTranscriptEdited: row.first_attempt_transcript_edited === 1 || row.first_attempt_transcript_edited === true,
    retry: row.retry_attempt,
    rebuildEvaluation: parseJsonRecord(row.rebuild_evaluation_json) as SavedMoment["rebuildEvaluation"],
    transferPrompt: parseJsonRecord(row.transfer_prompt_json) as SavedMoment["transferPrompt"],
    transferAttempt: row.transfer_attempt ?? undefined,
    transferEvaluation: parseJsonRecord(row.transfer_evaluation_json) as SavedMoment["transferEvaluation"],
    conversationTurns: parseJsonArray(row.conversation_turns_json) as SavedMoment["conversationTurns"],
    focusGap: parseJsonRecord(row.focus_gap_json) as SavedMoment["focusGap"],
    attemptVoice: parseJsonRecord(row.attempt_voice_json) as SavedMoment["attemptVoice"],
    retryVoice: parseJsonRecord(row.retry_voice_json) as SavedMoment["retryVoice"],
    rescue: parseJsonRecord(row.rescue_json) as SavedMoment["rescue"],
    teachingPolicy: parseJsonRecord(row.teaching_policy_json) as SavedMoment["teachingPolicy"],
    interventionOutcomes: parseJsonArray(row.intervention_outcomes_json) as SavedMoment["interventionOutcomes"],
    personalTeachingModel: parseJsonRecord(row.personal_teaching_model_json) as SavedMoment["personalTeachingModel"],
    ledgerState: normalizeLedgerState(row.ledger_state),
    createdAt: row.created_at,
    reviewDueAt: row.retrieval_due_at,
    deepLinkMomentId: row.deep_link_moment_id ?? undefined,
  };
}

export async function loadPriorMoments(supabase: SupabaseClient, sessionId: string, email: string | null, excludeId: string) {
  let query = supabase
    .from("moments")
    .select(
      `id, email, original_text, entry_mode, context_json, self_reported_blocker,
       self_reported_blockers_json, teaching_policy_json, intervention_outcomes_json, personal_teaching_model_json,
       first_attempt, first_attempt_transcript_edited, retry_attempt, rebuild_evaluation_json,
       transfer_prompt_json, transfer_attempt, transfer_evaluation_json, conversation_turns_json,
       focus_gap_json, attempt_voice_json, retry_voice_json, rescue_json, ledger_state,
       retrieval_due_at, email_subscription_id, created_at, deep_link_moment_id`,
    )
    .neq("id", excludeId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(12);

  query = email ? query.or(`session_id.eq.${sessionId},email.eq.${email}`) : query.eq("session_id", sessionId);

  const { data } = await query.returns<MomentRow[]>();
  return (data ?? []).map(momentFromRow);
}

export async function loadRetrievalVariation(supabase: SupabaseClient, momentId: string, reviewStage: string) {
  const { data: row } = await supabase
    .from("retrieval_variations")
    .select("id, review_stage, variation_json, model, created_at, completed_at, result_json")
    .eq("moment_id", momentId)
    .eq("review_stage", reviewStage)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      review_stage: string;
      variation_json: unknown;
      model: string | null;
      created_at: string;
      completed_at: string | null;
      result_json: unknown;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    reviewStage: row.review_stage,
    variation: parseJsonRecord(row.variation_json),
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    result: parseJsonRecord(row.result_json),
  };
}

export async function upsertRetrievalVariation(
  supabase: SupabaseClient,
  input: {
    momentId: string;
    reviewStage: string;
    variation: Record<string, unknown>;
    model: string | null;
    createdAt: string;
  },
) {
  const existing = await loadRetrievalVariation(supabase, input.momentId, input.reviewStage);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const { error } = await supabase.from("retrieval_variations").insert({
    id,
    moment_id: input.momentId,
    review_stage: input.reviewStage,
    variation_json: input.variation,
    model: input.model,
    created_at: input.createdAt,
    completed_at: null,
    result_json: null,
  });
  if (error) throw new Error(supabaseErrorMessage(error, "Retrieval variation insert failed"));
  return {
    id,
    reviewStage: input.reviewStage,
    variation: input.variation,
    model: input.model,
    createdAt: input.createdAt,
    completedAt: null,
    result: null,
  };
}

export async function generateDelayedRetrievalVariation(row: MomentRow) {
  if (!process.env.OPENAI_API_KEY) return null;
  const rescueResult = rescueResponseSchema.safeParse(parseJsonRecord(row.rescue_json));
  if (!rescueResult.success) return null;
  const context = (parseJsonRecord(row.context_json) ?? { who: "someone", dialect: "Latin America", tone: "warm" }) as RescueContext;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: backgroundModel(),
    input: buildRetrievalVariationPrompt({
      originalText: row.original_text,
      scenarioContext: null,
      context,
      rescue: rescueResult.data,
    }),
    temperature: 0.2,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "retrieval_variation",
        strict: true,
        schema: retrievalVariationJsonSchema,
      },
    },
  });

  return retrievalVariationSchema.parse(JSON.parse(response.output_text));
}

export async function ensureDelayedRetrievalVariation(supabase: SupabaseClient, row: MomentRow, createdAt: string) {
  const existing = await loadRetrievalVariation(supabase, row.id, "delayed_retrieval");
  if (existing?.variation) return existing.variation;

  const generated = await generateDelayedRetrievalVariation(row);
  if (!generated) return null;
  await upsertRetrievalVariation(supabase, {
    momentId: row.id,
    reviewStage: "delayed_retrieval",
    variation: generated,
    model: backgroundModel(),
    createdAt,
  });
  return generated;
}

export async function validateMomentAccess(
  supabase: SupabaseClient,
  id: string,
  token: string,
): Promise<{ ok: true; tokenHash: string } | { ok: false; status: number; error: string }> {
  const tokenHash = await hashAccessToken(token);
  const { data: tokenRow, error } = await supabase
    .from("moment_access_tokens")
    .select("moment_id, expires_at, revoked_at")
    .eq("moment_id", id)
    .eq("token_hash", tokenHash)
    .maybeSingle<{ moment_id: string; expires_at: string; revoked_at: string | null }>();

  if (error || !tokenRow) return { ok: false, status: 404, error: "Invalid review link." };
  if (tokenRow.revoked_at) return { ok: false, status: 410, error: "This review link has been revoked." };
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 410, error: "This review link has expired." };
  }
  return { ok: true, tokenHash };
}

export async function sendRetrievalEmail(
  moment: MomentPayload,
  reviewUrl: string,
  unsubscribeUrl: string | null = null,
): Promise<{ status: "sent" | "failed" | "not_configured"; error?: string }> {
  const from = process.env.EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;
  if (!process.env.RESEND_API_KEY || !from) return { status: "not_configured" };
  const subject = "your OutLoud replay is ready";
  const text =
    `OutLoud\n\nYou worked on: ${moment.originalText}\n\n` +
    `Today is the same ability in a changed situation, not a memorized repeat.\n\n` +
    `Open your private replay: ${reviewUrl}\n\n` +
    `No score. Just one more real conversation rep.` +
    (unsubscribeUrl ? `\n\nUnsubscribe: ${unsubscribeUrl}` : "");
  const html = `
    <div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;color:#1F1B16;padding:28px;">
      <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #DED5CA;border-radius:20px;padding:28px;">
        <p style="margin:0 0 12px;color:#C4451F;font-size:12px;font-weight:800;text-transform:uppercase;">outloud</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:34px;line-height:1.05;">one harder rep. not a repeat.</h1>
        <p style="margin:18px 0 0;color:#8A8079;font-size:16px;line-height:1.6;">You worked on:</p>
        <p style="margin:8px 0 0;font-size:18px;line-height:1.5;"><strong>${escapeHtml(moment.originalText)}</strong></p>
        <p style="margin:18px 0 0;color:#8A8079;font-size:16px;line-height:1.6;">This opens the same ability in a changed situation, so it sticks beyond one sentence.</p>
        <a href="${reviewUrl}" style="display:block;text-align:center;margin-top:24px;padding:16px 20px;border-radius:13px;background:#C4451F;color:white;font-weight:800;text-decoration:none;">Open your replay</a>
        ${unsubscribeUrl ? `<p style="margin:18px 0 0;color:#8A8079;font-size:13px;line-height:1.6;"><a href="${unsubscribeUrl}" style="color:#8A8079;">Unsubscribe</a></p>` : ""}
      </div>
    </div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: moment.email,
        subject,
        text,
        html,
      }),
    });
    if (!response.ok) return { status: "failed", error: await response.text() };
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unknown email error" };
  }
}

export async function buildPersonalTeachingModelForSave(
  supabase: SupabaseClient,
  moment: MomentPayload,
  sessionId: string,
  storageEmail: string,
) {
  const prior = await loadPriorMoments(supabase, sessionId, storageEmail.includes("@outloud.local") ? null : storageEmail, moment.id);
  const current = momentFromPayload(moment, storageEmail);
  return derivePersonalTeachingModel([current, ...prior]);
}

function momentFromPayload(moment: MomentPayload, storageEmail: string): SavedMoment {
  return {
    id: moment.id,
    sessionId: moment.sessionId ?? undefined,
    email: storageEmail,
    originalText: moment.originalText,
    entryMode: moment.entryMode === "received_spanish" ? "received_spanish" : "wanted_to_say",
    context: moment.context as RescueContext,
    selfReportedBlocker: moment.selfReportedBlocker as SavedMoment["selfReportedBlocker"],
    selfReportedBlockers: (moment.selfReportedBlockers ?? undefined) as SavedMoment["selfReportedBlockers"],
    attempt: moment.attempt,
    attemptTranscriptEdited: moment.attemptTranscriptEdited,
    retry: moment.retry,
    rebuildEvaluation: moment.rebuildEvaluation as SavedMoment["rebuildEvaluation"],
    transferPrompt: moment.transferPrompt as SavedMoment["transferPrompt"],
    transferAttempt: moment.transferAttempt ?? undefined,
    transferEvaluation: moment.transferEvaluation as SavedMoment["transferEvaluation"],
    conversationTurns: moment.conversationTurns as SavedMoment["conversationTurns"],
    focusGap: moment.focusGap as SavedMoment["focusGap"],
    attemptVoice: moment.attemptVoice as SavedMoment["attemptVoice"],
    retryVoice: moment.retryVoice as SavedMoment["retryVoice"],
    rescue: moment.rescue as SavedMoment["rescue"],
    teachingPolicy: moment.teachingPolicy as SavedMoment["teachingPolicy"],
    interventionOutcomes: moment.interventionOutcomes as SavedMoment["interventionOutcomes"],
    personalTeachingModel: moment.personalTeachingModel as SavedMoment["personalTeachingModel"],
    ledgerState: normalizeLedgerState(moment.ledgerState),
    createdAt: moment.createdAt,
    deepLinkMomentId: moment.deepLinkMomentId ?? undefined,
  };
}

export function reviewDueAtFor(moment: MomentPayload) {
  return nextReviewAt(Date.now(), normalizeLedgerState(moment.ledgerState), Boolean(moment.deepLinkMomentId));
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
