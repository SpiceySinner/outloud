import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Shared storage for the multi-request engine state behind /api/coach and /api/converse.
 *
 * Both engines are conversational: `start` builds the state, later `respond` calls read and
 * extend it. Holding that in a module-level Map only works while every request hits the same
 * long-running process. On a serverless host it does not: `respond` can land on a different or
 * cold-started instance than `start` did, and the learner gets "session expired" mid-sentence.
 * Storing the state against its id (see supabase/202608200002_engine_sessions.sql) removes the
 * question of which instance answers.
 *
 * Without Supabase credentials this falls back to a process-local Map so `npm run dev` and the
 * mock-AI path keep working unchanged -- with the same single-process caveat as before.
 */

const TABLE = "engine_sessions";

/** Long enough for a slow learner to think between turns, short enough to stay disposable. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export type SessionKind = "coach" | "converse";

type MemoryEntry = { kind: SessionKind; state: unknown; expiresAt: number };
const memory = new Map<string, MemoryEntry>();

let warnedAboutMemoryFallback = false;

function expiryFromNow() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

function memoryFallback() {
  if (!warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true;
    console.warn(
      "[session-store] Supabase is not configured; engine sessions are kept in process memory. " +
        "This breaks as soon as more than one instance serves requests.",
    );
  }
  return memory;
}

/** Persist a brand-new session. Also clears out anything that has aged out, in the background. */
export async function createSession<T>(kind: SessionKind, id: string, state: T) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    memoryFallback().set(id, { kind, state, expiresAt: Date.now() + SESSION_TTL_MS });
    pruneMemory();
    return;
  }

  const { error } = await supabase.from(TABLE).insert({
    id,
    kind,
    state,
    expires_at: expiryFromNow().toISOString(),
  });
  if (error) throw new Error(`Could not open the ${kind} session: ${error.message}`);

  // Fire-and-forget: an indexed delete on a table that only ever holds live sessions. Doing it
  // here rather than on every turn keeps the cost off the conversational path.
  void supabase
    .from(TABLE)
    .delete()
    .lt("expires_at", new Date().toISOString())
    .then(undefined, () => undefined);
}

export async function loadSession<T>(kind: SessionKind, id: string): Promise<T | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const entry = memoryFallback().get(id);
    if (!entry || entry.kind !== kind) return null;
    if (entry.expiresAt <= Date.now()) {
      memory.delete(id);
      return null;
    }
    return entry.state as T;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select("state, expires_at")
    // A malformed id makes Postgres reject the uuid comparison; that surfaces as `error` and is
    // treated the same as "not found", which is what the caller wants either way.
    .eq("id", id)
    .eq("kind", kind)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return null;
  return data.state as T;
}

/** Write the state back after a turn, and push the expiry out while the session stays active. */
export async function saveSession<T>(kind: SessionKind, id: string, state: T) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    memoryFallback().set(id, { kind, state, expiresAt: Date.now() + SESSION_TTL_MS });
    return;
  }

  const { error } = await supabase
    .from(TABLE)
    .update({ state, updated_at: new Date().toISOString(), expires_at: expiryFromNow().toISOString() })
    .eq("id", id)
    .eq("kind", kind);
  if (error) throw new Error(`Could not continue the ${kind} session: ${error.message}`);
}

export async function deleteSession(kind: SessionKind, id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    memoryFallback().delete(id);
    return;
  }

  // A failed cleanup is harmless -- the row expires on its own -- so this never blocks a reply.
  await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("kind", kind)
    .then(undefined, () => undefined);
}

function pruneMemory() {
  const now = Date.now();
  for (const [id, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(id);
  }
}
