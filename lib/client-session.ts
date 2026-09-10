/**
 * The browser's own id for a learner who has not signed in.
 *
 * It is what `sessions.anonymous_identifier` holds, what saved runs are keyed on before there is
 * an account, and now what a planned event belongs to. Lifted out of `app/page.tsx`, where it was
 * a `useState` initialiser, because `/dash` needs the SAME id: minting a second one there would
 * quietly split one learner into two, and the event they planned at the door would not be theirs
 * when they got to the room.
 */

export const clientSessionKey = "outloud-session-id";

/**
 * A real v4 UUID, always. `sessions.id` is a `uuid` column and events reference it, so the old
 * `Date.now()`-and-random fallback would have produced an id the database refuses.
 */
function newId() {
  // Held in a local rather than tested with `in`: the DOM types declare both members as always
  // present, so narrowing on them leaves the fallback branch typed `never`.
  const source = typeof crypto === "undefined" ? undefined : crypto;
  if (source?.randomUUID) return source.randomUUID();

  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Reads the id, creating one on first use. Null on the server, where there is no browser. */
export function getClientSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(clientSessionKey);
    if (existing) return existing;
    const next = newId();
    window.localStorage.setItem(clientSessionKey, next);
    return next;
  } catch {
    // Private mode, or storage blocked. Callers treat a null id as "nothing to save against"
    // rather than failing -- the screen still works, it just cannot remember across visits.
    return null;
  }
}
