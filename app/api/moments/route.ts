import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  anonymousStorageEmail,
  buildPersonalTeachingModelForSave,
  createAccessToken,
  hashAccessToken,
  json,
  normalizeEmail,
  normalizeMomentPayload,
  readOptionalString,
  reviewDueAtFor,
  sendVerificationEmail,
  supabaseErrorMessage,
  upsertEmailSubscription,
  upsertRetrievalVariation,
} from "@/lib/persistence";

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "moments", Number(process.env.MAX_MOMENT_SAVES_PER_DAY ?? 200), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Saved practice is not connected yet." }, { status: 503 });

  let moment: ReturnType<typeof normalizeMomentPayload>;
  try {
    moment = normalizeMomentPayload(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save that practice." }, { status: 400 });
  }

  const sessionId = moment.sessionId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const { data: existingMoment, error: existingMomentError } = await supabase
    .from("moments")
    .select("id, person_profile_id")
    .eq("id", moment.id)
    .maybeSingle<{ id: string; person_profile_id: string | null }>();
  if (existingMomentError) return NextResponse.json({ error: "Could not check saved practice." }, { status: 502 });

  if (!existingMoment) {
    const dailyLimit = Number(process.env.MAX_FREE_SESSIONS_PER_DAY ?? process.env.MAX_ANONYMOUS_MOMENTS_PER_DAY ?? 50);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count, error } = await supabase
      .from("moments")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .gte("created_at", startOfDay.toISOString())
      .is("deleted_at", null);
    if (error) return NextResponse.json({ error: "Could not check today's save limit." }, { status: 502 });
    if (Number(count ?? 0) >= dailyLimit) {
      return NextResponse.json({ error: "OutLoud is at its beta save limit for this device today." }, { status: 429 });
    }
  }

  const accessToken = existingMoment ? null : createAccessToken();
  const tokenHash = accessToken ? await hashAccessToken(accessToken) : null;
  const profileId = existingMoment?.person_profile_id ?? crypto.randomUUID();
  const anonymousPractice = !normalizeEmail(moment.email);
  const storageEmail = anonymousPractice ? anonymousStorageEmail(sessionId) : normalizeEmail(moment.email);
  const subscription = anonymousPractice ? null : await upsertEmailSubscription(supabase, storageEmail, now);
  const device = { userAgent: request.headers.get("user-agent") ?? null };
  const personalTeachingModel = await buildPersonalTeachingModelForSave(supabase, moment, sessionId, storageEmail);

  const sessionInsert = await supabase.from("sessions").upsert(
    {
      id: sessionId,
      anonymous_identifier: sessionId,
      email: anonymousPractice ? null : storageEmail,
      created_at: now,
      last_seen_at: now,
      device_json: device,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (sessionInsert.error) return NextResponse.json({ error: "Could not save session." }, { status: 502 });

  const sessionUpdate = await supabase
    .from("sessions")
    .update({ email: anonymousPractice ? null : storageEmail, last_seen_at: now, device_json: device })
    .eq("id", sessionId);
  if (sessionUpdate.error) return NextResponse.json({ error: "Could not update session." }, { status: 502 });

  const profileUpsert = await supabase.from("person_profiles").upsert(
    {
      id: profileId,
      session_id: sessionId,
      relationship: readOptionalString(moment.context.who, 120) ?? "someone",
      region: readOptionalString(moment.context.dialect, 120) ?? "Latin America",
      default_tone: readOptionalString(moment.context.tone, 120) ?? "warm",
      created_at: now,
    },
    { onConflict: "id" },
  );
  if (profileUpsert.error) return NextResponse.json({ error: "Could not save profile context." }, { status: 502 });

  const retrievalDueAt = reviewDueAtFor(moment);
  const momentUpsert = await supabase.from("moments").upsert({
    id: moment.id,
    session_id: sessionId,
    person_profile_id: profileId,
    email_subscription_id: subscription?.id ?? null,
    created_at: moment.createdAt,
    email: storageEmail,
    original_text: moment.originalText,
    entry_mode: moment.entryMode,
    context_json: moment.context,
    self_reported_blocker: moment.selfReportedBlocker,
    self_reported_blockers_json: moment.selfReportedBlockers,
    teaching_policy_json: moment.teachingPolicy,
    intervention_outcomes_json: moment.interventionOutcomes,
    personal_teaching_model_json: personalTeachingModel,
    first_attempt: moment.attempt,
    first_attempt_transcript_edited: moment.attemptTranscriptEdited,
    retry_attempt: moment.retry,
    rebuild_evaluation_json: moment.rebuildEvaluation,
    transfer_prompt_json: moment.transferPrompt,
    transfer_attempt: moment.transferAttempt,
    transfer_evaluation_json: moment.transferEvaluation,
    conversation_turns_json: moment.conversationTurns,
    focus_gap_json: moment.focusGap,
    attempt_voice_json: moment.attemptVoice,
    retry_voice_json: moment.retryVoice,
    rescue_json: moment.rescue,
    ledger_state: moment.ledgerState,
    retrieval_due_at: retrievalDueAt,
    retrieval_sent_at: null,
    review_opened_at: null,
    deep_link_moment_id: moment.deepLinkMomentId,
  });
  if (momentUpsert.error) {
    return NextResponse.json({ error: supabaseErrorMessage(momentUpsert.error, "Could not save practice") }, { status: 502 });
  }

  const attemptsUpsert = await supabase.from("attempts").upsert(
    [
      {
        moment_id: moment.id,
        attempt_number: 1,
        transcript: moment.attempt || moment.originalText,
        transcript_edited: moment.attemptTranscriptEdited,
        assistance_level: "none",
        meaning_result: readOptionalString(moment.rebuildEvaluation?.meaningResult, 80),
        created_at: moment.createdAt,
      },
      {
        moment_id: moment.id,
        attempt_number: 2,
        transcript: moment.retry,
        transcript_edited: false,
        assistance_level: readOptionalString(moment.transferEvaluation?.assistanceUsed ?? moment.rebuildEvaluation?.assistanceUsed, 80) ?? "none",
        meaning_result: readOptionalString(moment.transferEvaluation?.meaningResult ?? moment.rebuildEvaluation?.meaningResult, 80),
        created_at: now,
      },
    ],
    { onConflict: "moment_id,attempt_number" },
  );
  if (attemptsUpsert.error) return NextResponse.json({ error: "Could not save attempts." }, { status: 502 });

  if (tokenHash) {
    const accessInsert = await supabase.from("moment_access_tokens").insert({
      id: crypto.randomUUID(),
      moment_id: moment.id,
      token_hash: tokenHash,
      created_at: now,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      revoked_at: null,
    });
    if (accessInsert.error) return NextResponse.json({ error: "Could not create a private review link." }, { status: 502 });
  }

  if (moment.transferPrompt) {
    await upsertRetrievalVariation(supabase, {
      momentId: moment.id,
      reviewStage: "initial_transfer",
      variation: moment.transferPrompt,
      model: process.env.OPENAI_BACKGROUND_MODEL ?? process.env.OPENAI_TEXT_MODEL ?? process.env.OPENAI_MODEL ?? null,
      createdAt: now,
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const reviewUrl = accessToken
    ? `${appUrl.replace(/\/$/, "")}/m/${encodeURIComponent(moment.id)}?token=${encodeURIComponent(accessToken)}`
    : null;

  let emailStatus = anonymousPractice ? "not_requested" : subscription?.verifiedAt ? "already_verified" : "verification_not_configured";
  let emailError: string | null = null;
  if (subscription && !subscription.verifiedAt && !subscription.unsubscribedAt) {
    const result = await sendVerificationEmail(subscription, new URL(request.url).origin);
    emailStatus = result.status;
    emailError = result.error ?? null;
  }

  return json({
    ok: true,
    savedRemote: true,
    sessionId,
    momentId: moment.id,
    reviewUrl,
    reviewDueAt: retrievalDueAt,
    emailStatus,
    emailError,
    personalTeachingModel,
  });
}
