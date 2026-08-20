import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  json,
  loadRetrievalVariation,
  parseJsonArray,
  parseJsonRecord,
  readString,
  validateMomentAccess,
} from "@/lib/persistence";

export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return json({ error: "Saved practice is not connected yet." }, 503);

  const url = new URL(request.url);
  const id = readString(url.searchParams.get("id"), 80);
  const token = readString(url.searchParams.get("token"), 240);
  if (!id || !token) return json({ error: "Private review token required." }, 400);

  const access = await validateMomentAccess(supabase, id, token);
  if (!access.ok) return json({ error: access.error }, access.status);

  const { data: row, error } = await supabase
    .from("moments")
    .select("id, original_text, transfer_prompt_json, context_json, rescue_json, conversation_turns_json, focus_gap_json, retrieval_due_at, retrieval_sent_at, deleted_at")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      original_text: string;
      transfer_prompt_json: unknown;
      context_json: unknown;
      rescue_json: unknown;
      conversation_turns_json: unknown;
      focus_gap_json: unknown;
      retrieval_due_at: string;
      retrieval_sent_at: string | null;
      deleted_at: string | null;
    }>();

  if (error || !row) return json({ error: "Saved practice not found." }, 404);
  if (row.deleted_at) return json({ error: "This saved practice was deleted." }, 410);

  await supabase.from("moments").update({ review_opened_at: new Date().toISOString() }).eq("id", id);
  const cachedVariation = await loadRetrievalVariation(supabase, id, "delayed_retrieval");
  const transferPrompt = cachedVariation?.variation ?? parseJsonRecord(row.transfer_prompt_json);

  return json({
    ok: true,
    moment: {
      id: row.id,
      originalText: row.original_text,
      seededPrompt: readString(transferPrompt?.situationEn, 800) || row.original_text,
      transferPrompt,
      retrievalVariation: cachedVariation,
      reviewStatus: describeReviewStatus(row.retrieval_due_at, row.retrieval_sent_at, cachedVariation?.completedAt),
      conversationTurns: parseJsonArray(row.conversation_turns_json),
      focusGap: parseJsonRecord(row.focus_gap_json),
      context: parseJsonRecord(row.context_json),
      rescue: parseJsonRecord(row.rescue_json),
    },
  });
}

function describeReviewStatus(retrievalDueAt: string, retrievalSentAt: string | null, completedAt: string | null | undefined) {
  if (completedAt) {
    return {
      state: "already_completed",
      message: "You already completed this private replay. You can still review it.",
      reviewDueAt: retrievalDueAt,
      completedAt,
    };
  }

  const dueMs = new Date(retrievalDueAt).getTime();
  if (!retrievalSentAt && Number.isFinite(dueMs) && dueMs > Date.now()) {
    return {
      state: "not_yet_due",
      message: "This replay is saved before its reminder time. You can practice now, or come back when the reminder is due.",
      reviewDueAt: retrievalDueAt,
      completedAt: null,
    };
  }

  return {
    state: "ready",
    message: "Your private replay is ready.",
    reviewDueAt: retrievalDueAt,
    completedAt: null,
  };
}
