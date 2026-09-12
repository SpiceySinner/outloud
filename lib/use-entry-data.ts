"use client";

import { useEffect, useMemo, useState } from "react";
import { dueMoments, focusFromMoments, type FocusReading, type MomentCard } from "@/lib/dashboard-data";
import { mockEvent } from "@/lib/dashboard-mock";
import { loadEvents, todayIsoLocal } from "@/lib/event-client";
import { dueBeat, eventDayLabel, eventStatusFor, upcomingBeat } from "@/lib/event-plan";
import type { EventBeat, StoredEvent } from "@/lib/event-schema";
import { useLibraryData, type LibraryState } from "@/lib/use-library-data";

/**
 * Everything waiting for a learner, and the order it is waiting in.
 *
 * Lifted out of `app/dash/page.tsx` on 2026-09-11 so the room can show the same thing. The
 * individual helpers -- `focusFromMoments`, `dueMoments`, `eventStatusFor` -- were already shared;
 * what was not was the RANKING they are applied in, and that ranking is the design:
 *
 *   a dated evening  beats  an overdue phrase  beats  the last thing they did
 *
 * because spaced retrieval is a promise the app made itself and friday is one the world made. Two
 * screens each deciding that for themselves is how they end up telling the same person two
 * different things about what they should do next.
 *
 * `previewByDefault` is the one thing the hosts disagree about, so it is a parameter. `/dash` says
 * yes -- it is an unfinished screen worth looking at without a month of practice behind it. **The
 * room must say no.** Invented practice on the real homepage, wearing a signed-out visitor's
 * session, is the worst version of this feature and the badge is not a good enough guard for it.
 */
export type EntryData = {
  libraryState: LibraryState;
  /** True when what is on screen is invented. Nothing may be written on behalf of a preview. */
  preview: boolean;
  /** The signed-in address, when the library knows one. */
  email: string | null;
  moments: MomentCard[];
  due: MomentCard[];
  focus: FocusReading | null;
  pickUp: MomentCard | null;
  pickUpIsDue: boolean;
  liveEvent: StoredEvent | null;
  readyBeat: EventBeat | null;
  nextBeat: EventBeat | null;
  eventDay: string | null;
  doneEvent: StoredEvent | null;
  todayIso: string;
  /** The raw list. The host needs it to find the event whose closed question is on screen. */
  events: StoredEvent[];
  /** The engine patches and creates events; the list lives here. */
  setEvents: React.Dispatch<React.SetStateAction<StoredEvent[]>>;
};

export function useEntryData({ previewByDefault = false }: { previewByDefault?: boolean } = {}): EntryData {
  const { state, data, preview } = useLibraryData({ previewByDefault });
  const [events, setEvents] = useState<StoredEvent[]>([]);
  /**
   * Today where the LEARNER is, pinned once. Read during render it would be impure, and a
   * countdown that shifts between renders is exactly the kind of small lie this app cannot
   * afford. A tab left open across midnight keeps yesterday, which is the same trade the room
   * makes with `sessionClosedAt` and is worth far less than the drift.
   */
  const [todayIso] = useState(todayIsoLocal);

  const moments = useMemo(() => data?.moments ?? [], [data]);
  const focus = useMemo(() => focusFromMoments(moments), [moments]);
  const due = useMemo(() => dueMoments(moments), [moments]);

  /**
   * The one thing on the card. Something overdue beats the last thing they did: an overdue item
   * is the app keeping a promise it already made, and it is the only claim on this screen with a
   * deadline attached.
   */
  const pickUp: MomentCard | null = due[0] ?? moments[0] ?? null;
  const pickUpIsDue = due.length > 0;

  /**
   * The event still ahead of them, if there is one. It outranks everything else on this screen:
   * spaced retrieval is a promise the app made itself, and a dated evening is one the world made.
   */
  const liveEvent = useMemo(
    () =>
      events.find((event) => {
        const status = eventStatusFor(event, todayIso);
        return status === "planned" || status === "running";
      }) ?? null,
    [events, todayIso],
  );
  /** The go they could do right now, and the go that is next whether or not it is due. */
  const readyBeat = liveEvent ? dueBeat(liveEvent.beats, todayIso) : null;
  const nextBeat = liveEvent ? upcomingBeat(liveEvent.beats) : null;
  const eventDay = liveEvent ? eventDayLabel(liveEvent.happensOn, todayIso) : null;

  /**
   * An evening that has been and gone and has not been asked about yet.
   *
   * It outranks even a live event on this screen: it is the only question here that stops being
   * answerable, and it is the one piece of evidence about whether any of this works in the world
   * rather than in the app.
   */
  const doneEvent = useMemo(
    () => events.find((event) => eventStatusFor(event, todayIso) === "done") ?? null,
    [events, todayIso],
  );

  /**
   * Loaded once, and allowed to fail silently. An entry screen that breaks itself because an
   * optional table could not be reached is worse than one that simply has no event to show.
   */
  useEffect(() => {
    // Gated on the library having settled. `preview` starts false and is set asynchronously, so
    // running on the first render fires a real request for a real learner's events on a screen
    // that is about to declare itself invented -- and the whole promise of the preview badge is
    // that nothing on that screen is yours.
    if (state === "loading") return;
    let alive = true;
    const timer = window.setTimeout(() => {
      // The preview shows an invented event, because the newest half of this screen is worth
      // looking at without an account and a real dinner to dread. `?event=0` takes it away, which
      // is how the layout harness measures the version with nothing planned.
      if (preview) {
        let wanted: string | null = null;
        try {
          wanted = new URLSearchParams(window.location.search).get("event");
        } catch {
          // No URL to read: keep the running event.
        }
        if (alive) {
          setEvents(
            wanted === "0" ? [] : [mockEvent(todayIso, { past: wanted === "done" })],
          );
        }
        return;
      }
      void loadEvents().then((list) => {
        if (alive) setEvents(list);
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [preview, state, todayIso]);

  return {
    libraryState: state,
    preview,
    email: data?.user.email ?? null,
    moments,
    due,
    focus,
    pickUp,
    pickUpIsDue,
    liveEvent,
    readyBeat,
    nextBeat,
    eventDay,
    doneEvent,
    todayIso,
    events,
    setEvents,
  };
}
