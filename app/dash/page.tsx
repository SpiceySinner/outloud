"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OrbCanvas } from "@/app/components/OrbCanvas";
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
import { defaultConversationContext } from "@/lib/character-voice";
import { daysOverdue, dueMoments, focusFromMoments, type MomentCard } from "@/lib/dashboard-data";
import { mockEvent } from "@/lib/dashboard-mock";
import {
  createEvent,
  loadEvents,
  localTimezone,
  patchEvent,
  todayIsoLocal,
  todayWeekday,
} from "@/lib/event-client";
import {
  beatsDone,
  buildPlan,
  dueBeat,
  eventDayLabel,
  eventStatusFor,
  upcomingBeat,
} from "@/lib/event-plan";
import type { EventPlanResponse, StoredEvent } from "@/lib/event-schema";
import { canRun, type IntentResponse } from "@/lib/intent-schema";
import { initTracking, saidLength, track } from "@/lib/track";
import { useLibraryData } from "@/lib/use-library-data";
import { classifyCapture } from "@/lib/voice-guards";
import { voice, type RealtimeServerEvent } from "@/lib/voice-session";

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

export default function DashPage() {
  const router = useRouter();
  const { state, data, preview } = useLibraryData({ previewByDefault });

  const [phase, setPhase] = useState<EntryPhase>("resting");
  const [readBack, setReadBack] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  /**
   * Copy that replaces the resting header until the next successful capture: what went wrong, or
   * what to say instead. It sits in the header rather than in a note of its own because the header
   * is already the place this screen teaches from, and a second line of small print under the orb
   * would compete with the one thing worth reading.
   */
  const [retry, setRetry] = useState<{ lead: string; alt: string } | null>(null);
  /** Drives the orb while a line is being said. Tapping through it is allowed and cancels it. */
  const [speaking, setSpeaking] = useState(false);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  /** What the plan just laid out, held for the beat between planning it and resting again. */
  const [planLine, setPlanLine] = useState<string | null>(null);
  /**
   * Today where the LEARNER is, pinned once. Read during render it would be impure, and a
   * countdown that shifts between renders is exactly the kind of small lie this app cannot
   * afford. A tab left open across midnight keeps yesterday, which is the same trade the room
   * makes with `sessionClosedAt` and is worth far less than the drift.
   */
  const [todayIso] = useState(todayIsoLocal);
  /**
   * The drawer holding every go at the live event.
   *
   * The card can only ever show the next one, which is right for a screen whose whole job is "one
   * thing to do". But an evening broken into four pieces is a plan, and a plan you cannot read is
   * a plan you have to take on trust. This is where you read it.
   */
  const [stepsFor, setStepsFor] = useState<string | null>(null);

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

  /** The room holds this too. Whoever is mounted keeps the session alive across the hand-off. */
  useEffect(() => {
    voice.acquire();
    return () => {
      voice.release();
    };
  }, []);

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

  function clearIdle() {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
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
    const connected = await voice.connect(
      "intake",
      { mode: "intake", context: defaultConversationContext },
    );
    if (!connected) {
      busyRef.current = false;
      setRetry(null);
      setPhase("blocked");
      return false;
    }
    // The entry sentence is the learner talking about their own life, which is English. The pin is
    // a hint rather than a filter, so a Spanish sentence still comes through -- but leaving it to
    // auto-detect is what once turned a short reply into Korean.
    voice.setTranscriptionLanguage("en");
    voice.openCapture();
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
  }, [doneEvent, leaving, openMic, phase]);

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
    [say],
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
    [openMic, preview, rest, say, todayIso],
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
            window.setTimeout(() => startBeat(liveEvent, beat.index), readBackMs);
            return;
          }
        }
        const moment = moments.find((item) => item.id === result.resumeId);
        window.setTimeout(() => resumeMoment(moment ?? null), readBackMs);
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
        window.setTimeout(() => startAskPhrase(said, askEn), readBackMs);
        return;
      }

      // A moment that already happened, into the intake built for exactly this. No plan, no date,
      // no new engine: the room has done this since before the entry screen existed.
      if (result.intent === "stung" && result.scenario) {
        void say(line);
        const situationEn = result.scenario.situationEn;
        window.setTimeout(() => startStung(said, situationEn), readBackMs);
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
      window.setTimeout(() => {
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
      }, readBackMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resumeMoment/keepIt/startBeat/startStung/startAskPhrase are stable enough
    [due, moments, pickUp, focus, openMic, say, planEvent, liveEvent, nextBeat, eventDay],
  );

  /** Closes the window, judges what came back, and only then spends a request on it. */
  const finishListening = useCallback(
    async (manual: boolean) => {
      if (!voice.capturing) return;
      clearIdle();
      // Closed, then the mic, then the commit -- the buffer commit has to be the last thing that
      // happens while the track is still live.
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
      busyRef.current = false;
      setRetry({ lead: "preview — this would open that conversation.", alt: "" });
      setPhase("resting");
      return;
    }
    const payload: ResumeMoment = { momentId: moment.id, summary: moment.summary, rescue: moment.rescue };
    leaveTo(() => window.sessionStorage.setItem(resumeMomentKey, JSON.stringify(payload)));
  }

  /**
   * Keeping the sentence is half of what section 7 buys.
   *
   * For the learner it turns a dead end into a promise. For us it is the corpus the upcoming-event
   * engine needs and does not have: real situations real people asked for, in their own words. The
   * local copy is what makes the promise on screen true with no network; the server copy is the
   * research. Preview sentences are kept locally only -- test data is not research.
   */
  async function keepIt(said: string, result: IntentResponse) {
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

  /**
   * Opens the drawer, and shuts the microphone if it was listening.
   *
   * Not a courtesy. An open capture window behind a panel of text is the worst combination this
   * screen can produce: the learner reads, server VAD hears nothing, and the header comes back
   * with "I didn't catch what you want to do" about a sentence nobody tried to say. Silent,
   * because nothing was asked -- speaking here would be the app narrating its own plumbing.
   */
  function openSteps(event: StoredEvent) {
    if (voice.capturing || phase === "listening" || phase === "connecting") {
      clearIdle();
      voice.abortCapture();
      voice.setMicWindow("closed");
      busyRef.current = false;
      setPhase("resting");
    }
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
      busyRef.current = false;
      setRetry({ lead: "preview — this would answer that in the room.", alt: "" });
      setPhase("resting");
      return;
    }
    const payload: AskPhraseHandoff = { said, askEn };
    leaveTo(() => window.sessionStorage.setItem(askPhraseKey, JSON.stringify(payload)));
  }

  function startStung(said: string, situationEn: string) {
    if (preview) {
      busyRef.current = false;
      setRetry({ lead: "preview — this would take that into the room.", alt: "" });
      setPhase("resting");
      return;
    }
    const payload: StungHandoff = { said, situationEn };
    leaveTo(() => window.sessionStorage.setItem(stungKey, JSON.stringify(payload)));
  }

  function startBeat(event: StoredEvent, beatIndex: number) {
    if (preview) {
      busyRef.current = false;
      setRetry({ lead: "preview — this would start that go.", alt: "" });
      setPhase("resting");
      return;
    }
    const payload: EventBeatHandoff = { eventId: event.id, beatIndex };
    leaveTo(() => window.sessionStorage.setItem(eventBeatKey, JSON.stringify(payload)));
  }

  /**
   * The closed half of the post-event question. One tap, no model.
   *
   * A `no` is not a failure to record -- it is the more useful answer of the two, because it is
   * the one that says the practice did not reach the room it was for.
   */
  function answerSpoke(spoke: boolean) {
    const event = events.find((item) => item.outcomeAt && item.outcomeSpoke === null) ?? null;
    setPhase("resting");
    setRetry(
      spoke
        ? { lead: "good. that's the whole point of this.", alt: "tap the orb whenever there's a next one." }
        : { lead: "okay — that's worth knowing.", alt: "tap the orb and tell me what's coming up." },
    );
    if (!event) return;
    void patchEvent(event.id, { outcomeSpoke: spoke }).then((updated) => {
      if (updated) setEvents((list) => list.map((item) => (item.id === updated.id ? updated : item)));
    });
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
        return { lead: "I can't reach the microphone here.", alt: "the card below still works." };
      default:
        return retry ?? restingHeader;
    }
  })();

  const orbState = speaking
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

        <button
          className="dash-orb-wrap"
          type="button"
          aria-label={phase === "listening" ? "stop listening" : "say what you want"}
          disabled={orbBusy || leaving}
          onPointerDown={(event) => {
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
          }}
          onPointerUp={(event) => {
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
          }}
          onPointerCancel={() => {
            pressKindRef.current = null;
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <OrbCanvas state={leaving ? "listening" : orbState} className="dash-orb" size={440} />
        </button>

        {/* #47 -- the focus, named every time. Different job from the header: that says what to
            say, this says what we are working on. They must not be merged. */}
        {focus && phase === "resting" && !retry ? <p className="dash-focus">today: {focus.label}</p> : null}
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
        <div className="dash-card-row">
          {phase === "outcome" ? (
            /*
             * One closed question, answered with a tap. The mastery ladder's top rung says "you
             * used it for real", and this is the only thing in the app that can honestly put
             * somebody there -- so it must not be inferred from the sentence above it. Turning up
             * and freezing is not mastery, and a model reading "it was fine" would call it one.
             */
            <div className="dash-answers" role="group" aria-label="did you get to say any of it?">
              <p className="dash-answers-q">did you get to say any of it?</p>
              <div className="dash-answers-row">
                <button className="dash-answer" type="button" onClick={() => answerSpoke(true)} disabled={leaving}>
                  some of it, yes
                </button>
                <button className="dash-answer" type="button" onClick={() => answerSpoke(false)} disabled={leaving}>
                  not really
                </button>
              </div>
            </div>
          ) : liveEvent && nextBeat ? (
            // The event card outranks the saved-moment card for the same reason its header does:
            // one has a date attached and the other has a schedule we invented.
            <div className="dash-card-slot">
              <button
                className="dash-pickup is-event has-steps"
                type="button"
                onClick={() => startBeat(liveEvent, nextBeat.index)}
                disabled={leaving}
              >
                <span className="dash-pickup-kicker">
                  {`go ${beatsDone(liveEvent.beats) + 1} of ${liveEvent.beats.length}`}
                  {readyBeat ? "" : nextBeat.dueOn ? ` · ${eventDayLabel(nextBeat.dueOn, todayIso) ?? "soon"}` : ""}
                </span>
                <span className="dash-pickup-line">{nextBeat.titleEn}</span>
                <span className="dash-pickup-meaning">
                  {`with ${nextBeat.characterName} — ${nextBeat.characterRelation}`}
                </span>
              </button>
              {/*
               * A sibling of the card, never a child: a button inside a button is invalid and iOS
               * resolves it by ignoring one of them at random.
               *
               * It replaces the card's arrow rather than joining it. The arrow was decoration
               * (aria-hidden) saying "this does something"; a chevron pointing at where the drawer
               * will appear says WHAT it does, which is worth more than a second glyph fighting for
               * 40 pixels next to it.
               */}
              <button
                className="dash-steps-open"
                type="button"
                onClick={() => openSteps(liveEvent)}
                disabled={leaving}
                aria-expanded={stepsFor === liveEvent.id}
                aria-controls="dash-steps"
                aria-label={`see all ${liveEvent.beats.length} goes`}
              >
                {/* Three lines, the last one short: a list. Drawn rather than typed because the
                    arrowhead glyph this started as has no font coverage and fell back to a caret. */}
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 4h10M2.5 7.5h10M2.5 11h6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ) : state === "ready" && pickUp ? (
            <button className="dash-pickup" type="button" onClick={pickUpThis} disabled={leaving}>
              <span className="dash-pickup-kicker">
                {pickUpIsDue
                  ? pickUp.dueAt && daysOverdue(pickUp.dueAt) > 0
                    ? `waiting ${daysOverdue(pickUp.dueAt)} ${daysOverdue(pickUp.dueAt) === 1 ? "day" : "days"}`
                    : "ready today"
                  : "last time"}
              </span>
              <span className="dash-pickup-line">{pickUp.keyPhrase ?? pickUp.naturalVersion ?? pickUp.summary}</span>
              <span className="dash-pickup-meaning">{pickUp.keyPhraseMeaning ?? pickUp.summary}</span>
              <span className="dash-pickup-go" aria-hidden="true">
                &rarr;
              </span>
            </button>
          ) : (
            // Nothing is waiting -- a new learner, or one whose microphone we cannot reach. The
            // bottom band is never allowed to be empty of a way forward, so the intake goes here:
            // offered by name and chosen, never slipped into behind their back.
            <button className="dash-pickup is-offer" type="button" onClick={startTalking} disabled={leaving}>
              <span className="dash-pickup-kicker">the version that works</span>
              <span className="dash-pickup-line">start from a time the words didn&apos;t come</span>
              <span className="dash-pickup-go" aria-hidden="true">
                &rarr;
              </span>
            </button>
          )}
          {/* The pill is the target; the disc inside it is the identity. An initial floating in a
              rectangle reads as a letter -- put it on a disc and it reads as a person. */}
          <Link className="dash-account" href="/profile" aria-label="your account">
            <span className="dash-account-disc" aria-hidden="true">
              {data?.user.email ? (
                data.user.email.slice(0, 1).toUpperCase()
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="5.6" r="2.8" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M2.9 13.6c0-2.5 2.3-4.2 5.1-4.2s5.1 1.7 5.1 4.2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </span>
          </Link>
        </div>

        <div className="dash-tray">
          <Link className="dash-tray-link" href="/dashboard">
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
        <>
          <button
            className="dash-steps-scrim"
            type="button"
            aria-label="close the list of goes"
            onClick={() => setStepsFor(null)}
          />
          <div
            className="dash-steps"
            id="dash-steps"
            role="dialog"
            aria-modal="true"
            aria-label={`${liveEvent.nameEn}: every go`}
          >
            <span className="dash-steps-grip" aria-hidden="true" />
            <p className="dash-steps-title">{liveEvent.nameEn}</p>
            <p className="dash-steps-sub">
              {eventDay ?? "no date yet"}
              {` · ${beatsDone(liveEvent.beats)} of ${liveEvent.beats.length} done`}
            </p>
            <ol className="dash-steps-list">
              {liveEvent.beats.map((beat) => {
                const done = Boolean(beat.completedAt);
                const isNext = !done && beat.index === nextBeat?.index;
                const when = beat.dueOn ? eventDayLabel(beat.dueOn, todayIso) : null;
                return (
                  <li key={beat.index}>
                    <button
                      className={`dash-step${done ? " is-done" : ""}${isNext ? " is-next" : ""}`}
                      type="button"
                      onClick={() => startBeat(liveEvent, beat.index)}
                      disabled={leaving}
                    >
                      <span className="dash-step-n" aria-hidden="true">
                        {done ? "✓" : beat.index + 1}
                      </span>
                      <span className="dash-step-body">
                        <span className="dash-step-title">{beat.titleEn}</span>
                        <span className="dash-step-meta">
                          {`with ${beat.characterName}`}
                          {when ? ` · ${when}` : ""}
                        </span>
                      </span>
                      {/*
                       * A finished go says "again" rather than going quiet. #38 in the master
                       * plan: deciding somebody is done before they do is a small betrayal in an
                       * app about persistence.
                       */}
                      <span className="dash-step-do" aria-hidden="true">
                        {done ? "again" : isNext ? "start" : "go"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <button className="dash-steps-close" type="button" onClick={() => setStepsFor(null)}>
              close
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}
