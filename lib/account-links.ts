/**
 * Hand-off between the dashboard and the practice room. The room owns a lot of state that is
 * awkward to rebuild from a URL, so "continue this" writes the saved rescue into sessionStorage
 * and the room picks it up on mount.
 */

export const resumeMomentKey = "outloud-resume-moment";

/**
 * Set by /dash when the orb is tapped with nothing to pick up. The room reads it on mount and
 * goes straight into a session instead of showing the landing panel -- otherwise "tap the orb and
 * talk" costs two taps and a screen that says the same thing again.
 */
export const autoStartKey = "outloud-autostart";

export type ResumeMoment = {
  momentId: string;
  summary: string;
  rescue: unknown;
};

export function formatSavedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
