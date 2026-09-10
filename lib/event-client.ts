"use client";

import { getClientSessionId } from "@/lib/client-session";
import type { EventBeat, StoredEvent } from "@/lib/event-schema";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Talking to `/api/events` from the browser. Plain functions rather than a hook, because both
 * screens need them and one of them needs them from inside an event handler: `/dash` creates and
 * updates events, and the room loads one to run a beat and writes back what it did.
 *
 * **Every one of these swallows its failures and returns null or an empty list.** A learner whose
 * events cannot be reached still gets the whole entry screen exactly as it was before this feature
 * existed -- the alternative is a page that breaks itself over an optional row.
 */

/** Today where the LEARNER is, as `YYYY-MM-DD`. `en-CA` is ISO order, which is the whole trick. */
export function todayIsoLocal() {
  return new Date().toLocaleDateString("en-CA");
}

export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** The weekday name for today, so the planner does not have to work it out from a date. */
export function todayWeekday() {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

async function headers(): Promise<Record<string, string>> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const supabase = getSupabaseBrowser();
    if (!supabase) return base;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    // Sent when there is one, absent when there is not. The route accepts both: an event planned
    // signed out is claimed to the account the first time an authed request arrives.
    if (token) base.Authorization = `Bearer ${token}`;
  } catch {
    // No auth available. The anonymous path is the normal one at this screen anyway.
  }
  return base;
}

export async function loadEvents(): Promise<StoredEvent[]> {
  const sessionId = getClientSessionId();
  try {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    const response = await fetch(`/api/events${query}`, { headers: await headers() });
    const json = await response.json();
    if (!response.ok) return [];
    return Array.isArray(json.events) ? (json.events as StoredEvent[]) : [];
  } catch {
    return [];
  }
}

export async function loadEvent(id: string): Promise<StoredEvent | null> {
  const events = await loadEvents();
  return events.find((event) => event.id === id) ?? null;
}

export type NewEvent = {
  said: string;
  nameEn: string;
  situationEn: string;
  whoEn: string | null;
  whenSaid: string | null;
  happensOn: string | null;
  beats: EventBeat[];
};

export async function createEvent(input: NewEvent): Promise<StoredEvent | null> {
  const sessionId = getClientSessionId();
  if (!sessionId) return null;
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({
        id: crypto.randomUUID(),
        sessionId,
        timezone: localTimezone(),
        ...input,
      }),
    });
    const json = await response.json();
    return response.ok ? (json.event as StoredEvent) : null;
  } catch {
    return null;
  }
}

export type EventPatch = {
  rescue?: unknown;
  focusBlocker?: string | null;
  beat?: { index: number; momentId: string | null; completedAt: string };
  outcomeSaid?: string;
  outcomeSpoke?: boolean | null;
  status?: StoredEvent["status"];
};

export async function patchEvent(id: string, patch: EventPatch): Promise<StoredEvent | null> {
  const sessionId = getClientSessionId();
  if (!sessionId) return null;
  try {
    const response = await fetch("/api/events", {
      method: "PATCH",
      headers: await headers(),
      body: JSON.stringify({ id, sessionId, ...patch }),
    });
    const json = await response.json();
    return response.ok ? (json.event as StoredEvent) : null;
  } catch {
    return null;
  }
}
