"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultConversationContext } from "@/lib/character-voice";
import { daysOverdue, type FocusReading, type MomentCard } from "@/lib/dashboard-data";
import { createEvent, localTimezone, patchEvent, todayWeekday } from "@/lib/event-client";
import { buildPlan, eventDayLabel } from "@/lib/event-plan";
import type { EventBeat, EventPlanResponse, StoredEvent } from "@/lib/event-schema";
import { canRun, type IntentResponse } from "@/lib/intent-schema";
import { saidLength, track } from "@/lib/track";
import type { LibraryState } from "@/lib/use-library-data";
import { classifyCapture } from "@/lib/voice-guards";
import { voice, type RealtimeServerEvent } from "@/lib/voice-session";

/**
 * The orb that listens, and everything behind it: the phase machine, the microphone, the router,
 * the read-back and the two questions the screen can ask back.
 *
 * Lifted out of `app/dash/page.tsx` on 2026-09-11. The point of it being a hook rather than a
 * component is that **the same engine has to run on two screens that do different things with
 * the answer.** On `/dash` a resolved intent writes a hand-off key and navigates to the room; in
 * the room it simply calls the function that already runs that go. Pasting the engine into the
 * room instead would have added ~800 lines to a file that had just had 535 taken out of it, and
 * left two copies of the one thing on this screen that must not drift: what a sentence means.
 *
 * So the hook owns the machinery and knows nothing about what happens next. It takes what is on
 * screen (`EntryContext`) and what to do about it (`EntryActions`), and both arrive through refs
 * -- the host rebuilds those objects every render, and a dependency array containing them would
 * rebuild the entire engine with it.
 *
 * **What is deliberately NOT in here:** the library data, the events list, today's date, and every
 * derivation over them. They stay with the host, for the reason `lib/dashboard-data.ts` gives in
 * its own header -- the same claim about a learner computed in two places is how an app ends up
 * telling somebody two different things about themselves.
 *
 * The transcription language is pinned to English on connect, and that pin belongs to the CAPTURE
 * rather than to the page: saying what you want is English, a turn in a scene is Spanish. Two
 * screens holding two policies for one `voice` singleton is what produced the language bug on
 * 2026-09-11, and it is the fault this hook exists to make impossible rather than to relocate.
 */

/** How long the read-back holds before anything acts on it. Long enough to read, short enough not to wait. */
const readBackMs = 1500;

/** A press longer than this is hold-to-talk; a shorter one is a tap that leaves the mic open. */
const holdToTalkMs = 700;

/** Tapped the orb and then said nothing. The mic does not stay open on the promise of a sentence. */
const idleMs = 12000;

/** Hesitation-only captures we give the time back for before saying so out loud. */
const maxFillerRetries = 2;

/** Kept `new_scenario` and `talk` sentences, so the promise on screen is real without a network. */
const keptScenariosKey = "outloud-kept-scenarios";

/**
 * Where the entry screen is in one act of speaking.
 *
 * - `resting`    -- the three header states from section 4 of the design. Nothing is open.
 * - `connecting` -- the token, the permission prompt and the handshake. Named honestly: claiming
 *                   to be listening while the microphone is still being asked for is a small lie
 *                   that gets found out in the two seconds it takes.
 * - `listening`  -- the window is open. Server VAD ends it; no second tap needed.
 * - `thinking`   -- the transcript is in flight, then the router is.
 * - `readback`   -- understood. The contract line, before anything happens.
 * - `planned`    -- understood, and laid out. The goes before a real date, just made.
 * - `outcome`    -- they said how the evening went, and there is one closed question left.
 * - `kept`       -- understood, and honestly not built YET. See section 7.
 * - `declined`   -- understood, and not being built at all. Its own phase rather than a flag on
 *                   `kept`, because the two say opposite things to the same person: one is a
 *                   promise and the other is a no, and dressing the no up as the promise is a lie
 *                   with a long tail. Only `talk` lands here.
 * - `blocked`    -- no microphone here at all.
 */
type EntryPhase =
  | "resting"
  | "connecting"
  | "listening"
  | "thinking"
  | "readback"
  | "planned"
  | "outcome"
  | "kept"
  | "declined"
  | "blocked";

/**
 * An event described but not yet dated, held across the one follow-up question.
 *
 * `askedWhen` is the whole reason this is a shape rather than a boolean: somebody who says "I
 * don't know yet" has ANSWERED, and asking a second time is the app not listening. One question,
 * then the plan runs undated.
 */
type PendingEvent = {
  said: string;
  situationEn: string;
  whoEn: string | null;
  whenSaid: string | null;
  askedWhen: boolean;
};


/** Everything on screen that the router has to know about to place a sentence. */
export type EntryContext = {
  /** `loading` until the library settles. The resting header refuses to guess before then. */
  libraryState: LibraryState;
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
  /** The raw list, so the closed post-event question can find the event it belongs to. */
  events: StoredEvent[];
  todayIso: string;
  /** True when what is on screen is invented. Nothing may be written on behalf of a preview. */
  preview: boolean;
  /** The host is on its way somewhere. Everything goes inert rather than racing the transition. */
  busy: boolean;
};

/**
 * What to do once the sentence has been understood.
 *
 * This is the whole difference between the two hosts. `/dash` navigates; the room calls the
 * function it already has. The hook never learns which.
 */
export type EntryActions = {
  startBeat: (event: StoredEvent, beatIndex: number) => void;
  resumeMoment: (moment: MomentCard | null) => void;
  startAskPhrase: (said: string, askEn: string) => void;
  startStung: (said: string, situationEn: string) => void;
  /** An event was planned or patched. The host owns the list. */
  onEventsChanged: (update: (list: StoredEvent[]) => StoredEvent[]) => void;
};

export function useVoiceEntry(ctx: EntryContext, actions: EntryActions) {
  const [phase, setPhase] = useState<EntryPhase>("resting");
  const [readBack, setReadBack] = useState<string | null>(null);
  /**
   * Copy that replaces the resting header until the next successful capture: what went wrong, or
   * what to say instead. It sits in the header rather than in a note of its own because the header
   * is already the place this screen teaches from, and a second line of small print under the orb
   * would compete with the one thing worth reading.
   */
  const [retry, setRetry] = useState<{ lead: string; alt: string } | null>(null);
  /** Drives the orb while a line is being said. Tapping through it is allowed and cancels it. */
  const [speaking, setSpeaking] = useState(false);
  /** What the plan just laid out, held for the beat between planning it and resting again. */
  const [planLine, setPlanLine] = useState<string | null>(null);
  /**
   * The microphone is not reachable on this device, and we know because we tried.
   *
   * Kept separate from `phase === "blocked"` on purpose. The phase is a moment -- one failed
   * connection -- and it ends the instant anything else happens, including a sentence the router
   * did not understand. The FACT does not end: a browser that refused the microphone once will
   * refuse it again, and the typed way in has to survive a round trip through `resting` or the
   * dead end is merely moved one step further along.
   */
  const [micBlocked, setMicBlocked] = useState(false);
  /** The same fact, readable from the callbacks without putting it in six dependency arrays. */
  const micBlockedRef = useRef(false);
  const [typedDraft, setTypedDraft] = useState("");

  const patientRef = useRef(false);
  const fillerRetriesRef = useRef(0);
  const strikesRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  /** When the capture window opened, so `dash_mic_closed` can say how long they held it. */
  const openedAtRef = useRef(0);
  const pressKindRef = useRef<"start" | "finish" | null>(null);
  const pressStartedAtRef = useRef(0);
  const busyRef = useRef(false);
  /** Set only while the next capture is the answer to "when is it?" rather than a new request. */
  const pendingEventRef = useRef<PendingEvent | null>(null);
  /** The event whose "how did it go?" is currently on screen, if any. */
  const askingOutcomeRef = useRef<string | null>(null);
  /** The read-back beat between understanding a sentence and acting on it. A stand-down cancels it. */
  const handOffTimerRef = useRef<number | null>(null);
  /**
   * True while the open capture is one THIS engine opened. The voice session is shared with the
   * room and `voice.capturing` cannot say whose window it is; this can.
   */
  const ownsCaptureRef = useRef(false);

  /*
   * The host, reachable from inside a callback without appearing in its dependency array.
   *
   * Assigned in an effect rather than during render: every read below happens in a pointer
   * handler or an awaited continuation, which is after the commit, so the effect has always run.
   */
  const ctxRef = useRef(ctx);
  const actionsRef = useRef(actions);
  useEffect(() => {
    ctxRef.current = ctx;
    actionsRef.current = actions;
  });

  /*
   * The host has taken the screen: the engine is at rest, whatever it was doing.
   *
   * Adjusted during render, the way React asks for state that follows a prop, rather than in the
   * stand-down effect below -- the two halves of one stand-down, split by what each is allowed to
   * touch. This half is the engine's own state; that half is the shared voice session.
   */
  const [wasBusy, setWasBusy] = useState(ctx.busy);
  if (ctx.busy !== wasBusy) {
    setWasBusy(ctx.busy);
    if (ctx.busy && phase !== "resting") setPhase("resting");
  }

  /*
   * Stable local names for the host's actions, so the engine below reads exactly as it did when
   * it lived in the page. The alternative was rewriting ~50 call sites into `actionsRef.current.x`,
   * which would have turned a move into an edit and made the before/after comparison meaningless.
   */
  const setEvents = useCallback(
    (update: (list: StoredEvent[]) => StoredEvent[]) => actionsRef.current.onEventsChanged(update),
    [],
  );
  const startBeat = useCallback(
    (event: StoredEvent, beatIndex: number) => actionsRef.current.startBeat(event, beatIndex),
    [],
  );
  const resumeMoment = useCallback(
    (moment: MomentCard | null) => actionsRef.current.resumeMoment(moment),
    [],
  );
  const startAskPhrase = useCallback(
    (said: string, askEn: string) => actionsRef.current.startAskPhrase(said, askEn),
    [],
  );
  const startStung = useCallback(
    (said: string, situationEn: string) => actionsRef.current.startStung(said, situationEn),
    [],
  );

  /** The room holds this too. Whoever is mounted keeps the session alive across the hand-off. */
  useEffect(() => {
    voice.acquire();
    return () => {
      voice.release();
    };
  }, []);

  /**
   * Keeping the sentence is half of what section 7 buys.
   *
   * For the learner it turns a dead end into a promise. For us it is the corpus the upcoming-event
   * engine needs and does not have: real situations real people asked for, in their own words. The
   * local copy is what makes the promise on screen true with no network; the server copy is the
   * research. Preview sentences are kept locally only -- test data is not research.
   */
  async function keepIt(said: string, result: IntentResponse) {
    const { preview } = ctxRef.current;
    const entry = {
      said,
      intent: result.intent,
      readBackEn: result.readBackEn,
      situationEn: result.scenario?.situationEn ?? null,
      whoEn: result.scenario?.whoEn ?? null,
      whenEn: result.scenario?.whenEn ?? null,
      askEn: result.askEn,
      topicEn: result.topicEn,
      at: new Date().toISOString(),
    };
    try {
      const raw = window.localStorage.getItem(keptScenariosKey);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      window.localStorage.setItem(keptScenariosKey, JSON.stringify([entry, ...list].slice(0, 20)));
    } catch {
      // Storage blocked. The server copy below is the one that matters.
    }
    if (preview) return;
    try {
      await fetch("/api/kept-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch {
      // The promise on screen is already kept locally; this is only the research copy.
    }
  }

  function clearIdle() {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  /**
   * The beat between reading a sentence back and acting on it, held so a stand-down can cancel
   * it. Without the handle, a tap on the card during the read-back starts one session and the
   * timer starts a second one on top of it.
   */
  function handOff(action: () => void) {
    if (handOffTimerRef.current !== null) window.clearTimeout(handOffTimerRef.current);
    handOffTimerRef.current = window.setTimeout(() => {
      handOffTimerRef.current = null;
      action();
    }, readBackMs);
  }

  /**
   * Says a line out loud and resolves once the sound has actually stopped.
   *
   * The rule for what gets spoken: **the screen speaks when it is responding to something you
   * said, and stays quiet about its own plumbing.** Answering out loud is what makes speaking to
   * it feel like a conversation rather than dictation into a form; narrating a timeout at someone
   * who has walked away is just noise.
   *
   * Awaiting it matters wherever the microphone reopens afterwards. Opening the mic while the
   * coach is still audible means the coach's own voice trips the next turn, and `voice.speak`
   * resolves on playback drained precisely so that cannot happen.
   */
  const say = useCallback(async (line: string) => {
    // The connection is shared with the room. Once the room has the screen, its coach is the only
    // voice on it; a line from here would land in the middle of somebody's turn.
    if (ctxRef.current.busy) return;
    if (!line.trim() || !voice.isConnected()) return;
    setSpeaking(true);
    try {
      await voice.speak(line, { timeoutMs: 12000 });
    } finally {
      setSpeaking(false);
    }
  }, []);

  /** Back to rest with the microphone shut and a reason on the header. */
  const rest = useCallback(
    (lead: string, alt = "", options: { silent?: boolean } = {}) => {
      clearIdle();
      ownsCaptureRef.current = false;
      voice.abortCapture();
      voice.setMicWindow("closed");
      busyRef.current = false;
      setRetry({ lead, alt });
      setPhase("resting");
      if (!options.silent) void say(alt ? `${lead} ${alt}` : lead);
    },
    [say],
  );

  const armIdle = useCallback(() => {
    clearIdle();
    idleTimerRef.current = window.setTimeout(
      () => {
        // Speech was seen: the capture is a real turn now and VAD owns when it ends.
        if (!voice.capturing || voice.speechSeen) return;
        // Silent on purpose: nothing was said, so there is nothing to answer -- and a voice from a
        // phone somebody has put down is startling rather than helpful.
        rest("still there?", "tap the orb and just say it.", { silent: true });
      },
      patientRef.current ? idleMs * 2 : idleMs,
    );
  }, [rest]);

  /**
   * Opens a capture window, connecting first if this is the first one.
   *
   * The connection is deliberately NOT made on page load. The microphone cannot arm before
   * permission and permission needs a gesture, and minting a realtime session for every visit
   * would spend the daily budget on the visits where nobody speaks. So the first tap pays for it
   * and every capture after that is instant.
   */
  const openMic = useCallback(async () => {
    /*
     * Already known unreachable, so do not spend a token mint and four seconds finding out again.
     *
     * The real damage was not the delay. Every caller that reopens the microphone does so
     * immediately after ASKING something -- "when is it?", "I didn't catch what you want to do" --
     * and the failure path below clears `retry`. So a visitor with no microphone was asked a
     * question and had it wiped off the header in the same breath, twice over: once when planning
     * an event without a date, once when the router did not understand them. Both were dead ends
     * that looked like the screen ignoring them.
     *
     * `resting` rather than `blocked`, because `blocked`'s copy is about the microphone and what
     * is on the header here is a question they still need to answer -- in the box, which is
     * already open.
     */
    if (micBlockedRef.current) {
      busyRef.current = false;
      setPhase("resting");
      return false;
    }
    const connected = await voice.connect(
      "intake",
      { mode: "intake", context: defaultConversationContext },
    );
    if (!connected) {
      busyRef.current = false;
      setRetry(null);
      micBlockedRef.current = true;
      setMicBlocked(true);
      setPhase("blocked");
      return false;
    }
    // The host took the screen while the connection was being made. The stand-down effect has
    // already run and found nothing to close; opening a capture now would hand it a live one.
    if (ctxRef.current.busy) {
      busyRef.current = false;
      setPhase("resting");
      return false;
    }
    // The entry sentence is the learner talking about their own life, which is English. The pin is
    // a hint rather than a filter, so a Spanish sentence still comes through -- but leaving it to
    // auto-detect is what once turned a short reply into Korean.
    voice.setTranscriptionLanguage("en");
    voice.openCapture();
    ownsCaptureRef.current = true;
    voice.setMicWindow("capturing", { patient: patientRef.current });
    setPhase("listening");
    // Q1. The single most important conversion in the app: a microphone with no vocabulary in
    // front of it, and whether anybody reaches for it at all.
    track("dash_mic_opened", { afterRetry: fillerRetriesRef.current > 0 || strikesRef.current > 0 });
    openedAtRef.current = Date.now();
    armIdle();
    return true;
  }, [armIdle]);

  const startListening = useCallback(async () => {
    const { doneEvent, busy: leaving } = ctxRef.current;
    if (busyRef.current || leaving) return;
    busyRef.current = true;
    setReadBack(null);
    setRetry(null);
    // A question is on the header, so this capture answers it. Marked here rather than in the
    // header so it is claimed exactly once: if they say something else entirely it is stored as
    // the answer, which is a lossy line in a research column -- far cheaper than a screen that
    // asks and then ignores.
    askingOutcomeRef.current = doneEvent && phase === "resting" ? doneEvent.id : null;
    setPhase("connecting");
    await openMic();
  }, [openMic, phase]);

  /**
   * What they said about how the evening actually went, stored word for word.
   *
   * **No classification.** A model asked whether "it was fine, I froze once" counts as a success
   * would produce a label, and the label would be what we later analysed instead of the sentence.
   * The sentence is the research. The one thing we do ask is closed, answered with a tap, and
   * kept separate: whether they got any of it out (see the mastery ladder in the events route).
   */
  const recordOutcome = useCallback(
    async (eventId: string, said: string) => {
      setPhase("thinking");
      const updated = await patchEvent(eventId, { outcomeSaid: said });
      if (updated) setEvents((list) => list.map((event) => (event.id === updated.id ? updated : event)));
      askingOutcomeRef.current = null;
      busyRef.current = false;
      setRetry(null);
      setPhase("outcome");
      void say("thanks — that helps more than you'd think.");
    },
    [say, setEvents],
  );

  /**
   * Turns a named event into a plan: a date if they gave one, and the goes there is time for.
   *
   * The date is the half that has to be got right. It is asked for exactly once, because somebody
   * who says "I don't know yet" has answered the question and asking again is the app not
   * listening -- and because an undated plan is a real thing, not a failure. What it never does
   * is guess: `/api/event-plan` refuses a date it cannot quote back from their own words.
   */
  const planEvent = useCallback(
    async (seed: PendingEvent) => {
      const { todayIso, preview } = ctxRef.current;
      setPhase("thinking");

      let plan: EventPlanResponse | null = null;
      try {
        const response = await fetch("/api/event-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            said: seed.said,
            situationEn: seed.situationEn,
            whoEn: seed.whoEn,
            whenSaid: seed.whenSaid,
            todayIso,
            todayWeekday: todayWeekday(),
            timezone: localTimezone(),
          }),
        });
        const json = await response.json();
        if (response.ok) plan = json as EventPlanResponse;
      } catch {
        // Offline, or the route fell over. Treated like not being able to lay it out.
      }

      if (!plan || plan.beats.length < 2) {
        rest("I couldn't lay that one out.", "say it once more — or pick something up below.");
        return;
      }

      if (!plan.happensOn && !seed.askedWhen) {
        pendingEventRef.current = { ...seed, askedWhen: true };
        setRetry({ lead: "when is it?", alt: "a day is enough — or say you don't know yet." });
        // Said before the mic reopens: an open mic during this line hears the question and
        // answers it itself.
        await say("when is it? a day is enough. or say you don't know yet.");
        await openMic();
        return;
      }

      const beats = buildPlan(plan.beats, todayIso, plan.happensOn);

      if (preview) {
        // Invented practice must never be written into a real account. The plan is still shown,
        // because seeing it is the point of the preview.
        busyRef.current = false;
        setRetry({ lead: `preview — this would lay out ${beats.length} goes at ${plan.nameEn}.`, alt: "" });
        setPhase("resting");
        return;
      }

      const saved = await createEvent({
        said: seed.said,
        nameEn: plan.nameEn,
        situationEn: seed.situationEn,
        whoEn: seed.whoEn,
        whenSaid: seed.whenSaid,
        happensOn: plan.happensOn,
        beats,
      });

      // A plan that spans days and is not saved is a promise that dies with the tab. Better to
      // say so than to show four goes we will not remember tomorrow.
      if (!saved) {
        rest("I couldn't save that one.", "say it again in a moment — I'll have another go.");
        return;
      }

      setEvents((list) => [saved, ...list.filter((event) => event.id !== saved.id)]);
      busyRef.current = false;
      setPhase("planned");

      const day = eventDayLabel(saved.happensOn, todayIso);
      const goes = `${beats.length} goes`;
      setRetry(null);
      setPlanLine(day ? `${saved.nameEn} — ${goes} before ${day}.` : `${saved.nameEn} — ${goes}, in order.`);
      // Named out loud rather than pointed at, because the whole screen is built on the idea that
      // the second line teaches a sentence you could actually say. "the first one's below" teaches
      // where to tap, which is the one thing a microphone never needed help with.
      void say(
        day
          ? `${saved.nameEn}. ${goes} before ${day}. say: let's start with the first one.`
          : `${saved.nameEn}. ${goes}, in order. say: let's start with the first one.`,
      );
    },
    [openMic, rest, say, setEvents],
  );

  /**
   * Sends the sentence to the router and does what it says.
   *
   * The one rule that outranks the others: it never proceeds on a guess. Every path that cannot
   * name a real target lands on the `unclear` copy with the microphone reopened, and none of them
   * quietly starts the default intake -- that is the "what was the point of telling it my problem?"
   * failure this whole screen exists to prevent.
   */
  const route = useCallback(
    async (said: string) => {
      const { liveEvent, nextBeat, eventDay, todayIso, due, moments, pickUp, focus } =
        ctxRef.current;
      /*
       * Every go that is still to come, not just the next one. Offering only the next made "let's
       * start with the first one" work and "the second one" silently fall back to whatever was
       * next -- and being handed a different go than the one you asked for is the wrong-target
       * mistake this screen exists to avoid.
       *
       * The position is in the summary because that is what an ordinal refers to. The ids carry a
       * prefix the router never has to understand: it may only ever return an id it was handed,
       * and the client splits it back apart.
       */
      const eventItems =
        liveEvent
          ? liveEvent.beats
              .filter((beat) => !beat.completedAt)
              .map((beat) => ({
                id: `event:${liveEvent.id}:${beat.index}`,
                keyPhrase: liveEvent.nameEn,
                summary: `go ${beat.index + 1} of ${liveEvent.beats.length}: ${beat.titleEn}`,
                waitingLabel: beat.dueOn ? eventDayLabel(beat.dueOn, todayIso) : eventDay,
              }))
          : [];
      const open = [
        ...eventItems,
        ...[...due, ...moments.filter((moment) => !due.includes(moment))].map((moment) => ({
          id: moment.id,
          keyPhrase: moment.keyPhrase,
          summary: moment.summary,
          waitingLabel: moment.dueAt && daysOverdue(moment.dueAt) > 0 ? `waiting ${daysOverdue(moment.dueAt)} days` : null,
        })),
      ].slice(0, 8);

      let result: IntentResponse | null = null;
      try {
        const response = await fetch("/api/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            said,
            open,
            headlineId: eventItems[0]?.id ?? pickUp?.id ?? null,
            focusEn: focus?.label ?? null,
          }),
        });
        const json = (await response.json()) as IntentResponse;
        if (response.ok) result = json;
      } catch {
        // Offline, or the route fell over. Treated the same as not understanding: say so.
      }

      // Q2 and Q3. The intent distribution is the most direct "were we right?" number available:
      // `talk` was split into three on a hypothesis and two of them got engines. Only the shape
      // of the sentence travels, never the sentence.
      if (result) {
        track("dash_routed", {
          intent: result.intent,
          runnable: canRun(result.intent),
          hadOpenItems: open.length > 0,
          saidLength: saidLength(said),
        });
      }

      const understood =
        result &&
        result.intent !== "unclear" &&
        result.readBackEn.trim().length > 0 &&
        // resume without a target it can name is not a resume. The route guards this too; the
        // client refuses independently because acting on the wrong saved moment is the one
        // mistake here that costs a whole session.
        (result.intent !== "resume" ||
          moments.some((moment) => moment.id === result?.resumeId) ||
          eventItems.some((item) => item.id === result?.resumeId));

      if (!result || !understood) {
        setRetry({
          lead: "I didn't catch what you want to do.",
          alt: "say “pick up where I left off”, or describe a situation.",
        });
        // Said before the mic reopens, not alongside it: an open mic during this line would hear
        // the coach read the vocabulary out and take it for an answer.
        await say("I didn't catch what you want to do. you can say: pick up where I left off. or just describe a situation.");
        // Reopened rather than handed back: they have just been told what to say, and asking them
        // to find the orb again is the wrong moment to add a tap.
        await openMic();
        return;
      }

      const line = result.readBackEn.trim();
      setReadBack(line);
      setPhase("readback");

      if (result.intent === "resume") {
        // Deliberately not awaited, here and below. The room does not speak on arrival, and the
        // session survives the navigation -- so the read-back keeps playing across the transition
        // instead of adding two seconds of waiting to every entry.
        void say(line);
        if (result.resumeId?.startsWith("event:") && liveEvent) {
          // The index out of the id, not whatever happens to be next: they said which one.
          const named = Number(result.resumeId.split(":")[2]);
          const beat = liveEvent.beats.find((item) => item.index === named) ?? nextBeat;
          if (beat) {
            handOff(() => startBeat(liveEvent, beat.index));
            return;
          }
        }
        const moment = moments.find((item) => item.id === result.resumeId);
        handOff(() => resumeMoment(moment ?? null));
        return;
      }

      // #30. The engine exists now: date it, lay out the goes, and run them one at a time.
      if (result.intent === "new_scenario" && result.scenario) {
        void say(line);
        await planEvent({
          said,
          situationEn: result.scenario.situationEn,
          whoEn: result.scenario.whoEn,
          whenSaid: result.scenario.whenEn,
          askedWhen: false,
        });
        return;
      }

      // A question, into the room: the answer, then the two seconds where they have to say it.
      if (result.intent === "ask_phrase" && result.askEn) {
        void say(line);
        const askEn = result.askEn;
        handOff(() => startAskPhrase(said, askEn));
        return;
      }

      // A moment that already happened, into the intake built for exactly this. No plan, no date,
      // no new engine: the room has done this since before the entry screen existed.
      if (result.intent === "stung" && result.scenario) {
        void say(line);
        const situationEn = result.scenario.situationEn;
        handOff(() => startStung(said, situationEn));
        return;
      }

      /*
       * Understood, and not built. Section 7: read it back, say so plainly, keep it.
       *
       * Except that "not built" hides two different sentences. `talk` — genuinely open-ended
       * chat — is a hard ban in `more-xavier-stuff.md`, so "it's the first thing when I can" is
       * a promise we have decided never to keep, and a learner who comes back in a month to
       * collect on it finds out we were managing them. Everything else here really is on its way.
       *
       * The no still names what we DO take, because the header's whole job on this screen is to
       * teach what to say, and a refusal that leaves somebody staring at an orb has taught them
       * nothing.
       */
      const declined = result.intent === "talk";
      handOff(() => {
        setPhase(declined ? "declined" : "kept");
        busyRef.current = false;
        // Understood, and nothing behind it. The corpus of what to build next -- and for `talk`,
        // a count of how many people we are refusing, which is the point of refusing them openly.
        track("dash_kept", { intent: result.intent as "ask_phrase" | "stung" | "talk" | "unclear" });
        // Kept either way. The promise half does not apply to `talk`, but how many people ask for
        // open chat is worth knowing precisely BECAUSE we are refusing them.
        void keepIt(said, result);
        // One utterance, not two: the refusal and what follows it belong to the same breath as the
        // read-back, and two `response.create` calls in a row would cut the first one off.
        void say(
          declined
            ? `${line} open chat isn't a thing I do. give me a real situation, or something you couldn't say.`
            : `${line} I can't build that one yet. I've kept it — it's the first thing when I can.`,
        );
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keepIt is a hoisted declaration and closes over nothing
    [openMic, say, planEvent],
  );

  /** Closes the window, judges what came back, and only then spends a request on it. */
  const finishListening = useCallback(
    async (manual: boolean) => {
      // Not the engine's capture. In the room the same stream carries the learner's turns, and
      // closing one of those here would hand a Spanish attempt to the intent router.
      if (ctxRef.current.busy) return;
      if (!voice.capturing) return;
      clearIdle();
      // Closed, then the mic, then the commit -- the buffer commit has to be the last thing that
      // happens while the track is still live.
      ownsCaptureRef.current = false;
      const { speechSeen } = voice.closeCapture();
      voice.setMicWindow("closed");
      // Q1's other half. `spoke: false` is somebody who opened the mic and then said nothing,
      // which is a completely different problem from never opening it.
      track("dash_mic_closed", {
        spoke: speechSeen,
        heldMs: openedAtRef.current ? Date.now() - openedAtRef.current : 0,
      });
      setPhase("thinking");
      const transcript = await voice.awaitTranscript({ commit: manual });
      const verdict = classifyCapture(transcript, speechSeen);

      if (verdict === "filler") {
        fillerRetriesRef.current += 1;
        if (fillerRetriesRef.current <= maxFillerRetries) {
          // They are mid-thought and the microphone mistook a pause for an ending. The fix for
          // cutting someone off is to stop cutting them off, not to ask them to start again.
          patientRef.current = true;
          setRetry({ lead: "take your time.", alt: "" });
          await say("take your time.");
          await openMic();
          return;
        }
        patientRef.current = false;
        rest("whenever you're ready.", "or pick something up below.");
        return;
      }

      if (verdict === "decode-loop") {
        // The loop is what a clipped recording decodes into, so the next window is the patient one.
        patientRef.current = true;
        setRetry({ lead: "that came back garbled.", alt: "say it once more — I'll wait longer." });
        await say("that came back garbled. say it once more — I'll wait longer.");
        await openMic();
        return;
      }

      if (verdict !== "ok") {
        strikesRef.current += 1;
        rest(
          strikesRef.current >= 2 ? "still not hearing you." : "didn't catch that.",
          strikesRef.current >= 2
            ? "a quieter room or headphones helps — the card below works either way."
            : "tap the orb and try again.",
        );
        return;
      }

      fillerRetriesRef.current = 0;
      patientRef.current = false;
      strikesRef.current = 0;
      setRetry(null);

      // This capture answers "when is it?", so it goes back to the planner rather than to the
      // router -- "friday" on its own is not a request and the router would rightly refuse it.
      const pending = pendingEventRef.current;
      if (pending) {
        pendingEventRef.current = null;
        await planEvent({ ...pending, whenSaid: transcript });
        return;
      }

      // Same shape: the screen asked how the evening went, so this is the answer to that. A
      // question that is asked and then routed past is worse than one never asked.
      const asking = askingOutcomeRef.current;
      if (asking) {
        await recordOutcome(asking, transcript);
        return;
      }

      await route(transcript);
    },
    [openMic, planEvent, recordOutcome, rest, route, say],
  );

  // The session dispatches through a ref so the handler always sees current state, the same
  // pattern the room uses. One subscription for the life of the page.
  const onVoiceEventRef = useRef<(event: RealtimeServerEvent) => void>(() => undefined);
  useEffect(() => {
    onVoiceEventRef.current = (event: RealtimeServerEvent) => {
      const type = event.type ?? "";
      /*
       * Deaf while the host has the screen. The room subscribes to this same stream, and this
       * listener is registered first -- the hook is called above the room's own subscription --
       * so without the guard it closed every server-VAD-ended turn in the room before the room
       * saw it: `closeCapture` ran here, the room's handler then found nothing to finish, and the
       * learner's Spanish went to `/api/intent`. Found by voice on 2026-09-12. The typed path
       * never touches the stream, which is why no check had seen it.
       */
      if (ctxRef.current.busy) return;
      if (!voice.capturing) return;
      if (type === "input_audio_buffer.speech_started") {
        // They are talking, so the "said nothing" timeout no longer applies.
        clearIdle();
        return;
      }
      if (type === "input_audio_buffer.speech_stopped") {
        void finishListening(false);
      }
    };
  }, [finishListening]);
  useEffect(() => voice.onEvent((event) => onVoiceEventRef.current(event)), []);

  useEffect(() => clearIdle, []);

  /*
   * The host has taken the screen, so the engine lets go of everything it holds.
   *
   * The guards on the listener and on `finishListening` keep the engine out of the room's turns;
   * this is the rest of it. A capture the engine opened on the landing must not run on into the
   * room, a "when is it?" or "how did it go?" must not claim the room's first answer, and a
   * read-back timer must not start a second session on top of the one the host just started.
   *
   * Only a capture the engine itself opened is aborted. By the time this runs the room may already
   * have a live one of its own, and closing that would be the very fault this exists to end.
   *
   * The engine's own phase is reset during render, above; this half touches only refs, timers and
   * the shared session.
   */
  useEffect(() => {
    if (!ctx.busy) return;
    clearIdle();
    if (handOffTimerRef.current !== null) {
      window.clearTimeout(handOffTimerRef.current);
      handOffTimerRef.current = null;
    }
    if (ownsCaptureRef.current) {
      ownsCaptureRef.current = false;
      voice.abortCapture();
      voice.setMicWindow("closed");
    }
    pendingEventRef.current = null;
    askingOutcomeRef.current = null;
    busyRef.current = false;
  }, [ctx.busy]);


  /**
   * The same sentence, typed.
   *
   * `blocked` was a dead end. No microphone meant the router was unreachable -- and the router is
   * the only route to a new scenario, to an event plan and to a phrase question. "The card below
   * still works" was true and beside the point: the whole promise of this screen is that you can
   * say what you want, and a visitor whose browser refuses the microphone was told to take
   * whatever was on offer instead.
   *
   * It joins the flow at exactly the junction a clean transcript does, so there is **one** router
   * and one set of rules about what a sentence means. A second copy of that ladder is how the two
   * halves would start disagreeing about what "the second one" refers to.
   *
   * `askingOutcomeRef` needs no handling here: `startListening` claims it before it connects, so
   * it is already correct by the time the connection has failed. A typed answer to "how did it
   * go?" lands exactly where a spoken one would.
   */
  async function submitTyped(said: string) {
    const { busy: leaving } = ctxRef.current;
    const text = said.trim();
    if (!text || leaving) return;
    clearIdle();
    fillerRetriesRef.current = 0;
    patientRef.current = false;
    strikesRef.current = 0;
    setRetry(null);
    setTypedDraft("");
    setPhase("thinking");

    const pending = pendingEventRef.current;
    if (pending) {
      pendingEventRef.current = null;
      await planEvent({ ...pending, whenSaid: text });
      return;
    }
    const asking = askingOutcomeRef.current;
    if (asking) {
      await recordOutcome(asking, text);
      return;
    }
    await route(text);
  }

  const {
    libraryState: state,
    moments,
    pickUp,
    pickUpIsDue,
    liveEvent,
    nextBeat,
    eventDay,
    doneEvent,
    busy: leaving,
  } = ctx;

  const restingHeader = (() => {
    // Only while we genuinely do not know yet. A signed-out visitor is not an unknown state -- they
    // are a brand-new learner, which is the third case below and has copy of its own. Blanking the
    // header for them left an orb with nothing above it and nothing to say into it.
    if (state === "loading") return { lead: "", alt: "" };

    // The only question on this screen that expires. Asked before anything else, including a
    // live event: whether the practice held up in the world is the one thing we cannot infer.
    if (doneEvent) {
      return {
        lead: `${doneEvent.nameEn} has been and gone. how did it go?`,
        alt: "say it however you want — one line is plenty.",
      };
    }

    /*
     * A dated evening outranks everything else here, including something overdue. Spaced
     * retrieval is a promise the app made itself and can move; friday cannot. The header names
     * the event and opens the door to saying something else, and the card below carries which go
     * is next -- the same division of labour as the due-item state, for the same reason.
     */
    if (liveEvent && nextBeat) {
      return {
        lead: eventDay ? `${liveEvent.nameEn} is ${eventDay}.` : `${liveEvent.nameEn} — no date on it yet.`,
        // The same invitation whether or not the next go is due today. The card below carries the
        // timing, and refusing an early go would be the app enforcing a schedule it invented on
        // somebody who has just said they want to practise.
        alt: "say “let's do that one” — or tell me what's on your mind.",
      };
    }

    if (state === "ready" && pickUpIsDue && pickUp) {
      const phrase = pickUp.keyPhrase ?? pickUp.naturalVersion;
      return {
        /*
         * Names the phrase, because a bare "that one" needs a referent -- but NOT how long it has
         * been waiting, which the card below already carries. The header's job is the half the
         * card cannot do: open the door to saying something else entirely. That is the whole
         * worry behind this screen, that nobody realises they can just describe their week.
         */
        lead: phrase
          ? `“${phrase}” is waiting — or is something else on your mind?`
          : "something's waiting — or is something else on your mind?",
        alt: "say “let's do that one”, or just describe the situation.",
      };
    }
    if (state === "ready" && moments.length) {
      return {
        // #30's question, and it belongs here and nowhere else: the funnel asks what is hard,
        // this asks what is actually happening in their week.
        lead: "what's coming up that you're dreading?",
        alt: "or say “just talk to me” and we'll go from there.",
      };
    }
    return {
      lead: "tell me about a time the words didn't come.",
      alt: "or just say hello and we'll start there.",
    };
  })();

  const header = (() => {
    if (leaving) return { lead: readBack ?? "starting that now.", alt: "" };
    switch (phase) {
      case "connecting":
        return { lead: "one moment — waking the mic.", alt: "" };
      case "listening":
        return retry ?? { lead: "listening…", alt: "" };
      case "thinking":
        return { lead: "one sec.", alt: "" };
      case "readback":
        // The contract. In their words, never a category, and it holds before anything happens.
        return { lead: readBack ?? "", alt: "starting that now." };
      case "planned":
        return { lead: planLine ?? "that's laid out.", alt: "say “let's start with the first one” — or tap it below." };
      case "outcome":
        return { lead: "thanks — that helps more than you'd think.", alt: "one last thing:" };
      case "kept":
        return {
          lead: readBack ? `${readBack} I can't build that one yet.` : "I can't build that one yet.",
          alt: "I've kept it — it's the first thing when I can.",
        };
      case "declined":
        return {
          lead: readBack ? `${readBack} open chat isn't a thing I do.` : "open chat isn't a thing I do.",
          alt: "give me a real situation, or something you couldn't say.",
        };
      case "blocked":
        return { lead: "I can't reach the microphone here.", alt: "type it instead — everything still works." };
      default:
        return retry ?? restingHeader;
    }
  })();

  // Typed as the literals, because a return object widens them to `string` and the canvas wants
  // its own union. The same four names `OrbCanvas` uses; it does not export the type.
  const orbState: "speaking" | "listening" | "thinking" | "idle" = speaking
    ? "speaking"
    : phase === "listening"
      ? "listening"
      : phase === "thinking" || phase === "connecting"
        ? "thinking"
        : "idle";
  /**
   * Speaking is deliberately NOT busy. Talking over the app is the most natural thing a person
   * does to a voice interface, and a screen that ignores the tap while it reads a refusal out
   * teaches them it is not really listening. A tap cuts the line and opens the microphone.
   */
  const orbBusy = phase === "connecting" || phase === "thinking";

  /**
   * The closed half of the post-event question. One tap, no model.
   *
   * A `no` is not a failure to record -- it is the more useful answer of the two, because it is
   * the one that says the practice did not reach the room it was for.
   *
   * In the hook rather than in each host because it is the only thing on the screen that can
   * honestly put somebody on the top rung of the mastery ladder, and two copies of that decision
   * is two chances to get it wrong in different ways.
   */
  function answerSpoke(spoke: boolean) {
    const { events } = ctxRef.current;
    const event = events.find((item) => item.outcomeAt && item.outcomeSpoke === null) ?? null;
    if (spoke) rest("good. that's the whole point of this.", "tap the orb whenever there's a next one.", { silent: true });
    else rest("okay — that's worth knowing.", "tap the orb and tell me what's coming up.", { silent: true });
    if (!event) return;
    void patchEvent(event.id, { outcomeSpoke: spoke }).then((updated) => {
      if (updated) setEvents((list) => list.map((item) => (item.id === updated.id ? updated : item)));
    });
  }

  /**
   * Shuts the microphone because something else has taken the screen.
   *
   * Not a courtesy. An open capture window behind a panel of text is the worst combination this
   * screen can produce: the learner reads, server VAD hears nothing, and the header comes back
   * with "I didn't catch what you want to do" about a sentence nobody tried to say. Silent,
   * because nothing was asked -- speaking here would be the app narrating its own plumbing.
   */
  function standDown() {
    if (!voice.capturing && phase !== "listening" && phase !== "connecting") return;
    clearIdle();
    ownsCaptureRef.current = false;
    voice.abortCapture();
    voice.setMicWindow("closed");
    busyRef.current = false;
    setPhase("resting");
  }

  /**
   * Everything the orb button needs, so the two hosts cannot drift on what a press means.
   *
   * A short press leaves the microphone open and server VAD decides when the turn ends; a long
   * one is classic push-to-talk and releasing ends it. Speaking is deliberately interruptible:
   * talking over the app is the most natural thing a person does to a voice interface, and a
   * screen that ignores the tap while it reads a refusal out teaches them it is not listening.
   */
  const orbProps = {
    disabled: orbBusy || ctx.busy,
    "aria-label": phase === "listening" ? "stop listening" : "say what you want",
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pressStartedAtRef.current = Date.now();
      if (phase === "listening") {
        pressKindRef.current = "finish";
        return;
      }
      pressKindRef.current = "start";
      // Cuts whatever is being said. `speak` resolves on cancel, so nothing is left waiting.
      if (speaking) voice.cancelSpeech();
      void startListening();
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const kind = pressKindRef.current;
      pressKindRef.current = null;
      if (kind === "finish") {
        void finishListening(true);
        return;
      }
      // Held rather than tapped: classic push-to-talk, so releasing ends the turn.
      if (kind === "start" && Date.now() - pressStartedAtRef.current >= holdToTalkMs) {
        void finishListening(true);
      }
    },
    onPointerCancel: () => {
      pressKindRef.current = null;
    },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
  };

  return {
    phase,
    readBack,
    /** The line replacing the resting header until the next clean capture, if there is one. */
    retry,
    speaking,
    /** True from the moment the microphone is known unreachable. Opens the typed way in. */
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
    /**
     * Back to rest with a line on the header. The host's own actions answer through this, so
     * there is one place that decides what "at rest with something to say" looks like.
     */
    rest,
  };
}
