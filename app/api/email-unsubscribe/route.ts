import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashAccessToken, htmlResponse, json, normalizeEmail, readString } from "@/lib/persistence";

export async function GET(request: Request) {
  return unsubscribe(request);
}

export async function POST(request: Request) {
  return unsubscribe(request);
}

async function unsubscribe(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return htmlResponse("OutLoud unsubscribe", "Email storage is not connected yet.", 503);

  const url = new URL(request.url);
  const email = normalizeEmail(url.searchParams.get("email"));
  const token = readString(url.searchParams.get("token"), 240);
  if (!email || !token) return json({ error: "This unsubscribe link is incomplete." }, 400);

  const tokenHash = await hashAccessToken(token);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("email_subscriptions")
    .update({ unsubscribed_at: now, updated_at: now })
    .eq("email", email)
    .eq("verification_token_hash", tokenHash)
    .select("id");

  if (error || !data?.length) return htmlResponse("OutLoud unsubscribe", "This unsubscribe link is invalid.", 404);
  return htmlResponse("OutLoud unsubscribe", "You are unsubscribed from OutLoud return emails.");
}
