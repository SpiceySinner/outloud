import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthedUser = {
  id: string;
  email: string;
};

/**
 * Resolves the signed-in Supabase user from an `Authorization: Bearer <access_token>` header.
 *
 * The browser holds the session; server routes get the access token in the header and verify it
 * with the service-role client. Returns null for missing, malformed, or expired tokens -- callers
 * decide whether that is a 401 or an anonymous path.
 */
export async function getAuthedUser(request: Request, supabase: SupabaseClient): Promise<AuthedUser | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return null;

  return { id: data.user.id, email: data.user.email };
}
