import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * Browser-side Supabase client for auth (create-account dialog). Needs the PUBLIC anon key --
 * never the service_role key, which must stay server-only. Returns null until
 * NEXT_PUBLIC_SUPABASE_ANON_KEY is configured; the dialog then falls back to email-only capture.
 */
export function getSupabaseBrowser() {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && anonKey ? createClient(url, anonKey) : null;
  return client;
}
