/**
 * Hand-off between the dashboard and the practice room. The room owns a lot of state that is
 * awkward to rebuild from a URL, so "continue this" writes the saved rescue into sessionStorage
 * and the room picks it up on mount.
 */

export const resumeMomentKey = "outloud-resume-moment";

/**
 * The room, put down on purpose, waiting to be picked back up.
 *
 * The odd one out in this file: every other key here is a hand-off *between* two screens, written
 * by one and read by the other. This one the room writes about itself, before a navigation it
 * expects to come back from — the account pill, or a reload.
 *
 * It lives here anyway because signing out has to clear it, and that lives on `/account`. A run
 * restored after somebody signed out would be the right practice wearing the wrong session.
 *
 * **`sessionStorage`, never `localStorage`,** and that is the whole safety argument. The auth
 * snapshot can be careless about provenance because it exists only while a redirect is in flight;
 * this one exists after every way out, so it needs a lifetime that ends when the intention does. A
 * tab is exactly that lifetime.
 *
 * Last in the room's precedence ladder, below all five keys above: anything that names a
 * particular conversation to start beats coming back to the one you left.
 */
export const leftRoomKey = "outloud-left-room";

/**
 * Set by /dash when the orb is tapped with nothing to pick up. The room reads it on mount and
 * goes straight into a session instead of showing the landing panel -- otherwise "tap the orb and
 * talk" costs two taps and a screen that says the same thing again.
 */
export const autoStartKey = "outloud-autostart";

/**
 * Set by /dash when a go at a planned event is picked up. The room reads it on mount and runs
 * that beat: the first one is the intake seeded with the event, every one after it is a scene
 * started from the rescue the first produced.
 *
 * More specific than `autoStartKey` and less specific than `resumeMomentKey`, which is the order
 * the room checks them in.
 */
export const eventBeatKey = "outloud-event-beat";

export type EventBeatHandoff = {
  eventId: string;
  beatIndex: number;
};

/**
 * Set by /dash when somebody describes a moment that already went wrong. The room reads it on
 * mount and runs its `stung` intake seeded with the sentence, which is what that intake was built
 * for — it simply never had a way in from the entry screen.
 *
 * Both halves travel. `said` is what the learner actually put into the microphone and is what
 * the intake is seeded with, for the same reason `runEventBeat` sends `event.said`: a paraphrase
 * of somebody's life is a worse description of it than what they said. `situationEn` is the
 * router's one-line reading of it, and it does a different job — it tells the coach that the
 * situation is already settled, which is what removes the framing turn that would otherwise ask
 * somebody who just named their pharmacy whether they would rather talk about their job.
 *
 * Less specific than `eventBeatKey` (no target yet, only a description) and more specific than
 * `autoStartKey`, which is the order the room checks them in.
 */
export const stungKey = "outloud-stung-said";

export type StungHandoff = {
  said: string;
  situationEn: string;
};

/**
 * Set by /dash when somebody asks how to say something. The room reads it on mount and opens on
 * the answer — not in an overlay, because overlays close the microphone and the whole point of
 * this phase is that they have to say the thing out loud.
 *
 * `askEn` is the sentence with the asking stripped off, which is what makes the rest of the chain
 * possible: it becomes `originalText` in the rescue, and `originalText` is the thing normally
 * missing when there is no scene to have failed in.
 */
export const askPhraseKey = "outloud-ask-phrase";

export type AskPhraseHandoff = {
  /** What they actually said into the microphone. Shown back, never sent to the lifeline. */
  said: string;
  /** The sentence they want to be able to say, in English. This is what gets answered. */
  askEn: string;
};

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
