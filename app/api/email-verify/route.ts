import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashAccessToken, htmlResponse, normalizeEmail, readString } from "@/lib/persistence";

export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return htmlResponse("OutLoud email verification", "Email storage is not connected yet.", 503);

  const url = new URL(request.url);
  const email = normalizeEmail(url.searchParams.get("email"));
  const token = readString(url.searchParams.get("token"), 240);
  if (!email || !token) return htmlResponse("OutLoud email verification", "This verification link is incomplete.", 400);

  const tokenHash = await hashAccessToken(token);
  const { data: row, error } = await supabase
    .from("email_subscriptions")
    .select("id, unsubscribed_at")
    .eq("email", email)
    .eq("verification_token_hash", tokenHash)
    .maybeSingle<{ id: string; unsubscribed_at: string | null }>();

  if (error || !row) return htmlResponse("OutLoud email verification", "This verification link is invalid or expired.", 404);
  if (row.unsubscribed_at) {
    return htmlResponse("OutLoud email verification", "This email is unsubscribed. Save a new return reminder to opt in again.", 410);
  }

  const now = new Date().toISOString();
  await supabase.from("email_subscriptions").update({ verified_at: now, updated_at: now }).eq("id", row.id).is("verified_at", null);

  return htmlResponse(
    "OutLoud email verified",
    "Your email is verified. OutLoud can now send your private return link when practice is due.",
  );
}
