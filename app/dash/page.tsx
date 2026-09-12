"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OrbCanvas } from "@/app/components/OrbCanvas";
import PickUpCard, { FocusLine } from "@/app/components/PickUpCard";
import StepsDrawer from "@/app/components/StepsDrawer";
import {
  autoStartKey,
  eventBeatKey,
  resumeMomentKey,
  askPhraseKey,
  stungKey,
  type AskPhraseHandoff,
  type StungHandoff,
  type EventBeatHandoff,
  type ResumeMoment,
} from "@/lib/account-links";
import type { MomentCard } from "@/lib/dashboard-data";
import type { StoredEvent } from "@/lib/event-schema";
import { initTracking, track } from "@/lib/track";
import { useEntryData } from "@/lib/use-entry-data";
import { useVoiceEntry } from "@/lib/use-voice-entry";

/**
 * /dash -- one screen, no scroll, the orb in the middle, and a microphone that actually listens.
 * See `VOICE_ENTRY.md` for the design.
 *
 * The problem this screen exists to solve: a text field has a placeholder, a menu has items, and
 * **a microphone offers nothing**. The learner has to guess what the system understands, and voice
 * products die exactly there -- someone says the one sentence it cannot handle and concludes it
 * does not work.
 *
 * So the header above the orb is the vocabulary, written as the words a learner would actually
 * say, because "tell me about friday" teaches a sentence and "you can describe an upcoming
 * situation" teaches a category and helps nobody. And the read-back is the contract: the beat
 * after they stop talking and before anything happens, where the screen shows what it understood.
 * A misunderstanding here does not cost a second, it costs a whole session -- which is why nothing
 * ever proceeds on a guess. `unclear` is a real answer with its own copy.
 *
 * The capture itself belongs to `lib/voice-session.ts` and the verdicts to `lib/voice-guards.ts`.
 * Not one rule about what an utterance is lives in this file: the room learned every one of them
 * the hard way, and a second copy here would drift back into those bugs one at a time.
 */

/** How long the collapse runs before the room takes over. Matches the CSS. */
const leaveMs = 420;


/**
 * What a SIGNED-OUT visitor sees while this screen is still being designed: the preview account,
 * badged, because looking at the layout should not require an account and a month of practice
 * behind it. `?preview=0` shows the empty truth instead.
 *
 * It used to mean rather more than that. `useLibraryData` checked it before it checked anything
 * else, so every visitor got the invented month -- signed in or not -- and a learner opening this
 * screen was shown a stranger's practice in their own account, behind a badge the size of a word.
 * The hook now checks the session first; this only decides what happens when there is no session.
 *
 * **This is still the only line to change when the page is finished.** It is a constant rather than
 * a check scattered through the component so that switching it off cannot be half-done, and the
 * badge in the corner is wired to the same value -- a screen showing invented practice must never
 * be able to look like it is showing yours.
 */
const previewByDefault = true;



export default function DashPage() {
  const router = useRouter();
  const {
    libraryState: state,
    preview,
    email,
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
  } = useEntryData({ previewByDefault });

  const [leaving, setLeaving] = useState(false);
  /**
   * The drawer holding every go at the live event.
   *
   * The card can only ever show the next one, which is right for a screen whose whole job is "one
   * thing to do". But an evening broken into four pieces is a plan, and a plan you cannot read is
   * a plan you have to take on trust. This is where you read it.
   */
  const [stepsFor, setStepsFor] = useState<string | null>(null);






  /*
   * The engine. It owns the phase machine, the microphone and the router; this page owns the data
   * and what happens once a sentence has been understood. On `/dash` that means writing a hand-off
   * key and navigating; in the room the same hook calls the room's own functions instead.
   */
  const {
    phase,
    retry,
    micBlocked,
    header,
    orbState,
    orbBusy,
    orbProps,
    typedDraft,
    setTypedDraft,
    submitTyped,
    answerSpoke,
    standDown,
    rest,
  } = useVoiceEntry(
    {
      libraryState: state,
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
      events,
      todayIso,
      preview,
      busy: leaving,
    },
    { startBeat, resumeMoment, startAskPhrase, startStung, onEventsChanged: setEvents },
  );

  // Q1's denominator. Fired once the screen knows what it is showing, never while loading: an
  // arrival counted before the data lands would put everybody in the "nothing waiting" bucket.
  const arrivedRef = useRef(false);
  useEffect(() => {
    if (state === "loading" || arrivedRef.current) return;
    arrivedRef.current = true;
    initTracking();
    track("dash_arrived", {
      signedIn: state === "ready",
      openItems: moments.length,
      hasEvent: Boolean(liveEvent),
    });
  }, [state, moments.length, liveEvent]);

  // Escape closes the drawer. Cheap, and the one keyboard affordance a phone-shaped screen still
  // owes anybody who opens it on a laptop.
  useEffect(() => {
    if (!stepsFor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStepsFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepsFor]);



  // ------------------------------------------------------------------ acting

  function leaveTo(write: () => void) {
    if (leaving) return;
    try {
      write();
    } catch {
      // Storage blocked: the room simply starts fresh, which is still the right screen.
    }
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      router.push("/");
      return;
    }
    setLeaving(true);
    window.setTimeout(() => router.push("/"), leaveMs);
  }

  /**
   * Hands a saved rescue to the room. Inert in preview: an invented one would write practice that
   * never happened into a real account.
   */
  function resumeMoment(moment: MomentCard | null) {
    if (!moment) {
      rest("that one isn't here any more.", "pick something else, or describe a situation.");
      return;
    }
    if (preview) {
      // Silent: nothing was asked, and a screen narrating its own preview mode is noise.
      rest("preview — this would open that conversation.", "", { silent: true });
      return;
    }
    const payload: ResumeMoment = { momentId: moment.id, summary: moment.summary, rescue: moment.rescue };
    leaveTo(() => window.sessionStorage.setItem(resumeMomentKey, JSON.stringify(payload)));
  }


  /**
   * Opens the drawer, and shuts the microphone if it was listening.
   *
   * Not a courtesy. An open capture window behind a panel of text is the worst combination this
   * screen can produce: the learner reads, server VAD hears nothing, and the header comes back
   * with "I didn't catch what you want to do" about a sentence nobody tried to say. Silent,
   * because nothing was asked -- speaking here would be the app narrating its own plumbing.
   */
  function openSteps(event: StoredEvent) {
    standDown();
    setStepsFor(event.id);
  }

  /**
   * Hands one go at a planned event to the room.
   *
   * Only the ids travel. The room loads the event itself, because by the time it runs the beat it
   * needs the rescue and the character too -- and a copy of all that in sessionStorage would be a
   * second source of truth for something the learner is in the middle of.
   */
  /**
   * A moment that already went wrong, handed to the room's `stung` intake.
   *
   * Their sentence travels, not the router's summary of it — the intake's first prompt treats
   * the opening answer as the learner describing their own life, and a paraphrase is a worse
   * description of that than what they said. Same reason the event engine sends `event.said`.
   */
  /**
   * A phrase question, into the room.
   *
   * Into the ROOM rather than answered here, and that is the whole design decision: the answer is
   * only half of it, and the half that makes this OutLoud rather than a dictionary is the two
   * seconds where they have to say it back. /dash cannot host that — it pins the transcriber to
   * English and its microphone belongs to the router.
   */
  function startAskPhrase(said: string, askEn: string) {
    if (preview) {
      // Silent: nothing was asked, and a screen narrating its own preview mode is noise.
      rest("preview — this would answer that in the room.", "", { silent: true });
      return;
    }
    const payload: AskPhraseHandoff = { said, askEn };
    leaveTo(() => window.sessionStorage.setItem(askPhraseKey, JSON.stringify(payload)));
  }

  function startStung(said: string, situationEn: string) {
    if (preview) {
      // Silent: nothing was asked, and a screen narrating its own preview mode is noise.
      rest("preview — this would take that into the room.", "", { silent: true });
      return;
    }
    const payload: StungHandoff = { said, situationEn };
    leaveTo(() => window.sessionStorage.setItem(stungKey, JSON.stringify(payload)));
  }

  function startBeat(event: StoredEvent, beatIndex: number) {
    if (preview) {
      // Silent: nothing was asked, and a screen narrating its own preview mode is noise.
      rest("preview — this would start that go.", "", { silent: true });
      return;
    }
    const payload: EventBeatHandoff = { eventId: event.id, beatIndex };
    leaveTo(() => window.sessionStorage.setItem(eventBeatKey, JSON.stringify(payload)));
  }

  /** The explicitly offered fallback when nothing is waiting: the intake, chosen rather than slipped into. */
  function startTalking() {
    leaveTo(() => window.sessionStorage.setItem(autoStartKey, "1"));
  }

  function pickUpThis() {
    resumeMoment(pickUp);
  }

  // ------------------------------------------------------------------ the header

  /**
   * Three resting states, and which one you get is decided by the database rather than by a mood:
   * something waiting, nothing waiting but a history, or nothing at all.
   *
   * Line two always names the *other* thing you could say, so two options get learned at once
   * without rotation, without motion, and without another control on a screen built to have
   * almost none.
   */

  return (
    <main className={leaving ? "dash-shell is-leaving" : "dash-shell"} aria-label="OutLoud">
      {preview ? (
        <Link className="dash-preview" href="/dash?preview=0">
          preview
        </Link>
      ) : null}

      {/* The middle band: the vocabulary, the act, and what we are working on. */}
      <div className="dash-stage">
        <div className="dash-header" aria-live="polite">
          <p className="dash-lead">{header.lead}</p>
          <p className="dash-alt">{header.alt}</p>
        </div>

        <button className="dash-orb-wrap" type="button" {...orbProps}
        >
          <OrbCanvas state={leaving ? "listening" : orbState} className="dash-orb" size={440} />
        </button>

        {/* #47 -- the focus, named every time. Different job from the header: that says what to
            say, this says what we are working on. They must not be merged. */}
        {/*
          Shown from the moment the microphone is known to be unreachable, and NOT only during the
          `blocked` phase -- a sentence the router does not understand drops back to `resting`, and
          a box that vanished there would move the dead end rather than remove it.
        */}
        {micBlocked && !orbBusy ? (
          <form
            className="dash-typed"
            onSubmit={(event) => {
              event.preventDefault();
              void submitTyped(typedDraft);
            }}
          >
            <input
              className="dash-typed-box"
              type="text"
              aria-label="type what you want to do"
              placeholder="type it instead"
              value={typedDraft}
              onChange={(event) => setTypedDraft(event.target.value)}
              disabled={leaving}
            />
            <button className="dash-typed-go" type="submit" disabled={!typedDraft.trim() || leaving}>
              go
            </button>
          </form>
        ) : null}

        {focus && phase === "resting" && !retry ? <FocusLine label={focus.label} /> : null}
      </div>

      {/* The bottom band: exactly one thing to pick up, in thumb reach, and the way out. */}
      <div className="dash-bottom">
        {phase === "kept" || phase === "declined" ? <p className="dash-offer">what I can do right now:</p> : null}

        {/*
         * One row, shared. The card is the thing to do next; the disc is the way to your account.
         * They belong on the same line because the account is not a fifth thing to do -- it is
         * the edge of the screen, and putting it in the tray below made it compete with
         * "everything" for the same job.
         */}
        <PickUpCard
          event={liveEvent}
          nextBeat={nextBeat}
          readyBeat={Boolean(readyBeat)}
          stepsOpen={Boolean(liveEvent && stepsFor === liveEvent.id)}
          moment={pickUp}
          momentIsDue={pickUpIsDue}
          libraryReady={state === "ready"}
          askOutcome={phase === "outcome"}
          todayIso={todayIso}
          accountEmail={email}
          accountHref={null}
          disabled={leaving}
          onAnswerSpoke={answerSpoke}
          onStartBeat={(beatIndex) => {
            if (liveEvent) startBeat(liveEvent, beatIndex);
          }}
          onOpenSteps={() => {
            if (liveEvent) openSteps(liveEvent);
          }}
          onPickUp={pickUpThis}
          onStartTalking={startTalking}
        />

        <div className="dash-tray">
          <Link className="dash-tray-link" href="/account">
            everything
          </Link>
        </div>
      </div>

      {/*
       * Every go at the evening, in order, in a drawer that comes up from the bottom.
       *
       * Absolutely positioned inside `.dash-shell`, not fixed to the viewport: the shell already
       * caps itself at 430px and clips its overflow, so the drawer inherits both and the slide-up
       * starts from genuinely off-screen instead of from a guessed offset.
       */}
      {liveEvent && stepsFor === liveEvent.id ? (
        <StepsDrawer
          event={liveEvent}
          eventDay={eventDay}
          nextBeatIndex={nextBeat?.index ?? null}
          todayIso={todayIso}
          disabled={leaving}
          onStartBeat={(beatIndex) => startBeat(liveEvent, beatIndex)}
          onClose={() => setStepsFor(null)}
        />
      ) : null}
    </main>
  );
}
