"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { OrbCanvas } from "./components/OrbCanvas";
import { assistanceRank, derivePracticeLedgerState, nextReviewAt } from "@/lib/learning-loop";
import type { ClosingRead } from "./components/HomePanel";
import VerdictCard from "./components/VerdictCard";
import AfterCard, { JourneySheet } from "./components/AfterCard";
import FeedbackSheet from "./components/FeedbackSheet";
import { AssistanceSheet, EvidenceSheet, ProfileSheet } from "./components/ProfileSheets";
import { CorrectionSheet, PronunciationSheet } from "./components/RepairSheets";
import { AskSheet, EyesOffSheet, PressureSheet, TranscriptSheet } from "./components/SessionSheets";
import PickUpCard, { FocusLine } from "./components/PickUpCard";
import StepsDrawer from "./components/StepsDrawer";
import { useEntryData } from "@/lib/use-entry-data";
import { useVoiceEntry } from "@/lib/use-voice-entry";
import type { DashboardData, MomentCard } from "@/lib/dashboard-data";
import { shouldTriggerRepair } from "@/lib/repair-loop";
import {
  assistanceOrderFor,
  blockerHypothesisMap,
  chooseTeachingPolicy,
  createInterventionOutcome,
  teachingRationaleFor,
} from "@/lib/teaching-policy";
import { blockerFocusLabels, normalizeObservedBlocker } from "@/lib/blocker-taxonomy";
import { defaultConversationContext } from "@/lib/character-voice";
import { containsPhrase, pickForScene, type RecallPhrase } from "@/lib/phrase-recall";
import type {
  AssistanceUsed,
  AttemptEvaluation,
  BlockerType,
  FreezeSignals,
  RescueResponse,
  SelfReportedBlocker,
} from "@/lib/types";
import { openingPrompt, staticAudioForText } from "@/lib/static-lines";
import {
  classifyCapture,
  looksBrokenAttempt,
  looksLikeDecodeLoop,
  mediaRecorderTypes,
  micConstraints,
} from "@/lib/voice-guards";
import {
  voice,
  type RealtimeServerEvent,
  type RealtimeSpeechMode,
} from "@/lib/voice-session";
import type { CoachResponse } from "@/lib/coach-schema";
import type { AsideResponse } from "@/lib/aside-schema";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  autoStartKey,
  eventBeatKey,
  leftRoomKey,
  resumeMomentKey,
  askPhraseKey,
  stungKey,
  type AskPhraseHandoff,
  type StungHandoff,
  type EventBeatHandoff,
  type ResumeMoment,
} from "@/lib/account-links";
import { initTracking, track } from "@/lib/track";
import { loadEvent, patchEvent } from "@/lib/event-client";
import type { EventBeat, StoredEvent } from "@/lib/event-schema";
import type { TranscriptionConfidenceTier } from "@/lib/transcription-confidence";
import { needsWordsEn, strippedAsk } from "@/lib/stuck-signal";

/**
 * Where the learner came into the room from.
 *
 * `stung` and `upcoming` both mean "a real situation of theirs", and the difference between them
 * is TENSE. A sting already happened and they are still holding it; an upcoming event has not
 * happened at all. Five prompts downstream describe where the learner came from, and running an
 * event through the stung wording tells every one of them the learner has already failed at a
 * dinner they have not been to yet.
 */
/**
 * `ask` is an ENTRY mode, not a phase: it only changes the opening question, and `runAskPhrase`
 * sets the mode back to `speaks-first` the moment the answer arrives. It exists because the
 * landing button says "didn't know how to say something?" and used to run the `stung` engine --
 * which asks "tell me what happened" and answers a stated sentence with a choice of scenarios,
 * never with the sentence.
 */
type RoomMode = "landing" | "speaks-first" | "stung" | "upcoming" | "ask";
type TurnState = "ready" | "listening" | "still-listening" | "thinking" | "speaking";
/**
 * `ask` is a phase and not an overlay on purpose. The ask chip inside a scene renders its answer
 * in a sheet, and sheets close the microphone -- the same fact that made the aside a room mode.
 * The whole point of this phase is the two seconds where the learner says the phrase out loud, so
 * it has to live where the mic can be open.
 */
type FlowPhase = "opening" | "ask" | "coach" | "verdict" | "session";
type PrimaryCard = "verdict" | "after" | "profile";
type SupportSheet =
  | "feedback"
  | "journey"
  | "evidence"
  | "pressure"
  | "transcript"
  | "assistance"
  | "correction"
  | "pronunciation"
  | "ask"
  | "eyes-off";
type RoomOverlay = PrimaryCard | SupportSheet | null;

type ConverseReply = {
  conversationId: string;
  turnIndex: number;
  characterLineEs: string;
  characterMeaningEn: string;
  expectedCommunicativeFunction?: string;
  suggestedReplyFrameEs: string;
  suggestedReplyEs?: string;
  /** The single most useful word for this turn -- see converseResponseSchema. */
  keyWord?: { es: string; en: string } | null;
  responseGuidanceEn: string;
  shouldClose?: boolean;
  /**
   * True when this line is the character admitting it did not understand, rather than a normal
   * next beat. Already on the wire (see `lib/types.ts`); the local type simply never declared it,
   * so the client could not tell a repair turn from an ordinary one -- which is exactly what
   * `shouldTriggerRepair` needs in order not to fire twice in a row.
   */
  isRepairTurn?: boolean;
  repairType?: "non_comprehension" | "mishearing" | null;
};

type PlacementPrompt = {
  characterLineEs: string;
  characterMeaningEn: string;
  expectedCommunicativeFunction: string;
};

type PlacementAttempt = PlacementPrompt & {
  userAttempt: string;
  inputMode: "spoken" | "written";
  /**
   * setup = English framing/scenario answers (not judged as Spanish);
   * probe = answered a real question; retry = repeated something the coach handed over.
   */
  kind: "setup" | "probe" | "retry";
  /**
   * True when this attempt's capture confidence was borderline. Carried per-attempt rather than
   * as one shared flag because finishPlacement batches and re-evaluates multiple attempts
   * collected across the whole coaching conversation -- a shared "last capture" flag would
   * mislabel earlier attempts in that batch.
   */
  lowConfidence?: boolean;
};

type SessionTurn = {
  turnIndex: number;
  characterLineEs: string;
  characterMeaningEn: string;
  expectedCommunicativeFunction: string;
  suggestedReplyFrameEs: string;
  suggestedReplyEs: string | null;
  responseGuidanceEn: string;
  userAttempt: string;
  evaluation: AttemptEvaluation | null;
};

type FeedbackAnswer = {
  key: string;
  screenId: string;
  question: string;
  selected: string | null;
  text: string;
  skipped: boolean;
};

type FeedbackQuestion = {
  key: string;
  screenId: string;
  question: string;
  note: string;
  options: string[];
  placeholder: string;
};

// How long the orb waits after the coach finishes before it stops listening on its own.
const autoListenIdleMs = 10000;
/**
 * How many hesitation-only captures in a row get extra time before the room hands the turn back.
 *
 * Invented, like every other threshold here. Two is the point where more waiting stops reading as
 * patience and starts reading as the app having frozen.
 */
const maxFillerRetries = 2;
// How long an armed (open but not capturing) mic may sit in silence before it closes itself.
const armedIdleCutoffMs = 120000;
// A press longer than this is treated as classic push-to-talk (release ends the turn).
const holdToTalkThresholdMs = 700;

type LifelineResponse = {
  queryEn: string;
  options: Array<{
    spanish: string;
    meaningEn: string;
    useWhenEn: string;
  }>;
  fallbackFrameEs: string;
  noteEn: string;
};

type PronunciationCoaching = {
  intelligible: boolean;
  fixWord: string | null;
  coachingNoteEn: string;
};

type RetryTarget = {
  kind: "correction" | "pronunciation";
  phraseEs: string;
  phraseMeaningEn: string;
  attempts: number;
};

const emptyFreezeSignals: FreezeSignals = {
  timeToFirstWordSeconds: null,
  hesitationCount: 0,
  englishWordCount: 0,
  summary: "No spoken timing available.",
};

function buildPlacementText(openingAnswer: string, attempts: PlacementAttempt[], mode: RoomMode) {
  const setup = attempts.filter((attempt) => attempt.kind === "setup").map((attempt) => attempt.userAttempt);
  const scenario = setup.length ? ` Chosen scenario: ${setup[0]}.` : "";
  const transcript = attempts
    .filter((attempt) => attempt.kind !== "setup")
    .map((attempt) => `Coach: "${attempt.characterLineEs}" -> learner: "${attempt.userAttempt}"`)
    .join(" | ");
  const header =
    mode === "upcoming"
      ? `The situation the learner is preparing for, in their own words: "${openingAnswer}".`
      : mode === "stung"
        ? `The learner's real situation, in their own words: "${openingAnswer}".`
        : `The learner's self-described problem, in their own words: "${openingAnswer}".`;

  return `${header}${scenario} Transcript of the first coached conversation: ${transcript}`;
}

function clipForApi(value: string, max = 1500) {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Never let a logging call throw on a circular or exotic value. */
function safeJson(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function lastMatching<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return items[index];
  }

  return null;
}

function weekdayLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat("en", { weekday: "long" }).format(date).toLowerCase();
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const feedbackQuestions: FeedbackQuestion[] = [
  {
    key: "disappointment",
    screenId: "18a-feedback-1",
    question: "how would you feel if OutLoud disappeared tomorrow?",
    note: "",
    options: ["really bummed", "a little", "wouldn't notice"],
    placeholder: "anything else?",
  },
  {
    key: "helped",
    screenId: "18b-feedback-2",
    question: "did OutLoud actually help you say something you couldn't before?",
    note: "",
    options: ["yes", "kind of", "no"],
    placeholder: "what made the difference?",
  },
  {
    key: "gotInTheWay",
    screenId: "18c-followup",
    question: "what got in the way?",
    note: "",
    options: [],
    placeholder: "tell us what got in the way",
  },
  {
    key: "confusion",
    screenId: "18d-feedback-3",
    question: "where did it get confusing or make you want to close the app?",
    note: "totally fine if so — that's what we're fixing.",
    options: [
      "when it was my turn to speak",
      "during the correction",
      "when it asked me to say it again",
      "no, it felt clear",
    ],
    placeholder: "what felt confusing?",
  },
  {
    key: "bestPart",
    screenId: "18e-feedback-4",
    question: "what was the best part?",
    note: "",
    options: [
      "the corrections",
      "actually speaking",
      "that it knew my weak spots",
      "the conversation",
      "meh, nothing yet",
    ],
    placeholder: "tell us more",
  },
  {
    key: "dailyUseIf",
    screenId: "18f-feedback-5",
    question: "I'd use OutLoud every day if it...",
    note: "",
    options: [],
    placeholder: "finish the sentence",
  },
];

function blankFeedbackAnswers(): FeedbackAnswer[] {
  return feedbackQuestions.map((item) => ({
    key: item.key,
    screenId: item.screenId,
    question: item.question,
    selected: null,
    text: "",
    skipped: false,
  }));
}

function visibleFeedbackQuestions(answers: FeedbackAnswer[]) {
  const helped = answers.find((answer) => answer.key === "helped");
  return feedbackQuestions.filter(
    (question) =>
      question.key !== "gotInTheWay" ||
      (helped?.selected === "kind of" || helped?.selected === "no"),
  );
}

function ExitIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="icon icon-x">
      <path d="M1.5 1.5l9 9m0-9l-9 9" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 13" className="icon icon-heart">
      <path d="M7 12S1 8.3 1 4.6A3.6 3.6 0 0 1 7 2a3.6 3.6 0 0 1 6 2.6C13 8.3 7 12 7 12Z" />
    </svg>
  );
}

function CoachToolCard({
  tool,
  onPick,
  disabled,
}: {
  tool: CoachResponse["tool"];
  onPick?: (label: string) => void;
  disabled?: boolean;
}) {
  const label = {
    none: "",
    keyword_card: "the word you need",
    sentence_frame: "try this frame",
    english_explanation: "in plain english",
    say_it_back: "say it back once",
    slow_repeat: "slower",
    preparation_time: "a way in",
    path_choice: "pick one — or just say it",
  }[tool.type];

  if (tool.type === "slow_repeat") return null;

  if (tool.type === "path_choice") {
    const options = tool.options ?? [];
    if (!options.length) return null;
    return (
      <div className="path-choice" aria-label={label}>
        <p className="coach-tool-label">{label}</p>
        <div className="path-choice-options">
          {options.slice(0, 2).map((option) => (
            <button
              key={option.labelEn}
              type="button"
              className="path-choice-option"
              disabled={disabled}
              onClick={() => onPick?.(option.labelEn)}
            >
              <span>{option.labelEn}</span>
              <small>{option.scenarioEn}</small>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className={`coach-tool is-${tool.type}`} aria-label={label}>
      <p className="coach-tool-label">{label}</p>
      {tool.primaryEs ? <p className="coach-tool-es">{tool.primaryEs}</p> : null}
      {tool.primaryEn ? <p className="coach-tool-en">{tool.primaryEn}</p> : null}
      {tool.exampleEs ? <p className="coach-tool-example">e.g. {tool.exampleEs}</p> : null}
      {tool.noteEn ? <p className="coach-tool-note">{tool.noteEn}</p> : null}
    </aside>
  );
}

// Google OAuth is a full-page redirect, which wipes all component state. The room is stashed here
// before redirecting and restored when the session comes back. The key still says "verdict" because
// that is all it used to hold, and renaming it would strand any snapshot written by the build a
// learner is mid-redirect from.
const pendingVerdictKey = "outloud-pending-verdict";

/**
 * The two ways a room can be put down and picked back up, and why they do not share a store.
 *
 * `auth` is the OAuth redirect. The document is replaced, goes to Google and comes back, so the
 * snapshot has to outlive a navigation that leaves this origin entirely. `localStorage`, which is
 * what has always worked here.
 *
 * `return` is leaving on purpose and coming back — the account pill, or a reload. **`sessionStorage`
 * is the entire safety argument for that one.** A snapshot written on every way out cannot rely on
 * what makes the auth one safe: that it exists only while a redirect is in flight, and is only ever
 * read when somebody has just signed in. `sessionStorage` supplies the missing half, because it
 * belongs to a tab — closing the tab throws the intention away with it, tomorrow morning is a new
 * tab with nothing in it, and two open tabs cannot steal each other's session.
 */
type SnapshotJourney = "auth" | "return";

function snapshotStore(journey: SnapshotJourney): Storage {
  return journey === "auth" ? window.localStorage : window.sessionStorage;
}

function snapshotKey(journey: SnapshotJourney): string {
  return journey === "auth" ? pendingVerdictKey : leftRoomKey;
}

/**
 * The room, frozen across a full-page redirect.
 *
 * Signing in with Google is a navigation away and back. Everything in this component is React
 * state, so the round trip empties it; whatever is not written down here is gone.
 *
 * It used to be called `VerdictSnapshot` and it held eight fields, all of them from the intake --
 * enough to rebuild the verdict card and nothing else. A learner who signed in during the practice
 * conversation came back to the landing screen. No error, no warning, no sign they had ever been
 * there, and no way to get back to it: the moment is only written at close, so there was nothing
 * saved to resume from either.
 *
 * That is the wrong way round for what this app is trying to be. The account ask is meant to come
 * AFTER a win (master-plan #18, as Timo restated it on 2026-09-11), which means the thing somebody
 * is being asked to sign up for is the run they are in the middle of -- and it was exactly that run
 * we threw away when they said yes.
 *
 * **What is deliberately not here:** the microphone, the realtime connection and the overlays. All
 * three are rebuilt on mount and a stale copy of any of them is worse than none. The aside is out
 * too: it is a conversation about the scene rather than the scene, and coming back into the scene
 * at the turn they stepped out of is both simpler and what they wanted anyway.
 */
type RoomSnapshot = {
  /**
   * Bumped when a field's MEANING changes, never when one is added -- every read below tolerates a
   * missing field, so an older snapshot restores as much as it can rather than being thrown away.
   * A learner mid-redirect during a deploy is the exact person this must not fail for.
   */
  v: number;
  /** So a snapshot cannot resurrect a session from yesterday. See `pendingRoomTtlMs`. */
  savedAt: string;

  // where they were
  mode: RoomMode;
  flowPhase: FlowPhase;
  conversationId: string | null;
  turnIndex: number;

  // the intake and what it concluded
  openingAnswer: string;
  placementSummary: string;
  placementAttempts: PlacementAttempt[];
  placementEvaluations: AttemptEvaluation[];
  placementRescue: RescueResponse | null;
  coachId: string | null;
  coachTurn: CoachResponse | null;
  coachLoot: Array<{ es: string; en: string | null }>;
  coachEvidence: string[];
  reportedBlocker: SelfReportedBlocker | null;

  // the conversation
  sceneCharacter: CoachResponse["sceneCharacter"];
  sessionTurns: SessionTurn[];
  currentConversationTurn: ConverseReply | null;
  coachLine: string | null;
  coachMeaning: string | null;
  coachMeaningKind: "translation" | "instruction" | null;
  sessionCallout: string | null;

  // and what has already been banked from it
  savedMomentId: string | null;
  sessionClosedAt: string | null;
  askPhrase: AskPhraseHandoff | null;
  toneMode: "patient" | "real" | "pressure";
};

/**
 * How long a frozen room is worth thawing.
 *
 * An OAuth round trip is seconds. This is generous enough to cover somebody who gets as far as
 * Google's account picker, wanders off, and comes back -- and short enough that signing in on a
 * quiet Tuesday never drops them into Monday's conversation. Restoring is also refused outright
 * while anything is on screen, which is the guard that actually matters; this one only handles the
 * case where nothing is.
 */
const pendingRoomTtlMs = 2 * 60 * 60 * 1000;

function ProfileGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.8 20c1.1-3.6 3.9-5.4 7.2-5.4s6.1 1.8 7.2 5.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Rendered only while open, so each opening mounts it fresh and `initialMode` actually takes
 * effect -- a persistent instance would keep whichever mode the last visitor left it in.
 */
function AuthDialog({
  initialMode,
  onClose,
  onAuthed,
  onBeforeRedirect,
}: {
  /** Where the visitor came from: the header implies an existing account, the card implies a new one. */
  initialMode: "signup" | "signin";
  onClose: () => void;
  onAuthed: (email: string) => void;
  /** Runs right before the OAuth full-page redirect, to stash state that must survive it. */
  onBeforeRedirect?: () => void;
}) {
  const [mode, setMode] = useState<"signup" | "signin">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const supabase = getSupabaseBrowser();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        // Words are saved via email either way; a pending confirmation should not lose them.
        onAuthed(email);
        // Before the branch, not inside it: an account exists either way, and counting only the
        // confirmation-pending half would quietly undercount every signup that logs straight in.
        track("account_created", { unclaimedRuns: 0 });
        if (!data.session) {
          setNotice("account created — check your inbox to confirm. your words are already saved.");
          return;
        }
        onClose();
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        onAuthed(email);
        onClose();
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "could not sign you up yet.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    if (!supabase || busy) return;
    setError(null);
    onBeforeRedirect?.();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) setError(authError.message);
  }

  return (
    <div
      className="auth-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-label="Create your account">
        <h3>{mode === "signup" ? "keep your words" : "welcome back"}</h3>
        <p>
          {mode === "signup"
            ? "your word bank, saved — and brought back tomorrow in a new situation."
            : "sign in to pick up your word bank where you left it."}
        </p>
        {supabase ? (
          <>
            <button className="auth-google" type="button" disabled={busy} onClick={() => void signInWithGoogle()}>
              <span aria-hidden="true">G</span>
              continue with Google
            </button>
            <div className="auth-divider" aria-hidden="true">
              <span>or</span>
            </div>
            <form onSubmit={(event) => void submit(event)}>
              <label htmlFor="auth-email">email</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <label htmlFor="auth-password">password</label>
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error ? <p className="auth-error">{error}</p> : null}
              {notice ? <p className="auth-notice">{notice}</p> : null}
              <button className="auth-primary" type="submit" disabled={busy}>
                {busy ? "one moment" : mode === "signup" ? "create account" : "sign in"}
              </button>
            </form>
            <button
              className="quiet-link"
              type="button"
              onClick={() => {
                setMode((current) => (current === "signup" ? "signin" : "signup"));
                setError(null);
                setNotice(null);
              }}
            >
              {mode === "signup" ? "already have an account? sign in" : "new here? create an account"}
            </button>
          </>
        ) : (
          <p className="auth-error">
            accounts aren&apos;t configured yet (missing NEXT_PUBLIC_SUPABASE_ANON_KEY). use the email option
            instead.
          </p>
        )}
        <button className="auth-close" type="button" aria-label="close" onClick={onClose}>
          &times;
        </button>
      </div>
    </div>
  );
}

function isPrimaryCard(overlay: RoomOverlay) {
  return overlay === "verdict" || overlay === "after" || overlay === "profile";
}

export default function Home() {
  const timers = useRef<number[]>([]);
  const holdingRef = useRef(false);
  const pressingRef = useRef(false);
  const pressSessionRef = useRef(0);
  const turnStateRef = useRef<TurnState>("speaking");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const staticAudioRef = useRef<HTMLAudioElement | null>(null);
  const staticAudioResolveRef = useRef<((played: boolean) => void) | null>(null);
  // The connection, the microphone, a capture and the playback lifecycle all live in
  // `lib/voice-session.ts`. What stays here is policy: WHICH lines the learner may talk over, and
  // what happens when they do. The session has no opinion about that and should not.
  const realtimeInterruptibleRef = useRef(false);
  const realtimeInterruptedRef = useRef(false);
  const overlayRef = useRef<RoomOverlay>(null);
  const typedFallbackOpenRef = useRef(false);
  // Read from realtime event handlers, which can fire inside the render the state changed in.
  const flowPhaseRef = useRef<FlowPhase>("opening");
  const coachPhaseRef = useRef<CoachResponse["phase"] | null>(null);
  const pressStartedAtRef = useRef(0);
  const pressKindRef = useRef<"start" | "finish" | "interrupt" | null>(null);
  const micModeRef = useRef<"open" | "push">("open");
  /**
   * Mirror of the `micAsleep` state, for the derivation and event handlers that run outside render.
   * The state drives the copy; the ref is what deriveMicWindow can read synchronously.
   */
  const micSleepingRef = useRef(false);
  /** Consecutive captures that produced nothing usable -- the signal that a room is too noisy. */
  const noisyStrikesRef = useRef(0);
  /**
   * Consecutive captures on this turn that contained only hesitation. Reset by any capture with
   * real content in it, so a learner who thinks out loud once does not spend the budget for the
   * rest of the session.
   */
  const fillerRetriesRef = useRef(0);
  /** Makes the NEXT capture wait much longer before deciding the learner has finished. */
  const patientCaptureRef = useRef(false);
  const noisyOfferShownRef = useRef(false);
  const [mode, setMode] = useState<RoomMode>("landing");
  const [turnState, setTurnState] = useState<TurnState>("speaking");
  const [interruptible, setInterruptible] = useState(false);
  // Long coach lines fold to two lines shortly after it becomes the learner's turn; a tap toggles.
  const [coachLineFolded, setCoachLineFolded] = useState(false);
  const foldTimerRef = useRef<number | null>(null);
  // The realtime channel registers its listeners ONCE at connection time. Routing events through
  // this ref keeps them bound to the LATEST render: without it, a spoken answer committed by VAD
  // ran through a stale closure where flowPhase was still "opening" and restarted the coach.
  const handleRealtimeEventRef = useRef<(event: RealtimeServerEvent) => void>(() => undefined);
  // Same latest-ref pattern for the auth listener, which is also registered exactly once.
  const restoreRoomRef = useRef<(journey: SnapshotJourney, email: string | null) => void>(
    () => undefined,
  );
  const stashRoomRef = useRef<(journey: SnapshotJourney) => void>(() => undefined);
  /** Same reason as the two above: /dash's hand-off effect runs before `enterRoom` is declared. */
  const enterRoomRef = useRef<(mode: RoomMode) => void>(() => undefined);
  /**
   * Same reason as `enterRoomRef`: the hand-off effect runs once on mount and must not close over
   * the first render's version of a function that reads a dozen pieces of state.
   */
  const runEventBeatRef = useRef<(event: StoredEvent, beatIndex: number) => Promise<void>>(async () => undefined);
  const runStungIntakeRef = useRef<(handoff: StungHandoff) => Promise<void>>(async () => undefined);
  const runAskPhraseRef = useRef<(handoff: AskPhraseHandoff) => Promise<void>>(async () => undefined);
  const [typedFallbackOpen, setTypedFallbackOpen] = useState(false);
  const [typedAttempt, setTypedAttempt] = useState("");
  // True when the typed-fallback box is open to confirm/repair a just-captured spoken transcript,
  // rather than because voice wasn't available at all -- changes the box's copy and inputMode.
  const [transcriptNeedsConfirm, setTranscriptNeedsConfirm] = useState(false);
  // Carries the captured attempt's confidence tier through the confirm step to /api/evaluate.
  const [pendingAttemptConfidence, setPendingAttemptConfidence] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [coachLine, setCoachLine] = useState<string | null>(null);
  const [coachMeaning, setCoachMeaning] = useState<string | null>(null);
  /**
   * Whether coachMeaning currently holds a TRANSLATION of the Spanish line or an INSTRUCTION the
   * learner is being asked to follow ("say this back once..."). Only translations get folded behind
   * a tap -- hiding an instruction would hide the thing they're supposed to do.
   */
  const [coachMeaningKind, setCoachMeaningKind] = useState<"translation" | "instruction" | null>(null);
  // Collapsed state of the English translation. Manual only -- no auto-fold timer, deliberately:
  // a timed reveal would teach "wait two seconds and the answer appears."
  const [englishFolded, setEnglishFolded] = useState(true);
  const [, setLastTranscript] = useState<string | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<RoomOverlay>(null);
  const [feedbackStep, setFeedbackStep] = useState(0);
  const [feedbackPick, setFeedbackPick] = useState<number | null>(null);
  const [feedbackAnswers, setFeedbackAnswers] = useState<FeedbackAnswer[]>(() => blankFeedbackAnswers());
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [eyesOffMode, setEyesOffMode] = useState(false);
  /**
   * "open" keeps the mic live while it is the learner's turn, so they just talk -- the whole point
   * of full-duplex, since nobody reads "tap the orb to speak". "push" is the pre-full-duplex
   * behaviour, kept intact as the one-value rollback and as the fallback offered when a room turns
   * out to be too noisy for an open mic.
   */
  const [micMode, setMicMode] = useState<"open" | "push">(() => {
    if (typeof window === "undefined") return "open";
    return window.localStorage.getItem("outloud-mic-mode") === "push" ? "push" : "open";
  });
  /**
   * A way into the account pages from inside the room. On in development; on a deployed build it
   * takes one visit to `?debug=1`, which persists -- the phone is where the room actually gets
   * tested and there is no console on it. `?debug=0` clears it again.
   */
  const [debugTools] = useState(() => {
    const onByDefault = process.env.NODE_ENV === "development";
    if (typeof window === "undefined") return onByDefault;
    try {
      const flag = new URLSearchParams(window.location.search).get("debug");
      if (flag === "1") window.localStorage.setItem("outloud-debug-tools", "1");
      else if (flag === "0") window.localStorage.removeItem("outloud-debug-tools");
      if (window.localStorage.getItem("outloud-debug-tools") === "1") return true;
    } catch {
      // Storage or URL blocked: fall back to the build-time default.
    }
    return onByDefault;
  });
  /** The one-tap "noisy room?" offer, shown once per session after repeated dead captures. */
  const [noisyOfferOpen, setNoisyOfferOpen] = useState(false);
  /** An armed mic that closed itself after a long silence. Drives the copy, so it must be state. */
  const [micAsleep, setMicAsleep] = useState(false);
  // How real the character feels. "patient" behaves like "real" for now -- there is no
  // differentiated server behavior for it yet, only real/pressure branch anything server-side.
  const [toneMode, setToneMode] = useState<"patient" | "real" | "pressure">("real");
  const [askDraft, setAskDraft] = useState("");
  const [askStatus, setAskStatus] = useState<"idle" | "asking" | "answered" | "error">("idle");
  const [askAnswer, setAskAnswer] = useState<LifelineResponse | null>(null);
  /**
   * The `ask` phase: a phrase question from /dash, answered here and then practised.
   *
   * Separate state from `askAnswer` above, which belongs to the in-scene ask sheet. They render
   * differently -- the sheet shows one option because it is interrupting a conversation, and this
   * shows all of them with when to use each, because choosing between them IS the lesson here.
   */
  /**
   * Phrases this learner asked for that are due to come back, and the one this scene is carrying.
   *
   * Refs rather than state: nothing renders from them, they are read inside handlers that run
   * after several awaits, and a stale copy would either inject the wrong phrase or record the
   * wrong one as landed. Same reason `activeEventRef` is a ref.
   */
  const duePhrasesRef = useRef<RecallPhrase[]>([]);
  const activePhraseRef = useRef<RecallPhrase | null>(null);
  /** Set the moment a phrase lands, read once by the next callout, then cleared. */
  const landedPhraseRef = useRef<RecallPhrase | null>(null);
  const [askPhrase, setAskPhrase] = useState<AskPhraseHandoff | null>(null);
  const [phraseAnswer, setPhraseAnswer] = useState<LifelineResponse | null>(null);
  const [phraseStatus, setPhraseStatus] = useState<"asking" | "ready" | "scoring" | "done" | "error">("asking");
  const [retryTarget, setRetryTarget] = useState<RetryTarget | null>(null);
  const [correctionRetryResult, setCorrectionRetryResult] = useState<AttemptEvaluation | null>(null);
  const [pronunciationResult, setPronunciationResult] = useState<PronunciationCoaching | null>(null);
  const [lastVoiceFreeze, setLastVoiceFreeze] = useState<FreezeSignals | null>(null);
  // Whisper's confidence tier for the last file-transcribed capture -- null on the realtime path,
  // which has no equivalent signal. Surfaced in the correction sheet per item #15.
  const [lastTranscriptionConfidence, setLastTranscriptionConfidence] = useState<TranscriptionConfidenceTier | null>(
    null,
  );
  const [flowPhase, setFlowPhase] = useState<FlowPhase>("opening");
  const [openingAnswer, setOpeningAnswer] = useState("");
  const [coachId, setCoachId] = useState<string | null>(null);
  const [coachTurn, setCoachTurn] = useState<CoachResponse | null>(null);
  // Words and frames the coach handed over during this session -- the learner's loot.
  const [coachLoot, setCoachLoot] = useState<Array<{ es: string; en: string | null }>>([]);
  // Per-turn coach observations, passed to /api/rescue so the card matches the actual session.
  const [coachEvidence, setCoachEvidence] = useState<string[]>([]);
  /**
   * The learner's own hypothesis about what trips them up, classified by the coach from their
   * opening answer. This used to be a client-side regex that could only ever return
   * "missing_words" or "not_sure", which made six of the eight blockers in the taxonomy
   * unreachable and filed most learners under "not_sure" -- the value that maps to the generic
   * teaching policy. Everything downstream (the verdict's stated-vs-observed line, the session
   * focus line, the saved moment) reads this, so it had to become real first.
   */
  const [reportedBlocker, setReportedBlocker] = useState<SelfReportedBlocker | null>(null);
  /**
   * The strongest help the learner actually reached for on the CURRENT session turn.
   *
   * `/api/evaluate` was being sent a hardcoded `assistanceUsed: "none"` on every session turn, so
   * every stored intervention outcome claimed the learner needed no help -- which both poisons
   * `derivePersonalTeachingModel` and would make an "you did that without me" callout (#49) fire
   * after someone read the model answer. That is a Phase-0 class lie, so the callout could not be
   * built until this was real.
   *
   * Rank order comes from `assistanceRank`: a turn records the highest rung reached, not the last.
   */
  const turnAssistanceRef = useRef<AssistanceUsed>("none");
  /**
   * Consecutive session turns that came out clear without the learner escalating past the
   * always-visible guidance. A ref, not state: it is read inside the submit handler immediately
   * after the evaluation lands, where a state value would still be a render behind.
   */
  const unaidedRunRef = useRef(0);
  /**
   * Whether the learner opened the English subtitle on the current turn.
   *
   * Kept apart from `turnAssistanceRef` on purpose. `assistanceUsed` describes help with
   * PRODUCING the reply and feeds the teaching model, and reading what the coach said is
   * comprehension, not production -- filing it as `repeat` or `english_explanation` would teach
   * the model the wrong thing about which interventions work. But the callout claims the learner
   * did not reach for help *at all*, and opening the subtitle is plainly reaching. So it blocks
   * the callout without touching the graded value.
   */
  const turnSubtitleRef = useRef(false);
  /**
   * Opt-in tracing of the whole voice path. Enable with:
   *   localStorage["outloud-debug-realtime"] = "1"
   *
   * The voice layer fails silently in a dozen places by design -- a closed data channel, a
   * superseded press, a guard that returns early, a `catch {}` that drops to the MediaRecorder
   * fallback. From the outside every one of them looks identical: "the mic does nothing". This
   * makes each of them say so.
   */
  function vlog(scope: string, ...rest: unknown[]) {
    if (!voice.debug) return;
    const line = [
      `[voice:${scope}]`,
      ...rest.map((value) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : value instanceof Error
            ? `${value.name}: ${value.message}`
            : safeJson(value),
      ),
      `| mic:${voice.micWindow} mode:${micModeRef.current} turn:${turnStateRef.current} capturing:${voice.capturing}`,
    ].join(" ");
    // Written to a buffer as well as the console. Console filters (and DevTools opened after the
    // fact) silently hide console.log, which during this bug looked exactly like "no logging".
    // `__outloudVoiceDump()` survives both.
    const store = window as unknown as { __outloudVoiceLog?: string[] };
    store.__outloudVoiceLog ??= [];
    store.__outloudVoiceLog.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    console.log(line);
  }
  const calloutSpokenRef = useRef(false);
  const [sessionCallout, setSessionCallout] = useState<string | null>(null);
  /**
   * Who the learner is talking to (#29), named by the coach on the scenario turn and carried into
   * the practice session. Without this the session fell back to `who: "an OutLoud Spanish coach"`
   * -- a role, not a person -- and the named stranger the learner had just been introduced to
   * silently became an anonymous tutor, which is the opposite of the social pressure the whole
   * scenario exists to create.
   */
  const [sceneCharacter, setSceneCharacter] = useState<CoachResponse["sceneCharacter"]>(null);
  /**
   * "Step out": the learner leaves the scene mid-turn to talk to the coach about what is actually
   * in their way, then comes back to the same sentence.
   *
   * Deliberately NOT an overlay. `deriveMicWindow` closes the mic whenever `overlayRef` is set,
   * so an aside built as a sheet would be silent -- and a silent "let's talk about it" is the one
   * shape this cannot have. It is a mode inside the room instead: same orb, same mic, same
   * `turnState` machine, different register.
   *
   * The scene is frozen, never torn down. `conversationId`, `turnIndex` and
   * `currentConversationTurn` are untouched for the whole aside, so an aside costs no practice
   * turns and `restoreCurrentTurn` puts the learner back on the exact line they walked out of.
   */
  const [asideActive, setAsideActive] = useState(false);
  const asideThreadRef = useRef<HTMLDivElement | null>(null);
  // Read by deriveMicWindow, expectsEnglishAnswerNow and the realtime handlers, all of which run
  // outside render -- the state alone would lag them by one commit.
  const asideActiveRef = useRef(false);
  const [asideLine, setAsideLine] = useState<string | null>(null);
  const [asideOffer, setAsideOffer] = useState<AsideResponse["offer"]>(null);
  /** What has been said in this aside, oldest first. Shown so the learner can see the thread. */
  const [asideExchange, setAsideExchange] = useState<Array<{ who: "coach" | "you"; text: string }>>([]);
  /**
   * A blocker the learner corrected the coach on. Takes precedence over both the observed and the
   * stated focus for the rest of the session: they just told us to our face what is wrong, which
   * outranks anything inferred from a transcript.
   */
  const [asideFocusOverride, setAsideFocusOverride] = useState<BlockerType | null>(null);
  /** Consecutive replies that were understood but did not land -- the "this isn't working" signal. */
  const asideStrikesRef = useRef(0);
  const asideNudgeShownRef = useRef(false);
  const [asideNudgeOpen, setAsideNudgeOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  // Which side of the dialog to land on, decided by where the visitor tapped.
  const [authIntent, setAuthIntent] = useState<"signup" | "signin">("signup");
  const [emailFallbackOpen, setEmailFallbackOpen] = useState(false);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  // Set after an OAuth return; the effect below saves the words once the rescue state is back.
  const [pendingAutoSaveEmail, setPendingAutoSaveEmail] = useState<string | null>(null);
  const [placementAttempts, setPlacementAttempts] = useState<PlacementAttempt[]>([]);
  const [placementRescue, setPlacementRescue] = useState<RescueResponse | null>(null);
  const [placementEvaluations, setPlacementEvaluations] = useState<AttemptEvaluation[]>([]);
  const [placementSummary, setPlacementSummary] = useState("");
  const [currentConversationTurn, setCurrentConversationTurn] = useState<ConverseReply | null>(null);
  const [sessionTurns, setSessionTurns] = useState<SessionTurn[]>([]);
  const [returnEmail, setReturnEmail] = useState("");
  const [returnEmailStatus, setReturnEmailStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [profileEvidenceIndex, setProfileEvidenceIndex] = useState(0);
  /**
   * Who the learner is talking to, for every route that takes a context. `who` drives register
   * and tone judgments in the rescue and the evaluation as well as the conversation itself, so a
   * named person with a temperament produces better calls than the role string it replaces.
   */
  const conversationWho = sceneCharacter
    ? `${sceneCharacter.name}, ${sceneCharacter.relation} (${sceneCharacter.traitEn})`
    : mode === "stung" || mode === "upcoming"
      ? "a real person from the learner's situation"
      : defaultConversationContext.who;
  const [clientSessionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const key = "outloud-session-id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = makeId();
    window.localStorage.setItem(key, next);
    return next;
  });
  /**
   * Set while this run is one go at a planned event (#30), and null otherwise.
   *
   * A ref rather than state because nothing renders from it: what it does is tell the two
   * write-backs which event they belong to, and both of them happen inside handlers that run
   * after several awaits, where a captured state value would be stale.
   */
  const activeEventRef = useRef<{ event: StoredEvent; beat: EventBeat } | null>(null);
  const [savedMomentId, setSavedMomentId] = useState<string | null>(null);
  /**
   * When this session closed. Pinned in a handler rather than read during render: `Date.now()` in
   * the render body is impure, and a return date that drifts on every re-render is exactly the
   * kind of small lie this app cannot afford -- the weekday on the card has to be the weekday the
   * moment is really scheduled for.
   *
   * Null until the session actually ends, which is also what keeps the journey honest: nothing is
   * banked while a session is still running.
   */
  const [sessionClosedAt, setSessionClosedAt] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  /**
   * How many runs this browser has saved that no account has claimed yet.
   *
   * The one number the account ask is allowed to point at. Null until it is known, and the copy
   * falls back to the promise-shaped version while it is -- a sentence about what somebody has
   * done must never render with a placeholder in it.
   */
  const [unclaimedRuns, setUnclaimedRuns] = useState<number | null>(null);
  const [lastReviewUrl, setLastReviewUrl] = useState<string | null>(null);
  const isLanding = mode === "landing";

  /*
   * What is waiting for this learner, and the orb that lets them say what they want instead.
   *
   * Both hooks are shared with `/dash`, which is the point of them existing: the landing screen
   * used to be the same cold funnel whether you had never opened the app or had a month of
   * practice and a dinner on friday behind it.
   *
   * `previewByDefault: false` is load-bearing. `/dash` shows the invented account to a signed-out
   * visitor because it is an unfinished screen worth looking at; the homepage must never do that.
   * A stranger's month of practice on the real front door, wearing your session, is the one
   * failure mode of this feature that would be worth more than the feature.
   */
  const entryData = useEntryData({ previewByDefault: false });
  const [stepsFor, setStepsFor] = useState<string | null>(null);
  const entry = useVoiceEntry(
    {
      libraryState: entryData.libraryState,
      moments: entryData.moments,
      due: entryData.due,
      focus: entryData.focus,
      pickUp: entryData.pickUp,
      pickUpIsDue: entryData.pickUpIsDue,
      liveEvent: entryData.liveEvent,
      readyBeat: entryData.readyBeat,
      nextBeat: entryData.nextBeat,
      eventDay: entryData.eventDay,
      doneEvent: entryData.doneEvent,
      events: entryData.events,
      todayIso: entryData.todayIso,
      preview: entryData.preview,
      // The engine goes inert the moment the room is doing anything else. It only ever drives the
      // landing screen; a capture opening behind a live session would fight the room for the mic.
      busy: !isLanding,
    },
    {
      /*
       * Here is the whole reason the engine is a hook rather than a page.
       *
       * On `/dash` each of these writes a sessionStorage key and navigates to `/`, because the
       * two screens are two documents. In the room they are direct calls to functions that have
       * existed all along -- no key, no navigation, no snapshot to lose on the way.
       */
      startBeat: (event, beatIndex) => void runEventBeat(event, beatIndex),
      resumeMoment: (moment) => resumeSavedMoment(moment),
      startAskPhrase: (said, askEn) => void runAskPhrase({ said, askEn }),
      startStung: (said, situationEn) => void runStungIntake({ said, situationEn }),
      onEventsChanged: entryData.setEvents,
    },
  );

  /*
   * Who is looking, in one line.
   *
   * Signed out with nothing on this device is a first-time visitor, and they get the funnel that
   * has always been here -- "90 seconds. no signup." is true for them and only for them. Anybody
   * else gets their own practice: a dated evening, an overdue phrase, or the honest empty version
   * with a way in. Events are keyed to the browser rather than an account, so somebody who
   * planned one before signing up still sees it.
   */
  const showFunnel = !authedEmail && !entryData.liveEvent && !entryData.pickUp;
  /**
   * Picks a saved moment back up, here rather than via `/dash` and a page load.
   *
   * The same twelve lines the `resumeMomentKey` effect runs on arrival. They stay duplicated ONLY
   * until `/account` stops writing that key -- one is a hand-off from another document and this
   * one is not, and collapsing them before that would mean the effect had to fake a moment object
   * it does not have.
   */
  function resumeSavedMoment(moment: MomentCard | null) {
    if (!moment) {
      entry.rest("that one isn't here any more.", "pick something else, or describe a situation.");
      return;
    }
    if (!moment.rescue) return;
    setMode("speaks-first");
    setPlacementRescue(moment.rescue as RescueResponse);
    setPlacementSummary(moment.summary);
    setPlacementAttempts([]);
    setPlacementEvaluations([]);
    setSavedMomentId(moment.id);
    setCoachLine("picking this back up.");
    showMeaning(null, null);
    setFlowPhase("verdict");
    setTurnState("ready");
    setOverlay("verdict");
  }

  const isStung = mode === "stung";
  const isAskEntry = mode === "ask";
  /*
   * Has this visit produced anything that leaving the page would take away?
   *
   * Two jobs that pull in opposite directions, which is why they share a name.
   *
   * `stashRoom` uses it to decide there is something worth writing down before leaving.
   * `restoreRoom` uses it to refuse to overwrite a live room with a stale snapshot.
   *
   * It used to have a third: hiding the account pill, because that link was a plain navigation with
   * no stash and no restore, and following it cost you the run. Both ways out of the header are
   * covered now -- the pill stashes in its `onClick`, and `pagehide` catches everything that
   * unloads the document -- so that branch is gone and the pill no longer disappears.
   *
   * `placementRescue` counts even though it is also what gets stashed: it means a verdict exists,
   * and a verdict is the thing somebody would be most annoyed to lose.
   *
   * `openingAnswer` is first in the list and it is the one that was missed on the first attempt at
   * this: `handleOpeningAttempt` sets it and CLEARS `placementAttempts` in the same breath, so a
   * learner who had said exactly one thing -- the sentence the whole session is built out of --
   * registered as having nothing to lose. Caught by walking it in a browser rather than by reading
   * it, which is the only way that one was ever going to show up.
   */
  const roomHasUnsavedWork =
    openingAnswer.trim().length > 0 ||
    placementAttempts.length > 0 ||
    sessionTurns.length > 0 ||
    Boolean(placementRescue);
  const pressureMode = toneMode === "pressure";
  const isUserTurn = turnState === "ready" || turnState === "listening" || turnState === "still-listening";
  // Single source of truth for "the orb cannot be pressed right now", used by both the button's
  // disabled prop and its visual state so the two can never disagree.
  const orbDisabled =
    isLanding ||
    Boolean(overlay) ||
    typedFallbackOpen ||
    turnState === "thinking" ||
    (turnState === "speaking" && !interruptible);
  const orbState =
    // A line the learner can only listen to. This is the one case where they genuinely cannot act,
    // so it gets the inert grey config -- previously it rendered the MOST inviting one in the set.
    (turnState === "speaking" && !interruptible) || typedFallbackOpen
      ? "quiet"
      : turnState === "still-listening"
        ? "still-listening"
        : turnState === "ready"
          ? "ready"
          : // "thinking" keeps its fast spin: it reads as working, not as shut off.
            turnState;
  // With an open mic every "tap the orb" instruction is a lie, and wrong instructions are worse
  // than none -- the whole reason for full-duplex is that people don't read them. `micLive` is the
  // one condition that decides which wording is true right now.
  const micLive = micMode === "open" && !micAsleep;
  const roomLabel = {
    ready: micLive ? "just start talking" : "tap the orb to speak",
    listening: "listening",
    "still-listening": "still listening",
    thinking: "thinking",
    speaking: "speaking",
  }[turnState];
  const roomSubcopy = {
    ready: "",
    listening: micLive ? "take your time — I'll know when you stop" : "just talk — tap when you're done",
    "still-listening": "take your time",
    thinking: "putting that together",
    speaking: interruptible ? "tap the orb to interrupt" : "",
  }[turnState];
  const holdLabel = {
    ready: micLive ? "the mic is on — just start talking" : "tap the orb to talk",
    listening: micLive ? "listening — stop when you're done" : "tap when you're done",
    "still-listening": "still listening",
    thinking: "thinking",
    speaking: interruptible ? "tap to interrupt" : "listen",
  }[turnState];
  const activeFeedbackQuestions = visibleFeedbackQuestions(feedbackAnswers);
  const feedbackDone = feedbackStep >= activeFeedbackQuestions.length;
  const activeFeedback =
    activeFeedbackQuestions[Math.min(feedbackStep, activeFeedbackQuestions.length - 1)] ??
    activeFeedbackQuestions[0];
  const overlayKind = isPrimaryCard(overlay) ? "card" : "sheet";
  // Hidden while the coach talks: during speech the only affordance that matters is cutting in.
  const showSessionTools =
    !isLanding &&
    flowPhase === "session" &&
    // help / fix / pronounce all act on the Spanish turn. Stepped out there is no Spanish turn,
    // and a "pronounce" chip under a conversation about why this is not working is absurd.
    !asideActive &&
    !typedFallbackOpen &&
    turnState !== "thinking" &&
    turnState !== "speaking";
  /**
   * The escape hatch, and deliberately not part of `showSessionTools`: it survives progressive
   * disclosure (it is the one thing that must be there on turn one) and it survives the coach
   * speaking, because "actually, hang on" most often arrives mid-sentence.
   */
  /** Whether an aside is possible at all right now, ignoring what is currently on screen. */
  const canStepOut =
    !isLanding &&
    ((flowPhase === "session" && Boolean(currentConversationTurn)) ||
      (flowPhase === "coach" && Boolean(coachTurn))) &&
    !asideActive;
  const showStepOut =
    !isLanding &&
    // Both conversational phases, not just practice. The intake is where someone discovers this
    // is the wrong level for them entirely -- a learner saying "I'm completely new, I can't
    // remember any vocabulary" mid-intake had nowhere to put that, and every following turn asked
    // them for more Spanish.
    ((flowPhase === "session" && Boolean(currentConversationTurn)) ||
      (flowPhase === "coach" && Boolean(coachTurn))) &&
    !asideActive &&
    !overlay &&
    !typedFallbackOpen &&
    turnState !== "thinking";
  const currentPlacementPrompt: PlacementPrompt | null = coachTurn
    ? {
        characterLineEs: coachTurn.sayEs,
        characterMeaningEn: coachTurn.meaningEn,
        expectedCommunicativeFunction: coachTurn.expectedCommunicativeFunction,
      }
    : null;
  const coachTool = flowPhase === "coach" && coachTurn && coachTurn.tool.type !== "none" ? coachTurn.tool : null;
  const primaryEvaluation = placementEvaluations[placementEvaluations.length - 1] ?? null;
  // A decoder loop is excluded from BOTH sides, and that is the point of doing it here as well as
  // at capture time. `momentBefore` deliberately hunts for a BROKEN attempt to show as "here is
  // how it sounded before" -- so a loop that got in before this guard existed, or through a typed
  // path, would be put on the closing card as the learner's own words. It is our microphone
  // failing, not them.
  const spokenAttempts = placementAttempts.filter(
    (attempt) => attempt.kind !== "setup" && !looksLikeDecodeLoop(attempt.userAttempt),
  );
  const momentBefore = spokenAttempts.find((attempt) => looksBrokenAttempt(attempt.userAttempt)) ?? null;
  const cleanAttempts = spokenAttempts.filter((attempt) => !looksBrokenAttempt(attempt.userAttempt));
  const momentAfter = cleanAttempts.length ? cleanAttempts[cleanAttempts.length - 1] : null;
  const lootItems = [
    ...coachLoot,
    ...(placementRescue
      ? [
          {
            es: placementRescue.important_phrase.spanish,
            en: placementRescue.important_phrase.meaning_en as string | null,
          },
          {
            es: placementRescue.transferableChunk.patternEs,
            en: placementRescue.transferableChunk.meaningEn as string | null,
          },
        ]
      : []),
  ]
    .filter(
      (item, index, all) =>
        item.es.trim().length > 0 &&
        all.findIndex((other) => other.es.trim().toLowerCase() === item.es.trim().toLowerCase()) === index,
    )
    .slice(0, 5);
  const latestSessionEvaluation = lastMatching(sessionTurns, (turn) => Boolean(turn.evaluation))?.evaluation ?? primaryEvaluation;
  const latestCorrectedTurn = lastMatching(sessionTurns, (turn) => Boolean(turn.evaluation?.correctedAttemptEs));
  const activeCorrection = {
    gap:
      latestSessionEvaluation?.conciseFeedbackEn ??
      placementRescue?.actionable_feedback.explanationEn ??
      "OutLoud needs one more reply before it can name the exact fix.",
    pattern:
      placementRescue?.transferableChunk.patternEs ??
      placementRescue?.important_phrase.spanish ??
      "try the natural version once",
    naturalVersion:
      latestSessionEvaluation?.correctedAttemptEs ??
      placementRescue?.natural_version ??
      currentConversationTurn?.suggestedReplyEs ??
      "",
  };
  const activePronunciationTarget =
    latestSessionEvaluation?.pronunciationTargets[0] ??
    placementRescue?.pronunciationTargets[0] ??
    null;
  /**
   * Session tools appear the first time they can actually do something, so turn one shows the orb
   * and one help affordance instead of five controls, three of which are meaningless before the
   * learner has made a mistake.
   *
   * Derived rather than latched in state because `sessionTurns` is append-only within a session
   * (and reset by enterRoom), which makes these naturally sticky: once a turn has produced a
   * correction or a pronunciation target, the `.some(...)` stays true even though the "latest"
   * derivations above can go null again on a later turn. A chip that appears, vanishes and returns
   * would be worse than showing all five from the start.
   */
  const everFix = sessionTurns.some((turn) => Boolean(turn.evaluation?.correctedAttemptEs));
  const everPronounce =
    Boolean(activePronunciationTarget) ||
    sessionTurns.some((turn) => (turn.evaluation?.pronunciationTargets.length ?? 0) > 0);
  const everAsk = sessionTurns.length >= 1;
  // The escalating help ladder, built from what this session actually has to offer. It used to be
  // a hardcoded array with invented sample text ("porque", "me cuesta ___") and a fixed current
  // rung -- help that shows fabricated help is worse than no help button at all.
  /**
   * #47 -- the one thing this session is about, named at the top of the room so the learner can
   * glance at any session and see it is about their thing. Set by the evidence, never configured
   * by the user.
   *
   * Evidence outranks the hypothesis: what actually happened is a better answer than what they
   * guessed. But `insufficient_evidence` is not evidence -- it is the absence of it -- so it
   * falls through to what they told us rather than printing "finding out what trips you up" over
   * a learner who already said.
   *
   * Deliberately read from the PLACEMENT, not from `latestSessionEvaluation`. Keyed to the latest
   * turn it drifted: the line read "today: the words that go missing", then three turns later
   * "today: sounding like a person", and the profile card disagreed with the line above the orb
   * in the same room. A focus that changes every turn is not a focus. The placement verdict is
   * fixed for the whole session, which is exactly what "today: X" claims to be.
   */
  const observedFocus: BlockerType | null =
    placementRescue?.actionable_feedback.issueType ??
    (placementRescue ? normalizeObservedBlocker(placementRescue.observed_blocker.type) : null);
  const statedFocus: BlockerType | null =
    reportedBlocker && reportedBlocker !== "not_sure" ? blockerHypothesisMap[reportedBlocker] : null;
  const focusBlocker: BlockerType | null =
    // The learner correcting us in an aside wins over both: `observedFocus` is inferred from
    // transcripts and `statedFocus` from one answer at intake, but the override is them saying it
    // outright, mid-session, after seeing what the session actually does.
    asideFocusOverride ??
    (!observedFocus || observedFocus === "insufficient_evidence" ? statedFocus ?? observedFocus : observedFocus);
  const sessionFocusLine = focusBlocker ? blockerFocusLabels[focusBlocker] : null;
  //
  // #48 -- the ladder used to be one fixed order shown to everyone. What each rung IS comes from
  // this session; the ORDER now comes from the diagnosed blocker via `assistanceOrderFor`. Same
  // correction moment, different medicine: missing words get the word first, a sentence that will
  // not assemble gets the shape first, a freeze gets time first.
  //
  // Keyed by `AssistanceUsed` so the catalog and the policy cannot drift apart -- adding a rung
  // to the policy without a catalog entry becomes a type error rather than a silently missing
  // rung.
  const assistanceCatalog: Record<AssistanceUsed, { label: string; sample: string }> = {
    none: { label: "a little more time", sample: "" },
    repeat: { label: "hear the question again", sample: currentConversationTurn?.characterLineEs ?? "" },
    keyword: {
      label: "one useful word",
      // This turn's key word first: important_phrase is a whole phrase from the placement, which
      // reads oddly under a "one useful word" label.
      sample: currentConversationTurn?.keyWord?.es ?? placementRescue?.important_phrase.spanish ?? "",
    },
    slower_audio: { label: "hear it slowly", sample: currentConversationTurn?.characterLineEs ?? "" },
    english_explanation: { label: "what to get across", sample: currentConversationTurn?.responseGuidanceEn ?? "" },
    sentence_frame: {
      label: "sentence shape",
      sample:
        currentConversationTurn?.suggestedReplyFrameEs ?? placementRescue?.transferableChunk.patternEs ?? "",
    },
    full_model: {
      label: "hear it once",
      // The answer to the line on screen, not the placement's natural version -- that one is a
      // concatenation of the whole intake and reads as a wall of unrelated sentences here.
      sample: currentConversationTurn?.suggestedReplyEs || activeCorrection.naturalVersion,
    },
  };
  const assistanceRungNames: Record<AssistanceUsed, string> = {
    none: "wait",
    repeat: "again",
    keyword: "keyword",
    slower_audio: "slower",
    english_explanation: "nudge",
    sentence_frame: "frame",
    full_model: "model answer",
  };
  // "wait" is pinned to the top rather than taken from the policy: it costs nothing, is always
  // available, and every order that omits it still starts by giving the learner a moment.
  const assistanceOrder = ([
    "none",
    ...(focusBlocker ? assistanceOrderFor(focusBlocker) : ["keyword", "sentence_frame", "full_model"]),
  ] as AssistanceUsed[]).filter((step, index, all) => all.indexOf(step) === index);
  const assistanceLadder = assistanceOrder
    .map((step) => ({ step, name: assistanceRungNames[step], ...assistanceCatalog[step] }))
    .filter((rung) => rung.step === "none" || rung.sample.trim().length > 0);
  // The lowest rung that can actually offer something beyond waiting.
  const currentAssistanceRung = assistanceLadder.find((rung) => rung.sample.trim().length > 0)?.name ?? null;
  const assistanceRationale = focusBlocker ? teachingRationaleFor(focusBlocker) : null;
  const activePronunciationSyllables =
    activePronunciationTarget?.syllables?.length
      ? activePronunciationTarget.syllables
      : (activeCorrection.naturalVersion.match(/[\p{L}\p{M}]+/gu) ?? ["me", "cues", "ta"]).slice(0, 4);
  const todayLine =
    latestCorrectedTurn?.evaluation?.correctedAttemptEs ??
    currentConversationTurn?.suggestedReplyEs ??
    placementRescue?.natural_version ??
    "";
  const almostBeaten =
    latestSessionEvaluation?.observedBlocker.type ??
    placementRescue?.actionable_feedback.issueType ??
    placementRescue?.observed_blocker.type;
  /*
   * Counted, not asserted -- and it has to say something the block above it does not.
   *
   * This used to be one of three canned sentences, and the common one was "you got at least one
   * real reply across clearly". Directly under a card that now shows the sentence they arrived
   * with and the sentence they left with, in their own words, that is a weaker restatement of
   * what the reader has already seen. Worse, it hedges: "at least one" is what you write when you
   * do not know the number, and the room does know it.
   *
   * So this reports the thing the contrast cannot -- how much of it they did unaided. Deterministic
   * code owns the count; nothing here is inferred by a model.
   *
   * Worded as REPLIES IN THIS CONVERSATION on purpose. The journey block a few lines below says
   * "N sentences said with nothing on the screen so far", and that N counts saved MOMENTS across
   * every session -- #27's ladder. Two different units under the same phrase put "3 sentences" and
   * "1 sentence so far" on one screen, which reads as a bug rather than as two facts.
   */
  const landedClear = sessionTurns.filter((turn) => turn.evaluation?.meaningResult === "clear").length;
  const landedUnaided = sessionTurns.filter(
    (turn) => turn.evaluation?.meaningResult === "clear" && turn.evaluation.assistanceUsed === "none",
  ).length;
  const afterDelta =
    sessionTurns.length === 0
      ? "baseline set from your first run."
      : landedUnaided > 0
        ? `${landedUnaided} ${landedUnaided === 1 ? "reply" : "replies"} in this conversation needed no help.`
        : landedClear > 0
          ? `${landedClear} ${landedClear === 1 ? "reply" : "replies"} got across, with a little help.`
          : "we found the exact reply to practice next.";
  /**
   * Plain language, never the enum: this string is read on the closing card and mailed to them.
   *
   * The `almostBeaten` guard is not cosmetic. `normalizeObservedBlocker` falls through to
   * `sentence_assembly` for anything it cannot place, `undefined` included -- so mapping it
   * unguarded would print a confident diagnosis ("putting the sentence together") at a learner we
   * observed nothing about. "Evidence or silence": with nothing to go on, the next session's job
   * is to find out, and that is what this says.
   */
  const tomorrowWork = almostBeaten
    ? blockerFocusLabels[normalizeObservedBlocker(almostBeaten)]
    : blockerFocusLabels.insufficient_evidence;
  /**
   * What the closing panel renders, built from what the room already holds -- no request, no
   * account, no waiting until day three.
   *
   * This is the whole point of merging the closing card and the home screen: the wedge is memory
   * proven rather than claimed, and until now the surface that proves it was behind a login. A
   * stranger who tries this once and never returns is the only user we actually have, and they
   * could not see it.
   *
   * The ledger state is derived exactly as `saveCurrentMoment` derives it, so the journey counts
   * this session the same way the database will.
   */
  const sessionLedgerState = derivePracticeLedgerState(
    primaryEvaluation,
    lastMatching(sessionTurns, (turn) => Boolean(turn.evaluation))?.evaluation ?? null,
  );
  // `false` matches the save payload's `deepLinkMomentId: null` -- a first save comes back in a day.
  const sessionDueAt = sessionClosedAt
    ? nextReviewAt(new Date(sessionClosedAt).getTime(), sessionLedgerState, false)
    : null;
  /*
   * A weekday is only printed when something will actually honour it.
   *
   * Signed in, it will: the phrase goes to `word_bank` and `lib/phrase-recall.ts` brings it back
   * into a later scene. Signed out, `word_bank.user_id` is `not null`, so nothing is saved to come
   * back and no day ever arrives -- and 1.1 already found that the practice itself sits unclaimed
   * on the device. Saying "Friday" to that learner is a promise made at the exact moment they are
   * deciding whether to return.
   *
   * Stated as a fact, never as a second ask: 1.1 settled that there is one ask per session and it
   * lives at the verdict, where the value is still on screen.
   */
  const signedInForReturn = Boolean(authedEmail);
  const closingRead: ClosingRead = {
    delta: afterDelta,
    almostThere: tomorrowWork,
    comesBackOn: signedInForReturn && sessionDueAt ? weekdayLabel(sessionDueAt) : null,
    returnLine: signedInForReturn
      ? "we'll bring this back in a new situation, with a little less help."
      : "this run is saved on this device. nothing brings it back on its own.",
  };
  const closingMoment: MomentCard | null =
    placementRescue && sessionClosedAt && sessionDueAt
    ? {
        id: savedMomentId ?? "this-session",
        createdAt: sessionClosedAt,
        summary: placementRescue.important_phrase.meaning_en || todayLine,
        naturalVersion: placementRescue.natural_version,
        keyPhrase: placementRescue.important_phrase.spanish,
        keyPhraseMeaning: placementRescue.important_phrase.meaning_en,
        pattern: placementRescue.transferableChunk.patternEs,
        blocker: almostBeaten ?? null,
        ledgerState: sessionLedgerState,
        dueAt: sessionDueAt,
        rescue: placementRescue,
      }
    : null;
  const closingData: DashboardData = {
    user: { email: authedEmail ?? "" },
    // Exactly the phrases that get written to the word bank, so the card cannot show a different
    // set from the one that is saved.
    words: sessionWordList().map((word, index) => ({
      id: `session-word-${index}`,
      spanish: word.spanish,
      meaning_en: word.meaningEn,
      source: word.source,
      times_practiced: 0,
      created_at: sessionClosedAt ?? "",
    })),
    moments: closingMoment ? [closingMoment] : [],
    chat: [],
  };
  /**
   * #50 -- the profile has to show the dimension the learner named, moving. It used to be four
   * hardcoded rows ("finding words", "building sentences", "follow-up replies", "pronunciation"),
   * which covered four of the eight blockers in the taxonomy: anyone whose problem was grammar,
   * register or freezing under pressure simply could not see their own thing here. Two of the
   * four rows also carried a fixed `state` string that was true by construction rather than by
   * evidence ("improving", "watching"), which is the kind of invented progress this product
   * cannot afford.
   *
   * Rows are now derived: the session's focus dimension first and always present, then any other
   * dimension this session produced real evidence for. A dimension with nothing behind it is not
   * listed, because an empty row that says "watching" claims observation that never happened.
   */
  const blockersSeenThisSession = sessionTurns
    .map((turn) => turn.evaluation?.observedBlocker.type)
    // `insufficient_evidence` is the absence of a finding. Listed as a row it reads as an
    // observation ("finding out what actually trips you up -- seen today"), which claims the
    // opposite of what it means.
    .filter((type): type is BlockerType => Boolean(type) && type !== "insufficient_evidence");
  const evidenceByBlocker = new Map<BlockerType, string>();
  for (const turn of sessionTurns) {
    const type = turn.evaluation?.observedBlocker.type;
    const evidence = turn.evaluation?.observedBlocker.evidence;
    // Last one wins: the most recent observation is the one worth showing.
    if (type && evidence) evidenceByBlocker.set(type, evidence);
  }
  if (placementRescue) {
    const placementType = placementRescue.actionable_feedback.issueType;
    if (!evidenceByBlocker.has(placementType)) {
      evidenceByBlocker.set(placementType, placementRescue.observed_blocker.evidence);
    }
  }
  // Within-session movement for the focus dimension. Across sessions lives on /account, which is
  // the only surface that holds history; claiming a trend from one session would be theatre.
  const evaluatedTurns = sessionTurns.filter((turn) => Boolean(turn.evaluation));
  const clearTurns = evaluatedTurns.filter((turn) => turn.evaluation?.meaningResult === "clear").length;
  const focusMovement =
    evaluatedTurns.length === 0
      ? "no replies scored yet today."
      : `${clearTurns} of ${evaluatedTurns.length} ${evaluatedTurns.length === 1 ? "reply" : "replies"} came out clear today.`;
  const profileRows = (
    focusBlocker ? [focusBlocker, ...blockersSeenThisSession] : blockersSeenThisSession
  )
    .filter((blocker, index, all) => all.indexOf(blocker) === index)
    .map((blocker) => {
      const isFocus = blocker === focusBlocker;
      return {
        blocker,
        name: blockerFocusLabels[blocker],
        state: isFocus ? "working on it now" : "seen today",
        tone: isFocus ? "terracotta" : "sage",
        evidence: isFocus
          ? [evidenceByBlocker.get(blocker), focusMovement].filter(Boolean).join(" ")
          : evidenceByBlocker.get(blocker),
      };
    });
  // Explicitly nullable: the derived rows can legitimately be empty before anything has been
  // observed, where the old fixed four-row array always had something to index into.
  const activeEvidence: (typeof profileRows)[number] | null =
    profileRows[profileEvidenceIndex] ?? profileRows[0] ?? null;
  function closeOverlay() {
    setOverlay(null);
    setFeedbackStep(0);
    setFeedbackPick(null);
    setFeedbackText("");
    setAskDraft("");
    setAskStatus("idle");
    setAskAnswer(null);
  }

  /*
   * The thread is capped and scrollable, and it renders oldest-first -- so left alone it shows the
   * START of the aside and clips the most recent line, usually mid-sentence. A sentence cut in
   * half reads as a broken screen, and the half that matters is the one nearest what the coach
   * just said. Pinned to the bottom on every new turn; older lines stay one scroll away.
   */
  useEffect(() => {
    const el = asideThreadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [asideExchange]);

  function clearTimers() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }

  /**
   * Pinned to the language the learner is actually expected to answer in. The flow genuinely
   * switches (English scaffolding, Spanish practice), so this moves with it.
   */
  function applyTranscriptionLanguage(language: "en" | "es") {
    return voice.setTranscriptionLanguage(language);
  }

  /** Pressure mode shortens the silence window, so the tone toggle has to reach the VAD. */
  function applyVadProfile(profile: "capture" | "guard" | "patient") {
    return voice.setVadProfile(profile, pressureMode);
  }

  /**
   * Moves the turn state and its ref together. The ref is otherwise synced by a post-commit effect,
   * so it lags one render -- fine for click handlers, but the realtime event handlers read it to
   * decide whether speech should open a turn, and they can fire within that gap.
   */
  function setTurn(next: TurnState) {
    turnStateRef.current = next;
    setTurnState(next);
  }

  /** Writes the sleep flag to both its ref (read synchronously) and its state (drives the copy). */
  function setMicSleeping(asleep: boolean) {
    micSleepingRef.current = asleep;
    setMicAsleep(asleep);
  }

  /**
   * Which language the learner is expected to answer in right now. The opening question and the
   * coach's framing/scenario turns are answered in English; everything else is the Spanish
   * practice. Read by the suspicion router (English filler words are not evidence of a broken
   * attempt on an English turn) and by the realtime transcriber's language pin.
   */
  function expectsEnglishAnswerNow() {
    return (
      // Stepping out is an English conversation about the learner, not Spanish practice. Without
      // this the transcriber stays pinned to Spanish and turns everything they say into mush.
      asideActiveRef.current ||
      flowPhaseRef.current === "opening" ||
      (flowPhaseRef.current === "coach" &&
        (coachPhaseRef.current === "framing" || coachPhaseRef.current === "scenario"))
    );
  }

  function deriveMicWindow(): "closed" | "armed" | "capturing" {
    if (voice.capturing) return "capturing";
    if (micModeRef.current === "push" || micSleepingRef.current) return "closed";
    // Never armed while the coach is talking or thinking: there is nothing to interrupt yet (voice
    // barge-in is a later step), no UI for a turn, and anything captured would only pollute the
    // next transcript. Static clips are excluded too -- the mic permission prompt is still racing
    // the clip at that point, and a pre-rendered <audio> element is the least reliable case for
    // browser echo cancellation.
    if (turnStateRef.current !== "ready") return "closed";
    if (overlayRef.current || typedFallbackOpenRef.current || staticAudioRef.current) return "closed";
    return "armed";
  }

  /** The room derives which window is right; the session applies it. */
  function syncRealtimeMic() {
    /*
     * The transcriber is pinned HERE, not only when a capture opens.
     *
     * On the open-mic path the learner is already talking by the time `startRealtimeListening`
     * runs -- server VAD fired first and that call is promoting an armed mic into a real turn. A
     * language switch made at that point arrives after the audio it was supposed to describe, so
     * the opening words of the sentence are transcribed under the previous language. The failure
     * is not a garbled word, it is a fluent sentence in a third language: the right meaning
     * wearing the wrong spelling, which then gets submitted as what the learner said.
     *
     * `syncRealtimeMic` runs on every mic-relevant transition, which is strictly earlier than the
     * first sample of speech. `setTranscriptionLanguage` returns early when nothing changed, so
     * this costs a comparison and never an extra `session.update`.
     *
     * Not while a capture is open or its transcript is still in flight: changing the language
     * under an utterance that is already being decoded would corrupt the very turn it is meant to
     * get right.
     */
    if (!voice.capturing && !voice.awaitingTranscript) {
      applyTranscriptionLanguage(expectsEnglishAnswerNow() ? "en" : "es");
    }

    voice.setMicWindow(deriveMicWindow(), {
      patient: patientCaptureRef.current,
      pressureMode,
    });
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  /**
   * Everything the room holds about a line being spoken, dropped -- without touching the
   * connection. This is what starting a fresh room needs: the entry screen may have just built a
   * session for this very act, and an intake session's instructions are static, so it is already
   * correct for the room's intake. A wrong-mode session is still replaced, by `ensureRealtime`.
   */
  function resetRealtimeSpeaking() {
    realtimeInterruptibleRef.current = false;
    realtimeInterruptedRef.current = false;
    setInterruptible(false);
    voice.resetSpeaking();
    voice.resetCapture();
    voice.setMicWindow("closed");
  }

  function disconnectRealtime() {
    resetRealtimeSpeaking();
    voice.disconnect();
  }

  function realtimeRequestFor(nextMode: RealtimeSpeechMode) {
    if (nextMode === "intake") {
      return {
        mode: "intake" as const,
        context: defaultConversationContext,
      };
    }

    if (!placementRescue || !placementSummary) {
      return null;
    }

    return {
      mode: "conversation" as const,
      originalText: clipForApi(placementSummary),
      scenarioContext:
        mode === "upcoming"
          ? "The learner is preparing for something real that has not happened yet."
          : mode === "stung"
            ? "The learner started from something they could not say in real life."
            : "The learner is entering a guided first conversation from the coached intake.",
      context: defaultConversationContext,
      rescue: placementRescue,
      pressureMode,
    };
  }

  /**
   * The room's half of the realtime stream.
   *
   * `lib/voice-session.ts` has already updated the capture state and swallowed the errors that are
   * expected side effects of the turn choreography, so everything left here is a room decision:
   * whether an armed microphone should become a turn, when one ends, and when a spoken line has
   * actually finished playing out.
   */
  function handleRealtimeEvent(event: RealtimeServerEvent) {
    const type = event.type ?? "";

    if (type === "input_audio_buffer.speech_started") {
      if (voice.capturing) {
        // The learner started talking, so the idle timeout no longer applies. Guarded: with an
        // armed mic this fires on room noise too, and clearTimers() wipes every pending timer --
        // including the speak fallback that hands the turn back.
        clearTimers();
        return;
      }

      // Armed and it is their turn: talking IS the tap. This is what full-duplex buys -- nobody
      // has to read an instruction to start.
      if (voice.micWindow === "armed" && turnStateRef.current === "ready") {
        void startRealtimeListening(null, { resumingSpeech: true });
      }
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      // Server VAD has already committed the buffer; the turn ends here without any tap.
      if (voice.capturing) {
        void finishRealtimeListening(false);
      }
    }
  }

  /**
   * Connects if needed, in the mode the room is currently in. The transport lives in the session
   * module; what stays here is the only part the room owns -- the instructions the token is minted
   * with, which depend on the rescue and the scenario.
   */
  async function ensureRealtime(nextMode: RealtimeSpeechMode) {
    if (voice.isConnected(nextMode)) return true;

    const requestBody = realtimeRequestFor(nextMode);
    if (!requestBody) {
      vlog("connect", "ABORT: no request body for mode", nextMode, "(no rescue/placement yet?)");
      return false;
    }
    return voice.connect(nextMode, requestBody, { pressureMode });
  }

  async function speakCoachText(
    text: string,
    speechMode: RealtimeSpeechMode,
    fallbackDelay: number,
    options: {
      onDone?: () => void;
      autoListen?: boolean;
      interruptible?: boolean;
      slow?: boolean;
      /**
       * False when the caller drives the turn state itself after this line -- the closing coach
       * line, where finishPlacement is already running in parallel. Without it, this function's
       * "ready" would land mid-placement and invite the learner to answer a question that is no
       * longer being asked, while /api/rescue is still in flight.
       */
      handBackTurn?: boolean;
    } = {},
  ) {
    const {
      onDone,
      autoListen = true,
      interruptible: canInterrupt = true,
      slow = false,
      handBackTurn = true,
    } = options;
    clearTimers();
    setTurnState("speaking");

    // Fixed lines are played from a pre-rendered clip; the live session only warms up in the
    // background so the mic can open right after. Falls through to live speech if the clip is
    // missing or cannot play.
    const staticUrl = slow ? null : staticAudioForText(text);
    if (staticUrl) {
      realtimeInterruptedRef.current = false;
      realtimeInterruptibleRef.current = canInterrupt;
      setInterruptible(canInterrupt);
      const warmup = ensureRealtime(speechMode);
      const played = await playStaticLine(staticUrl);
      realtimeInterruptibleRef.current = false;
      setInterruptible(false);

      if (realtimeInterruptedRef.current) {
        realtimeInterruptedRef.current = false;
        onDone?.();
        return;
      }

      if (played) {
        await warmup;
        if (handBackTurn) setTurnState("ready");
        onDone?.();
        if (autoListen) {
          void beginAutoListen();
        }
        return;
      }
    }

    const connected = await ensureRealtime(speechMode);

    if (!connected || !voice.isConnected()) {
      later(() => {
        if (handBackTurn) setTurnState("ready");
        onDone?.();
      }, fallbackDelay);
      return;
    }

    realtimeInterruptedRef.current = false;
    realtimeInterruptibleRef.current = canInterrupt;
    setInterruptible(canInterrupt);

    // Resolves when the sound has actually stopped, not when generation finished -- which is what
    // lets the mic open straight afterwards without hearing the coach through the speaker.
    await voice.speak(text, { slow, timeoutMs: Math.max(2400, fallbackDelay + 5000) });
    realtimeInterruptibleRef.current = false;
    setInterruptible(false);

    if (realtimeInterruptedRef.current) {
      // The learner tapped in; interruptSpeaking() already opened the mic.
      realtimeInterruptedRef.current = false;
      onDone?.();
      return;
    }

    if (handBackTurn) setTurnState("ready");
    onDone?.();

    if (autoListen) {
      void beginAutoListen();
    }
  }

  function playStaticLine(url: string) {
    stopStaticAudio(false);
    return new Promise<boolean>((resolve) => {
      const audio = new Audio(url);
      audio.preload = "auto";
      staticAudioRef.current = audio;
      staticAudioResolveRef.current = resolve;

      const settle = (played: boolean) => {
        if (staticAudioRef.current !== audio) return;
        staticAudioRef.current = null;
        staticAudioResolveRef.current = null;
        resolve(played);
      };

      audio.addEventListener("ended", () => settle(true), { once: true });
      audio.addEventListener("error", () => settle(false), { once: true });
      audio.play().catch(() => settle(false));
    });
  }

  // Stops any pre-rendered clip; `played` tells the waiting speakCoachText how to continue.
  function stopStaticAudio(played: boolean) {
    const audio = staticAudioRef.current;
    const resolve = staticAudioResolveRef.current;
    staticAudioRef.current = null;
    staticAudioResolveRef.current = null;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    resolve?.(played);
  }

  async function beginAutoListen() {
    if (
      overlayRef.current ||
      typedFallbackOpenRef.current ||
      !voice.isConnected()
    ) {
      return;
    }

    const started = await startRealtimeListening(null);
    if (!started) return;

    // Nobody spoke. In push mode that closes the mic and hands the turn back. In open mode the
    // turn still ends, but the mic only steps down to `armed` -- closing it would break the
    // promise that they can just start talking whenever they're ready.
    later(() => {
      if (!voice.capturing || voice.speechSeen) return;
      voice.abortCapture();
      holdingRef.current = false;
      setTurn("ready");
      syncRealtimeMic();
      setRoomNote(micModeRef.current === "open" ? null : "tap the orb whenever you're ready.");
      if (micModeRef.current === "open") armIdleCutoff();
    }, patientCaptureRef.current ? autoListenIdleMs * 2 : autoListenIdleMs);
  }

  /**
   * A mic left armed indefinitely is a trust problem, not just a battery one. After a long silence
   * the room closes it and says so; tapping the orb wakes it back up.
   */
  function armIdleCutoff() {
    later(() => {
      if (voice.micWindow !== "armed") return;
      setMicSleeping(true);
      syncRealtimeMic();
      setRoomNote("mic went to sleep. tap the orb when you're back.");
    }, armedIdleCutoffMs);
  }

  // Stops whatever the coach is saying (clip or live) without opening the mic.
  function cancelSpeaking() {
    if (turnStateRef.current !== "speaking") return;
    realtimeInterruptedRef.current = true;
    realtimeInterruptibleRef.current = false;
    setInterruptible(false);
    if (staticAudioRef.current) {
      stopStaticAudio(true);
      return;
    }
    voice.cancelSpeech();
  }

  function interruptSpeaking() {
    if (!realtimeInterruptibleRef.current || turnStateRef.current !== "speaking") {
      return;
    }

    const staticPlaying = staticAudioRef.current !== null;
    if (!staticPlaying && !voice.isConnected()) {
      return;
    }

    realtimeInterruptedRef.current = true;
    realtimeInterruptibleRef.current = false;
    setInterruptible(false);

    if (staticPlaying) {
      stopStaticAudio(true);
    } else {
      voice.cancelSpeech();
    }

    void startRealtimeListening(null).then((listening) => {
      if (!listening) setTurnState("ready");
    });
  }

  /**
   * Replays the line the coach just said, optionally slower. autoListen stays false on purpose:
   * they asked to HEAR it again, not to answer yet -- reopening the mic would put them back on the
   * spot, which is the opposite of what asking for a replay means.
   */
  /**
   * Records help usage for the current turn, keeping the strongest rung reached. Called from every
   * surface that reveals something the learner could otherwise have had to produce themselves.
   */
  function noteAssistance(used: AssistanceUsed) {
    if (assistanceRank[used] > assistanceRank[turnAssistanceRef.current]) {
      turnAssistanceRef.current = used;
    }
  }

  /**
   * #49 -- one spoken line, unprompted, the moment the learner beats their own blocker twice in a
   * row. This is the payoff for having told OutLoud anything, so the claim has to be exactly true:
   * it fires only on a clear meaning with `turnAssistanceRef` still at "none", which means they
   * opened no sheet, replayed no audio and asked nothing on that turn.
   *
   * The wording deliberately does NOT say "without me". `responseGuidanceEn` is on screen the
   * whole time, so some help was always present; what they did not do is reach for more. Claiming
   * more than that would be the same overclaim the rest of Phase 0 exists to remove.
   *
   * Once per session. A second one stops being a moment and starts being a scoreboard.
   */
  function calloutForTurn(evaluation: AttemptEvaluation | null, closing: boolean) {
    const unaided =
      turnAssistanceRef.current === "none" &&
      !turnSubtitleRef.current &&
      evaluation?.meaningResult === "clear";
    unaidedRunRef.current = unaided ? unaidedRunRef.current + 1 : 0;

    /*
     * The phrase they asked for, produced alone, days later, in a scene built for something else.
     *
     * Nothing is said about it on the way IN -- the moment the screen announces "you asked about
     * this on tuesday" before they try, they are looking at a system instead of feeling a memory.
     * Afterwards is the exact opposite, and this line is the one most likely to be the thing
     * somebody tells a friend about. It outranks the unaided-run callout because it is rarer, and
     * because it is theirs.
     */
    const landedPhrase = landedPhraseRef.current;
    if (landedPhrase) {
      landedPhraseRef.current = null;
      calloutSpokenRef.current = true;
      const asked = askedOnLabel(landedPhrase.createdAt);
      return `that's the one you asked me about${asked ? ` ${asked}` : ""} — and you just reached for it.`;
    }

    if (!unaided || closing || calloutSpokenRef.current || unaidedRunRef.current < 2) return null;
    calloutSpokenRef.current = true;
    return "twice in a row now — and you didn't reach for help once.";
  }

  /**
   * "yesterday", "on tuesday", "last week" -- or nothing at all.
   *
   * Nothing rather than a wrong day. The whole force of the line is that we remembered, and a date
   * that is off by one turns the payoff into evidence that we did not.
   */
  function askedOnLabel(createdAt: string) {
    const then = new Date(createdAt).getTime();
    if (Number.isNaN(then)) return "";
    const days = Math.round((Date.now() - then) / 86_400_000);
    if (days < 1) return "";
    if (days === 1) return "yesterday";
    if (days <= 6) return `on ${new Date(then).toLocaleDateString(undefined, { weekday: "long" }).toLowerCase()}`;
    if (days <= 13) return "last week";
    return "";
  }

  function replayCoachLine(slow: boolean) {
    const line = coachLine;
    const state = turnStateRef.current;
    // A replay while a response is already generating would stack two lines on one channel.
    if (!line || state === "speaking" || state === "thinking") return;

    setRoomNote(null);
    noteAssistance(slow ? "slower_audio" : "repeat");
    void speakCoachText(line, currentRealtimeMode(), 1800, { autoListen: false, slow });
  }

  function currentRealtimeMode() {
    return flowPhase === "session" && placementRescue ? "conversation" : "intake";
  }

  /**
   * `resumingSpeech` means the learner is ALREADY talking -- VAD fired and this call is promoting
   * an armed mic into a real turn. Two things must not be reset in that case:
   *
   * - the transcript ref, which already holds the deltas for the word that started the turn;
   * - the speech flags, because speech_started will not fire a second time for the same utterance,
   *   and finishRealtimeListening discards any transcript that arrives with speechSeen false as a
   *   noise hallucination. Without this, every voice-started turn would be silently thrown away.
   */
  async function startRealtimeListening(
    pressSession: number | null,
    options: { resumingSpeech?: boolean } = {},
  ) {
    const connected = await ensureRealtime(currentRealtimeMode());

    if (!connected || !voice.isConnected()) {
      vlog("listen", "REFUSED: connected:", connected);
      return false;
    }

    // A newer press superseded this one, or the mic is already open: nothing to do.
    if ((pressSession !== null && pressSessionRef.current !== pressSession) || voice.capturing) {
      vlog(
        "listen",
        "SKIPPED:",
        voice.capturing ? "already capturing" : "press superseded",
        "| press:", pressSession,
        "| current:", pressSessionRef.current,
      );
      return true;
    }
    vlog("listen", "OPENING capture, resumingSpeech:", options.resumingSpeech === true);
    applyTranscriptionLanguage(expectsEnglishAnswerNow() ? "en" : "es");

    clearTimers();
    setRoomNote(null);
    setLastTranscript(null);
    voice.openCapture(options);
    holdingRef.current = true;
    setMicSleeping(false);
    setTurn("listening");
    syncRealtimeMic();

    later(() => {
      setTurnState((current) => (current === "listening" ? "still-listening" : current));
    }, 2200);

    return true;
  }

  // manual = the learner tapped/released to end the turn. Otherwise server VAD ended it and the
  // buffer is already committed.
  async function finishRealtimeListening(manual: boolean) {
    if (!voice.capturing) {
      vlog("finish", "IGNORED: no active capture (manual:", manual, ")");
      return;
    }
    vlog("finish", "closing capture, manual:", manual, "| speechSeen:", voice.speechSeen);
    // Closed, then the mic, then the commit -- in that order. The window has to be shut before
    // `deriveMicWindow` runs, and the buffer commit has to be the last thing that happens while
    // the track is still live.
    const { speechSeen } = voice.closeCapture();
    holdingRef.current = false;
    clearTimers();
    setTurn("thinking");
    // Closes the mic: "thinking" never derives to armed, so this also covers open mode.
    syncRealtimeMic();

    const transcript = await voice.awaitTranscript({ commit: manual });

    vlog("finish", "transcript:", JSON.stringify(transcript), "| speechSeen:", speechSeen);

    const said = transcript.trim();
    // Shared with the entry screen, which captures speech too now. Only the VERDICT is shared:
    // what to do about it stays here, because a room mid-session and a learner arriving at the
    // door want different things from the same "that was only um".
    const verdict = classifyCapture(said, speechSeen);

    // Voice activity was never detected during this capture, yet a transcript came back --
    // almost certainly a hallucination from background noise, not a real reply. There's no
    // graded confidence signal on the realtime path, so VAD is the only gate available.
    if (verdict === "no-speech" || verdict === "empty") {
      vlog(
        "finish",
        "DISCARDED as dud —",
        verdict === "no-speech"
          ? "server VAD never reported speech (threshold too high?)"
          : "transcript came back empty",
        "| transcript:", JSON.stringify(transcript),
      );
      registerDudCapture();
      setTurn("ready");
      syncRealtimeMic();
      return;
    }

    // A decoder loop, not a learner. Discarded before anything can score or store it.
    if (verdict === "decode-loop") {
      vlog("finish", "DISCARDED as decode loop:", JSON.stringify(said.slice(0, 120)));
      // The loop is usually what a clipped recording decodes into, so the next capture gets the
      // patient window: cutting them off again would just reproduce it.
      patientCaptureRef.current = true;
      registerDudCapture();
      setRoomNote("that came back garbled — say it once more, I'll wait longer.");
      setTurn("ready");
      syncRealtimeMic();
      return;
    }

    // Nothing but "um" -- they are still thinking, and the microphone mistook a pause for an
    // ending. Give the time back instead of treating it as an answer.
    if (verdict === "filler") {
      fillerRetriesRef.current += 1;
      vlog("filler", "hesitation-only capture", fillerRetriesRef.current, JSON.stringify(said));

      if (fillerRetriesRef.current <= maxFillerRetries) {
        patientCaptureRef.current = true;
        setRoomNote("take your time.");
        setTurn("ready");
        syncRealtimeMic();
        // Reopened rather than left armed: they were already speaking, and making them start the
        // whole utterance again is the opposite of waiting for them.
        void beginAutoListen();
        return;
      }

      // Out of patience. Not a dud -- the room is not noisy and hold-to-talk would not help, so
      // this deliberately does NOT go through registerDudCapture. Just say so and stay open.
      vlog("filler", "patience spent; handing the turn back");
      patientCaptureRef.current = false;
      setRoomNote(
        micModeRef.current === "open"
          ? "whenever you're ready — or type it if that's easier."
          : "tap the orb when you're ready, or type it.",
      );
      setTurn("ready");
      syncRealtimeMic();
      return;
    }

    // Real content came through: both the noise and the patience budgets start again.
    fillerRetriesRef.current = 0;
    patientCaptureRef.current = false;
    noisyStrikesRef.current = 0;
    setLastTranscript(said);
    // No graded confidence tier exists on the realtime path -- VAD is the only signal, and it
    // already passed the gate above.
    routeCapturedTranscript(said, false);
  }

  /**
   * A capture that produced nothing usable. Two in a row is already a bad experience with an open
   * mic, so that's where the room stops guessing and offers hold-to-talk instead of making the
   * learner work out that their kitchen is the problem.
   */
  function registerDudCapture() {
    vlog("dud", "strike", noisyStrikesRef.current + 1);
    noisyStrikesRef.current += 1;
    const noisy = noisyStrikesRef.current >= 2 && micModeRef.current === "open";

    if (noisy && !noisyOfferShownRef.current) {
      noisyOfferShownRef.current = true;
      setNoisyOfferOpen(true);
      setRoomNote("I keep missing you. noisy room?");
      return;
    }

    setRoomNote(
      micModeRef.current === "open"
        ? "didn't catch that. try again whenever you're ready."
        : "nothing came through. tap the orb to try again, or type.",
    );
  }

  function later(callback: () => void, delay: number) {
    const timer = window.setTimeout(callback, delay);
    timers.current.push(timer);
  }

  /**
   * Sets the English line under the Spanish, tagged with what it actually is. `folded` is passed
   * explicitly rather than derived from flowPhase because several callers run after an `await`,
   * where the captured flowPhase would be stale.
   */
  function showMeaning(
    text: string | null,
    kind: "translation" | "instruction" | null,
    options: { folded?: boolean } = {},
  ) {
    setCoachMeaning(text);
    setCoachMeaningKind(text ? kind : null);
    if (options.folded !== undefined) setEnglishFolded(options.folded);
  }

  function showCoachReply(reply: ConverseReply, callout: string | null = null) {
    clearTimers();
    // A new turn: whatever help the last one needed is history.
    turnAssistanceRef.current = "none";
    turnSubtitleRef.current = false;
    setSessionCallout(callout);
    setConversationId(reply.conversationId);
    setTurnIndex(reply.turnIndex);
    setCoachLine(reply.characterLineEs);
    // A real session turn: the translation starts hidden, always one tap away.
    showMeaning(reply.characterMeaningEn, "translation", { folded: true });
    setCurrentConversationTurn(reply);
    setRoomNote(reply.responseGuidanceEn || null);
    setTurnState("speaking");
    // The callout rides on the same utterance rather than a second `response.create`: two
    // out-of-band responses on one channel would have the second cut off the first.
    void speakCoachText(callout ? `${callout} ${reply.characterLineEs}` : reply.characterLineEs, "conversation", 1800, {
      autoListen: !reply.shouldClose,
      interruptible: !reply.shouldClose,
      onDone: () => {
        if (reply.shouldClose) {
          // Updater form: reopening the card later must not move the return date.
          setSessionClosedAt((current) => current ?? new Date().toISOString());
          // Q4's far end. Everybody who reaches this saw the session through; the gap between
          // this count and `session_started` is the drop-off, and the replay says why.
          track("session_closed", { turns: sessionTurns.length, saved: Boolean(savedMomentId) });
          setOverlay("after");
        }
      },
    });
  }

  async function readJson<T>(response: Response): Promise<T> {
    const json = await response.json();
    if (!response.ok) {
      const message =
        typeof json === "object" &&
        json !== null &&
        "error" in json &&
        typeof json.error === "string"
          ? json.error
          : "OutLoud could not answer yet.";
      throw new Error(message);
    }
    return json as T;
  }

  function buildPlacementRequest(openingText: string, attempts: PlacementAttempt[]) {
    const originalText = clipForApi(buildPlacementText(openingText, attempts, mode));
    const combinedAttempt = clipForApi(attempts.map((item) => item.userAttempt).join(" "));
    const selfReportedBlocker = reportedBlocker ?? "not_sure";

    return {
      entryMode: "wanted_to_say",
      originalText,
      scenarioContext: clipForApi(
        `${
          mode === "upcoming"
            ? "The learner is preparing for a real situation that is coming up and has not happened yet. Use their description of it and their replies to the coach as the source of truth, and never describe it as something that already went wrong."
            : mode === "stung"
              ? "The learner started from a real situation where they did not know what to say. Use their story and their replies to the coach as the source of truth."
              : "The learner just had a short coached voice conversation. Anchor everything on their self-described problem and what actually happened in the transcript."
        } Coach observations during the session: ${coachEvidence.length ? coachEvidence.join("; ") : "none recorded"}.`,
      ),
      context: {
        ...defaultConversationContext,
        who: conversationWho,
      },
      selfReportedBlocker,
      selfReportedBlockers: [selfReportedBlocker],
      attempt: combinedAttempt,
      skippedAttempt: false,
    };
  }

  async function evaluatePlacementAttempt(
    request: ReturnType<typeof buildPlacementRequest>,
    rescue: RescueResponse,
    attempt: PlacementAttempt,
  ) {
    return readJson<AttemptEvaluation>(
      await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalText: request.originalText,
          scenarioContext: request.scenarioContext,
          context: request.context,
          rescue,
          attempt: attempt.userAttempt,
          inputMode: attempt.inputMode,
          stage: "independent_rebuild",
          assistanceUsed: "none",
          conversationTurn: {
            characterLineEs: attempt.characterLineEs,
            characterMeaningEn: attempt.characterMeaningEn,
            expectedCommunicativeFunction: attempt.expectedCommunicativeFunction,
          },
          variation: null,
          lowConfidenceAttempt: attempt.lowConfidence ?? false,
        }),
      }),
    );
  }

  async function finishPlacement(attempts: PlacementAttempt[]) {
    const openingText = openingAnswer.trim() || "speaking Spanish out loud feels hard";
    const placementRequest = buildPlacementRequest(openingText, attempts);

    clearTimers();
    setTurnState("thinking");
    setRoomNote(null);

    try {
      const rescue = await readJson<RescueResponse>(
        await fetch("/api/rescue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(placementRequest),
        }),
      );
      // Judge the real answers, not the repeats of phrases the coach handed over.
      const probes = attempts.filter((attempt) => attempt.kind === "probe").slice(-3);
      const spoken = attempts.filter((attempt) => attempt.kind !== "setup");
      const toJudge = probes.length ? probes : spoken.slice(-1);
      const evaluations = await Promise.all(
        toJudge.map((attempt) => evaluatePlacementAttempt(placementRequest, rescue, attempt)),
      );

      setPlacementSummary(placementRequest.originalText);
      setPlacementRescue(rescue);
      setPlacementEvaluations(evaluations);

      /*
       * Q4's first real milestone: the app has given something back. Everything before this is
       * the learner working; this is the first moment they get anything for it.
       *
       * The gap between `session_started` and here is the intake, which is the longest stretch
       * of the whole product without a payoff and therefore the likeliest place to lose somebody.
       * The blocker travels because it comes from a fixed list of eight; nothing else here does.
       */
      track("rescue_reached", {
        turns: sessionTurns.length,
        blocker: reportedBlocker ?? "not_sure",
      });

      /*
       * The first go at an event is the only thing that produces its rescue, and every go after
       * it starts its scene from that same rescue. So it has to outlive the session that made it
       * -- otherwise go two is another placement, and a four-session run-up is four placements.
       */
      const active = activeEventRef.current;
      if (active && !active.event.rescue) {
        void patchEvent(active.event.id, {
          rescue,
          focusBlocker: rescue.observed_blocker?.type ?? null,
        }).then((updated) => {
          if (updated && activeEventRef.current) activeEventRef.current = { ...activeEventRef.current, event: updated };
        });
      }
      setFlowPhase("verdict");
      setTurnState("speaking");
      setOverlay("verdict");
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not place this yet.";
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  function collectCoachLoot(turn: CoachResponse) {
    const es = turn.tool.primaryEs?.trim();
    if (es) {
      const en = turn.tool.primaryEn?.trim() || null;
      setCoachLoot((current) =>
        current.some((item) => item.es.toLowerCase() === es.toLowerCase()) ? current : [...current, { es, en }],
      );
    }
    if (turn.evidence) {
      const line = `${turn.evidence.observedBlocker} (${turn.evidence.confidence}): ${turn.evidence.noteEn}`;
      setCoachEvidence((current) => (current.includes(line) ? current : [...current, line]));
    }
    // Only the framing turn carries this (the route pins it there), so the truthiness guard is
    // belt and braces -- but it keeps a null on a later turn from erasing what they told us.
    if (turn.selfReportedBlocker) setReportedBlocker(turn.selfReportedBlocker);
    if (turn.sceneCharacter) setSceneCharacter(turn.sceneCharacter);
  }

  function showCoachTurn(turn: CoachResponse) {
    clearTimers();
    setCoachTurn(turn);
    collectCoachLoot(turn);
    setCoachLine(turn.sayEs);
    setCoachLineFolded(false);
    // Framing/scenario turns are already English; a "meaning" line under them is just noise.
    // Shown unfolded: this is the scaffolding before a real session, where the learner has no
    // context yet and hiding the meaning would just be an obstacle.
    showMeaning(
      turn.phase === "framing" || turn.phase === "scenario" ? null : turn.meaningEn,
      "translation",
      { folded: false },
    );
    setRoomNote(null);
    setTurnState("speaking");
    void speakCoachText(turn.sayEs, "intake", 1400, {
      slow: turn.tool.type === "slow_repeat",
      // Preparation time means: no mic until they tap. Everything else hands the turn over.
      autoListen: turn.tool.type !== "preparation_time",
    });
  }

  async function handleCoachAttempt(attempt: string, inputMode: "spoken" | "written", lowConfidence = false) {
    const turn = coachTurn;
    if (!coachId || !turn) {
      setRoomNote("the coach needs a moment. try again.");
      setTurnState("ready");
      return;
    }

    const nextAttempts: PlacementAttempt[] = [
      ...placementAttempts,
      {
        characterLineEs: turn.sayEs,
        characterMeaningEn: turn.meaningEn,
        expectedCommunicativeFunction: turn.expectedCommunicativeFunction,
        userAttempt: attempt,
        inputMode,
        lowConfidence,
        kind:
          turn.phase === "framing" || turn.phase === "scenario"
            ? "setup"
            : turn.intent === "retry" || turn.tool.type === "say_it_back"
              ? "retry"
              : "probe",
      },
    ];
    setPlacementAttempts(nextAttempts);

    try {
      const next = await readJson<CoachResponse>(
        await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "respond", coachId, userAttempt: attempt, inputMode }),
        }),
      );

      if (next.done) {
        setCoachTurn(next);
        collectCoachLoot(next);
        setCoachLine(next.sayEs);
        // Still the coach/intake scaffolding, not a session turn.
        showMeaning(next.meaningEn, "translation", { folded: false });
        setTurnState("speaking");
        // finishPlacement owns the turn state from here: it is already fetching the rescue, and a
        // "ready" from the closing line would let the learner answer into a finished conversation.
        void speakCoachText(next.sayEs, "intake", 1400, {
          autoListen: false,
          interruptible: false,
          handBackTurn: false,
        });
        void finishPlacement(nextAttempts);
        return;
      }

      showCoachTurn(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not continue yet.";
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  /**
   * `coachMode` is explicit rather than read from `mode` because an event beat sets both at once
   * and the state has not landed by the time this runs -- and because getting it wrong is the
   * tense bug: the coach would talk about a dinner they have not been to as though it had already
   * gone badly.
   */
  async function handleOpeningAttempt(
    attempt: string,
    coachMode?: "speaks-first" | "stung" | "upcoming",
    namedScenario?: string | null,
  ) {
    setOpeningAnswer(attempt);
    setPlacementAttempts([]);
    setPlacementEvaluations([]);
    setPlacementRescue(null);
    setPlacementSummary("");
    setCoachTurn(null);
    setCoachLoot([]);
    setCoachEvidence([]);
    setReportedBlocker(null);
    setSceneCharacter(null);
    setFlowPhase("coach");
    setTurnState("thinking");

    try {
      const first = await readJson<CoachResponse>(
        await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            mode: coachMode ?? (mode === "stung" ? "stung" : mode === "upcoming" ? "upcoming" : "speaks-first"),
            openingAnswer: attempt,
            // Only when the situation was settled before the session started. Sending the opening
            // answer here regardless would remove the framing turn from the learner who most
            // needs it: the one whose whole answer was "I just froze, I don't know".
            namedScenario: namedScenario ?? null,
            context: defaultConversationContext,
          }),
        }),
      );
      setCoachId(first.coachId);
      showCoachTurn(first);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not start coaching yet.";
      setFlowPhase("opening");
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  /**
   * Everything a scene needs cleared before it starts. Lifted out of `startFirstSession` when
   * event beats got a second way in: two copies of this list would drift, and the half that
   * drifts is always the counters -- an unaided run carried across two conversations is the app
   * telling somebody they did something twice in a row that they did once.
   */
  function beginSession() {
    // Q4's denominator, and the point every drop-off is measured against. `entry` matters as much
    // as the count: somebody arriving from a planned event has already committed to a real date,
    // and should behave nothing like somebody who tapped the fallback offer.
    track("session_started", {
      entry: activeEventRef.current ? "event_beat" : "intake",
      signedIn: Boolean(authedEmail),
    });
    clearTimers();
    setOverlay(null);
    setFlowPhase("session");
    setConversationId(null);
    setTurnIndex(0);
    setSessionTurns([]);
    setSessionCallout(null);
    unaidedRunRef.current = 0;
    calloutSpokenRef.current = false;
    turnAssistanceRef.current = "none";
    turnSubtitleRef.current = false;
    setCurrentConversationTurn(null);
    setSavedMomentId(null);
    setSessionClosedAt(null);
    setSaveStatus("idle");
    setLastReviewUrl(null);
    setTurnState("thinking");
    setRoomNote(null);
  }

  async function startFirstSession() {
    if (!placementRescue || !placementSummary) {
      closeOverlay();
      setRoomNote("the verdict needs one more answer first.");
      setTurnState("ready");
      return;
    }

    beginSession();

    try {
      const first = await readJson<ConverseReply>(
        await fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            // Not during an event run-up: in `upcoming` mode this IS a go at a dated evening.
            originalText: attachDuePhrase(placementSummary, mode !== "upcoming"),
            scenarioContext:
              mode === "upcoming"
                ? "Start from the situation the learner is preparing for and the coached-conversation evidence."
                : mode === "stung"
                  ? "Start from the learner's real situation and the coached-conversation evidence."
                  : "Start from the learner's coached-conversation evidence.",
            context: {
              ...defaultConversationContext,
              who: conversationWho,
            },
            rescue: placementRescue,
            pressureMode,
          }),
        }),
      );
      showCoachReply(first);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not start the session yet.";
      setFlowPhase("verdict");
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  async function evaluateSessionAttempt(attempt: string, turn: ConverseReply, lowConfidence = false) {
    if (!placementRescue || !placementSummary) return null;

    return readJson<AttemptEvaluation>(
      await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalText: placementSummary,
          scenarioContext:
            mode === "upcoming"
              ? "Evaluate this reply inside the situation the learner is preparing for."
              : mode === "stung"
                ? "Evaluate this reply inside the learner's real situation."
                : "Evaluate this reply inside the learner's first OutLoud session.",
          context: {
            ...defaultConversationContext,
            who: conversationWho,
          },
          rescue: placementRescue,
          attempt,
          inputMode: "spoken",
          stage: "changed_context",
          // Was hardcoded "none". Every stored intervention outcome therefore claimed the learner
          // needed no help, whatever they actually reached for.
          assistanceUsed: turnAssistanceRef.current,
          conversationTurn: {
            characterLineEs: turn.characterLineEs,
            characterMeaningEn: turn.characterMeaningEn,
            expectedCommunicativeFunction: turn.expectedCommunicativeFunction ?? "continue the conversation",
          },
          variation: null,
          lowConfidenceAttempt: lowConfidence,
        }),
      }),
    );
  }

  function restoreCurrentTurn(note: string) {
    if (currentConversationTurn) {
      setCoachLine(currentConversationTurn.characterLineEs);
      // Back into the live session turn, so the translation folds away again.
      showMeaning(currentConversationTurn.characterMeaningEn, "translation", { folded: true });
    }
    setRoomNote(note);
    setTurnState("ready");
  }

  /**
   * Everything the aside needs to know about where the learner just walked out of.
   *
   * Built in one place because `enterAside` and every following `handleAsideAttempt` must agree:
   * the route is stateless, so this travels on every call, and a snapshot that drifted between
   * the opening call and the replies would have the coach quietly change what it thinks it is
   * talking about halfway through.
   */
  function asideSceneSnapshot() {
    const focus = { current: focusBlocker, stated: statedFocus, observed: observedFocus };

    if (flowPhaseRef.current === "coach" && coachTurn) {
      return {
        stage: "intake" as const,
        focus,
        scene: {
          characterEn: "the OutLoud coach, still working out what this learner needs",
          scenarioEn: openingAnswer ? `What they said at the very start: "${openingAnswer}"` : null,
          characterLineEs: coachTurn.sayEs,
          characterMeaningEn: coachTurn.meaningEn || null,
        },
        // No evaluator runs during the intake, so these carry what was said and nothing about
        // whether it was right -- claiming a verdict we do not have would be worse than silence.
        recentTurns: placementAttempts.slice(-3).map((attempt) => ({
          characterLineEs: attempt.characterLineEs,
          userAttempt: attempt.userAttempt,
          meaning: "not evaluated -- this is still the intake",
        })),
      };
    }

    const turn = currentConversationTurn;
    return {
      stage: "session" as const,
      focus,
      scene: {
        characterEn: conversationWho,
        scenarioEn: sceneCharacter
          ? `${sceneCharacter.name} -- ${sceneCharacter.relation}. ${sceneCharacter.traitEn}`
          : null,
        characterLineEs: turn?.characterLineEs ?? null,
        characterMeaningEn: turn?.characterMeaningEn ?? null,
      },
      // Enough to tell one bad turn from a pattern, and no more: the coach is here to hear what
      // the learner says is wrong, not to re-litigate the transcript.
      recentTurns: sessionTurns
        .filter((sessionTurn) => sessionTurn.userAttempt)
        .slice(-3)
        .map((sessionTurn) => ({
          characterLineEs: sessionTurn.characterLineEs,
          userAttempt: sessionTurn.userAttempt ?? "",
          meaning: sessionTurn.evaluation?.meaningResult ?? "unclear",
        })),
    };
  }

  /**
   * Step out and talk to the coach about what is actually in the way.
   *
   * `trigger` records who decided: "learner" when they reached for it, "offered" when the room
   * noticed two replies in a row not landing and put it in front of them. The coach opens
   * differently for each -- see `asideTurnGuidance` in app/api/aside/route.ts -- because "you
   * walked out, what is up" and "that was not working, what is going on" are not the same
   * question, and asking the wrong one wastes the first turn.
   */
  /**
   * `stuckSaid` is only set for `trigger: "stuck"` -- the sentence they said in the scene, passed
   * through verbatim so the coach opens with the words instead of asking why they are here. A
   * coach that has to ask what you meant, when you just said it, is the thing this detour exists
   * to stop happening.
   */
  async function enterAside(trigger: "learner" | "offered" | "stuck", stuckSaid?: string) {
    if (asideActiveRef.current) return;
    const snapshot = asideSceneSnapshot();
    // Nothing to step out OF yet, and nothing to come back to.
    if (!snapshot.scene.characterLineEs) return;

    clearTimers();
    setAsideNudgeOpen(false);
    setNoisyOfferOpen(false);
    closeOverlay();
    setTypedFallbackOpen(false);
    setTranscriptNeedsConfirm(false);
    // A drill they walked out of does not survive the detour: with `retryTarget` still set, the
    // first thing they said to the coach would be scored as an attempt at a Spanish phrase.
    setRetryTarget(null);

    asideActiveRef.current = true;
    setAsideActive(true);
    setAsideLine(null);
    setAsideOffer(null);
    setAsideExchange([]);
    setRoomNote(null);
    setTurn("thinking");
    syncRealtimeMic();

    try {
      const first = await readJson<AsideResponse>(
        await fetch("/api/aside", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger,
            stuckSaid: stuckSaid ?? null,
            // /api/aside is stateless: the whole aside travels on every call. Empty here because
            // nothing has been said yet.
            exchange: [],
            ...snapshot,
          }),
        }),
      );
      showAsideTurn(first, []);
    } catch (error) {
      // Never strand them outside. If the coach cannot come to the phone, put them back where
      // they were and say so, rather than leaving a dead room with no way forward.
      const message = error instanceof Error ? error.message : "OutLoud could not step out just now.";
      leaveAside(null);
      setRoomNote(`${message} we're still where you left off.`);
    }
  }

  /**
   * `base` is the exchange this turn was generated FROM, passed in rather than read from state:
   * the reply and the message that prompted it are appended in the same tick, and a functional
   * update would race the request that is already in flight with the older thread.
   */
  function showAsideTurn(turn: AsideResponse, base: Array<{ who: "coach" | "you"; text: string }>) {
    setAsideLine(turn.sayEn);
    setAsideExchange([...base, { who: "coach", text: turn.sayEn }]);
    setAsideOffer(turn.offer);
    setRoomNote(null);
    setTurn("speaking");
    // Still `autoListen` when there is an offer on screen: an offer is the coach reading them, not
    // a verdict, and "no, that is not it either" has to be sayable without hunting for a button.
    // The aside session is kept alive on the server for exactly that reason -- it is closed by
    // `leaveAside`, never by `done`.
    void speakCoachText(turn.sayEn, currentRealtimeMode(), 1600, { autoListen: true, interruptible: true });
  }

  async function handleAsideAttempt(text: string) {
    const snapshot = asideSceneSnapshot();
    if (!snapshot.scene.characterLineEs) {
      leaveAside(null);
      return;
    }

    const sent: Array<{ who: "coach" | "you"; text: string }> = [...asideExchange, { who: "you", text }];
    setAsideExchange(sent);
    // They kept talking instead of taking the offer, so the offer is no longer the live question.
    setAsideOffer(null);
    setTurn("thinking");
    syncRealtimeMic();

    try {
      const next = await readJson<AsideResponse>(
        await fetch("/api/aside", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exchange: sent, ...snapshot }),
        }),
      );
      showAsideTurn(next, sent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not answer that yet.";
      setAsideLine(message);
      setRoomNote("try that again, or head back.");
      setTurn("ready");
      syncRealtimeMic();
    }
  }

  async function acceptAsideOffer() {
    const offer = asideOffer;
    if (!offer) return;

    if (offer.kind === "change_focus" && offer.newFocus) {
      setAsideFocusOverride(offer.newFocus as BlockerType);
      leaveAside("got it. that is what we are working on from here.");
      return;
    }

    if (offer.kind === "change_scenario" && offer.newScenarioEn && offer.newCharacter) {
      await restartSceneFromAside(offer.newScenarioEn, offer.newCharacter);
      return;
    }

    if (offer.kind === "start_over" && offer.newOpeningEn) {
      await restartIntakeFromAside(offer.newOpeningEn);
      return;
    }

    leaveAside("okay, back to it.");
  }

  /**
   * Back into the scene, which was never torn down: `conversationId`, `turnIndex` and
   * `currentConversationTurn` are exactly as they were, so this is a re-entry, not a restart.
   *
   * The character line is spoken again rather than just re-rendered. The learner has been away
   * having a different conversation in a different language; dropping them back onto a silent
   * Spanish sentence they last heard three minutes ago is how you lose the thread.
   */
  function leaveAside(spokenLeadIn: string | null) {
    asideActiveRef.current = false;
    setAsideActive(false);
    setAsideLine(null);
    setAsideOffer(null);
    setAsideExchange([]);
    setAsideNudgeOpen(false);
    // Whatever was not landing before, they have now been heard about it. Making them earn the
    // offer a second time on the next stumble would read as nagging.
    asideStrikesRef.current = 0;

    // The intake's own turn is restored the way `showCoachTurn` renders it -- framing and
    // scenario turns are already English and get no meaning line, which is why this cannot just
    // reuse the session branch below.
    if (flowPhaseRef.current === "coach" && coachTurn) {
      setCoachLine(coachTurn.sayEs);
      showMeaning(
        coachTurn.phase === "framing" || coachTurn.phase === "scenario" ? null : coachTurn.meaningEn,
        "translation",
        { folded: false },
      );
      setRoomNote(null);
      setTurn("speaking");
      void speakCoachText(
        spokenLeadIn ? `${spokenLeadIn} ${coachTurn.sayEs}` : coachTurn.sayEs,
        currentRealtimeMode(),
        1400,
        { autoListen: true, interruptible: true },
      );
      return;
    }

    const turn = currentConversationTurn;
    if (!turn) {
      setTurn("ready");
      syncRealtimeMic();
      return;
    }

    setCoachLine(turn.characterLineEs);
    showMeaning(turn.characterMeaningEn, "translation", { folded: true });
    setRoomNote(turn.responseGuidanceEn || null);
    setTurn("speaking");
    void speakCoachText(
      spokenLeadIn ? `${spokenLeadIn} ${turn.characterLineEs}` : turn.characterLineEs,
      currentRealtimeMode(),
      1800,
      { autoListen: true, interruptible: true },
    );
  }

  /**
   * The intake was built on a wrong premise, so it is thrown away and asked again from what the
   * learner has just said about themselves.
   *
   * `handleOpeningAttempt` already resets everything an intake owns, including the coach's
   * classification of them -- which is the point: the whole reason to be here is that the old
   * classification was answering the wrong question. `asideFocusOverride` goes with it, since the
   * coach is about to form a fresh opinion and a leftover override would silently outrank it.
   */
  async function restartIntakeFromAside(newOpeningEn: string) {
    asideActiveRef.current = false;
    setAsideActive(false);
    setAsideLine(null);
    setAsideOffer(null);
    setAsideExchange([]);
    setAsideNudgeOpen(false);
    asideStrikesRef.current = 0;
    setAsideFocusOverride(null);
    await handleOpeningAttempt(newOpeningEn);
  }

  /**
   * The learner said the situation itself was wrong for them, and the coach agreed. New scene,
   * new person, same learner and same diagnosis.
   *
   * `sessionTurns` survives: those turns happened, the evidence in them is real, and the end card
   * and the profile are built from it. The unaided run does not -- "twice in a row now, and you
   * did not reach for help once" across a scene change would be counting two conversations as one.
   */
  async function restartSceneFromAside(
    scenarioEn: string,
    character: { name: string; relation: string; traitEn: string },
  ) {
    if (!placementRescue || !placementSummary) {
      leaveAside("okay, back to it.");
      return;
    }

    const previousConversationId = conversationId;

    asideActiveRef.current = false;
    setAsideActive(false);
    setAsideLine(null);
    setAsideOffer(null);
    setAsideExchange([]);
    setAsideNudgeOpen(false);
    asideStrikesRef.current = 0;
    unaidedRunRef.current = 0;

    setSceneCharacter(character);
    setRoomNote(null);
    setTurn("thinking");
    syncRealtimeMic();

    // Built here rather than read from `conversationWho`, which is derived from `sceneCharacter`
    // and still holds the person they just left for the rest of this render.
    const who = `${character.name}, ${character.relation} (${character.traitEn})`;

    /**
     * A scene-neutral stand-in for `placementSummary`, and the fix for the worst bug this feature
     * had: `buildPlacementText` packs the ENTIRE transcript of the first coached conversation into
     * that string, so a learner who said "the cafe is not my problem, it is my girlfriend's family
     * at dinner" was moved to the dinner and greeted with "something to drink while we look at the
     * menu?". No amount of instruction outweighs a transcript full of restaurant lines; the
     * transcript simply must not travel to a scene the learner asked to leave it for.
     *
     * What does travel is what they are practising and what breaks -- which is the whole point of
     * moving them: same skill, somewhere it matters to them.
     */
    const carriedOver = [
      `The learner is practising this pattern: "${placementRescue.transferableChunk.patternEs}"`,
      `(${placementRescue.transferableChunk.communicativeFunction}).`,
      focusBlocker ? `What breaks for them: ${blockerFocusLabels[focusBlocker]}.` : "",
      "They asked to practise this somewhere else, so use only the pattern and the difficulty --",
      "the earlier situation is deliberately not included.",
    ]
      .filter(Boolean)
      .join(" ");

    const started = await startSceneFor({
      scenarioEn,
      who,
      carriedOver,
      // An ordinary scene, moved because the last one was wrong for them. Eligible.
      recallEligible: true,
      rescue: placementRescue,
      previousConversationId,
      arrivalNote: `okay, you are with ${character.name} now.`,
    });

    if (!started.ok) {
      // The old scene is still live on the server, so falling back into it is a real recovery.
      leaveAside(null);
      setRoomNote(`${started.message} we stayed where we were.`);
    }
  }

  /**
   * Starts a scene that is not the first one of a session: a different situation, the same
   * learner and the same diagnosis.
   *
   * Two callers now -- the aside moving somebody who said the situation was wrong for them, and a
   * go at a planned event. They need identical mechanics and they must NOT share the reason they
   * are here, which is why `carriedOver` is built by the caller: it is the one string that
   * decides what the character knows, and the aside's version deliberately withholds the earlier
   * situation while an event's deliberately supplies it.
   */
  async function startSceneFor(options: {
    scenarioEn: string;
    who: string;
    carriedOver: string;
    rescue: RescueResponse;
    previousConversationId: string | null;
    arrivalNote: string | null;
    /** Whether a phrase they asked for days ago may be built into this scene. See `attachDuePhrase`. */
    recallEligible: boolean;
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const first = await readJson<ConverseReply>(
        await fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            originalText: attachDuePhrase(options.carriedOver, options.recallEligible),
            scenarioContext: options.scenarioEn,
            // Without this the new scene inherits the old situation: the route treats
            // scenarioContext as background and anchors turn 0 in originalText, which still
            // describes the place the learner just told us is not their problem.
            sceneIsNew: true,
            context: { ...defaultConversationContext, who: options.who },
            rescue: options.rescue,
            pressureMode,
          }),
        }),
      );
      if (options.previousConversationId) {
        void fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close", conversationId: options.previousConversationId }),
        }).catch(() => undefined);
      }
      showCoachReply(first, options.arrivalNote ?? undefined);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "OutLoud could not set up that scene." };
    }
  }

  /**
   * A phrase question from /dash: the answer, and then the part that matters.
   *
   * `/api/lifeline` runs with no `currentLine` and no `rescue` -- both are optional and always
   * have been, which is the only reason this chain is cheap. It is a dictionary, not a
   * conversation: one question, one answer, no history.
   */
  async function runAskPhrase(handoff: AskPhraseHandoff) {
    setMode("speaks-first");
    setRoomNote(null);
    setAskPhrase(handoff);
    setPhraseAnswer(null);
    setPhraseStatus("asking");
    setFlowPhase("ask");
    setTurnState("thinking");

    try {
      const answer = await readJson<LifelineResponse>(
        await fetch("/api/lifeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: handoff.askEn, context: defaultConversationContext }),
        }),
      );
      setPhraseAnswer(answer);
      setPhraseStatus("ready");
      // Ready, so the mic arms. `expectsEnglishAnswerNow` does not list this phase, which is
      // exactly right: what they say next is Spanish.
      setTurnState("ready");
    } catch {
      setPhraseStatus("error");
      setTurnState("ready");
    }
  }

  /**
   * What they said back, turned into a real rescue.
   *
   * This is the load-bearing turn. `/api/converse` refuses to start without a rescue and a rescue
   * needs an attempt, which is the wall the event engine had to climb too — and here it is cheap,
   * because the thing normally missing is already present: `originalText` is literally what they
   * asked for.
   *
   * Deliberately no moment is saved. A thirty-second lookup is not a session, and putting one in
   * the list next to a real one would make the list lie about what somebody has done.
   */
  async function handlePhraseAttempt(attempt: string) {
    if (!askPhrase) return;
    setPhraseStatus("scoring");
    setTurnState("thinking");

    try {
      const rescue = await readJson<RescueResponse>(
        await fetch("/api/rescue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryMode: "wanted_to_say",
            originalText: askPhrase.askEn,
            scenarioContext: "The learner asked how to say this and is saying it back for the first time. There is no scene yet.",
            context: defaultConversationContext,
            selfReportedBlocker: "not_sure",
            attempt,
            skippedAttempt: false,
          }),
        }),
      );
      setPlacementRescue(rescue);
      setPhraseStatus("done");
      setTurnState("ready");
      void keepAskedPhrase(rescue);
    } catch (error) {
      const message = error instanceof Error ? error.message : "that did not go through.";
      setRoomNote(`${message} you can say it again.`);
      setPhraseStatus("ready");
      setTurnState("ready");
    }
  }

  /**
   * The phrase, kept against their account with a date to come back.
   *
   * Signed out this does nothing, and that is a real hole rather than an oversight: `word_bank`
   * is scoped to `auth.users`. Failing quietly is right for the same reason the moment save does
   * — the learner has the phrase either way, and an error about storage in the middle of
   * practising is noise about our problem.
   */
  async function keepAskedPhrase(rescue: RescueResponse) {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const words = [
      { spanish: rescue.natural_version, meaningEn: askPhrase?.askEn ?? null, source: "asked" as const },
      {
        spanish: rescue.transferableChunk.patternEs,
        meaningEn: rescue.transferableChunk.meaningEn,
        source: "asked" as const,
      },
    ].filter((word) => word.spanish.trim().length > 0);
    if (!words.length) return;

    try {
      await fetch("/api/word-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ momentId: null, words }),
      });
      // Q7's denominator. Everything the phrase feature claims is measured against how many
      // phrases somebody went looking for in the first place.
      track("phrase_asked", {});
    } catch {
      // Nothing to tell them. The phrase is on their screen; the schedule is our problem.
    }
  }

  /**
   * Everything this learner has kept and not produced yet.
   *
   * Signed out this is empty and the whole half is simply off: `word_bank.user_id` is not null
   * against `auth.users`. Loaded once per visit to the room rather than per scene -- a scene start
   * is already three requests deep and this one must never be what makes it feel slow.
   */
  async function loadDuePhrases() {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    try {
      const answer = await readJson<{
        words: Array<{
          id: string;
          spanish: string;
          meaning_en: string | null;
          source: string;
          due_at: string | null;
          resurfaced_count: number | null;
          landed_at: string | null;
          created_at: string;
        }>;
      }>(await fetch("/api/word-bank", { headers: { Authorization: `Bearer ${token}` } }));

      // The third gate, and the quietest one: the server could schedule every phrase and this line
      // would still drop all but the asked-for ones on the way in. Filtering here and filtering on
      // the write were two copies of one rule, which is how the rule survived being changed once.
      duePhrasesRef.current = (answer.words ?? [])
        .map((word) => ({
          id: word.id,
          spanish: word.spanish,
          meaningEn: word.meaning_en,
          source: word.source,
          dueAt: word.due_at,
          resurfacedCount: Number(word.resurfaced_count ?? 0),
          landedAt: word.landed_at,
          createdAt: word.created_at,
        }));
    } catch {
      // No phrase comes back this session. Nothing else about the room depends on it.
    }
  }

  /**
   * The single injection point: one due phrase, appended to what the scene is built from.
   *
   * Every scene start goes through here and nothing else does, but not every scene is eligible --
   * `eligible` is passed explicitly by each caller rather than defaulted, because a default is how
   * "it fires every time" arrives later without anybody choosing it. A go at a planned event is
   * out: it is a run-up to a real dated evening, and an unrelated phrase in it is the same failure
   * as offering somebody a rotation topic next to their own dreaded call. The scene straight after
   * a phrase question is out too, because it already has a phrase in it.
   *
   * On top of that, `pickForScene` returns nothing about two scenes in three even when something
   * is due. A scene built around a saved phrase every single time is a vocabulary quiz in a
   * costume, and learners find that pattern fast.
   *
   * The instruction is written to create the NEED, never the words. A character that says the
   * phrase has handed it back, and the learner recognises instead of retrieving.
   */
  function attachDuePhrase(carriedOver: string, eligible: boolean) {
    if (!eligible) {
      activePhraseRef.current = null;
      return carriedOver;
    }
    const pick = pickForScene(duePhrasesRef.current);
    activePhraseRef.current = pick;
    if (!pick) return carriedOver;

    // Counted the moment it is used, not when the scene ends: a learner who walks out halfway has
    // still had it put in front of them, and pretending otherwise would keep it due forever.
    void recordPhraseOutcome(pick, "resurfaced");
    duePhrasesRef.current = duePhrasesRef.current.filter((phrase) => phrase.id !== pick.id);

    return [
      carriedOver,
      `Build ONE moment into this scene where the learner needs to say "${pick.spanish}"`,
      pick.meaningEn ? `(${pick.meaningEn}).` : ".",
      "Create the NEED for it: ask them something, or put them in a spot, where that is the natural thing to say.",
      "You must NEVER say it, hint at it, translate it, or offer it as an option. They asked for this phrase days ago and the whole point is that they reach for it on their own. If you produce it first, you have taken that away from them.",
      "Say nothing about them having asked for it. Not before, not during.",
    ].join(" ");
  }

  /**
   * Did the phrase this scene was carrying actually come out, and come out alone?
   *
   * Deterministic containment plus `assistanceUsed === "none"` -- both halves, neither negotiable.
   * The evaluator's own `usedTargetChunk` judges the rescue's chunk, which here is a different
   * string entirely, so it cannot be used for this.
   */
  function notePhraseAttempt(said: string, evaluation: AttemptEvaluation | null) {
    const phrase = activePhraseRef.current;
    if (!phrase) return;
    const assistance = evaluation?.assistanceUsed ?? turnAssistanceRef.current;
    if (assistance !== "none") return;
    if (!containsPhrase(said, phrase.spanish)) return;

    activePhraseRef.current = null;
    // Read by the next callout, which is the only place this is ever mentioned to the learner.
    landedPhraseRef.current = phrase;
    void recordPhraseOutcome(phrase, "landed");
  }

  async function recordPhraseOutcome(phrase: RecallPhrase, outcome: "resurfaced" | "landed") {
    /*
     * Q7, both halves, from the one place both outcomes pass through.
     *
     * `phrase_landed / phrase_asked` is the number the whole `talk` build exists for. The gap
     * between `resurfaced` and `landed` is the diagnosis when it is bad: many resurfaces and no
     * landings means the phrases come back and do not stick, which is a different problem from
     * them never coming back at all.
     *
     * Tracked before the request, not after: whether our own PATCH succeeded says nothing about
     * whether the learner produced the phrase, and losing an aha to a network blip would make the
     * one metric that matters quietly pessimistic.
     */
    const daysSinceAsked = Math.max(
      0,
      Math.round((Date.now() - new Date(phrase.createdAt).getTime()) / 86_400_000),
    );
    track(outcome === "landed" ? "phrase_landed" : "phrase_resurfaced", {
      resurfacedCount: phrase.resurfacedCount,
      daysSinceAsked,
    });

    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    try {
      await fetch("/api/word-bank", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: phrase.id, outcome }),
      });
    } catch {
      // The schedule slips by one scene. Not worth telling anybody about mid-conversation.
    }
  }

  /**
   * One offer, once they have said it: a scene where they have to use it for real.
   *
   * The situation comes from `/api/variation`, which is the machinery for exactly this — it
   * builds a nearby situation that REQUIRES a pattern without stating it. Handing the scene a
   * situation we invented here would produce a character that says the phrase first, which is the
   * one thing that destroys the point of practising it.
   */
  async function startSceneFromAskedPhrase() {
    if (!placementRescue || !askPhrase) return;
    setTurnState("thinking");
    setRoomNote(null);

    let situationEn = "";
    let who = defaultConversationContext.who;
    try {
      const variation = await readJson<{ situationEn: string; roleEs: string }>(
        await fetch("/api/variation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originalText: askPhrase.askEn,
            scenarioContext: null,
            context: defaultConversationContext,
            rescue: placementRescue,
          }),
        }),
      );
      situationEn = variation.situationEn;
      who = variation.roleEs || who;
    } catch {
      // A scene is still better than no scene. The pattern in `carriedOver` below is what makes
      // the character need it either way; the variation only makes the setting sharper.
      situationEn = `A short everyday situation where the learner has to say: ${askPhrase.askEn}`;
    }

    const carriedOver = [
      `The learner is practising this pattern: "${placementRescue.transferableChunk.patternEs}"`,
      `(${placementRescue.transferableChunk.communicativeFunction}).`,
      `They asked how to say "${askPhrase.askEn}" and have said it once, out of any situation.`,
      "This scene exists so they have to reach for it themselves. Never say the phrase or the pattern yourself.",
    ].join(" ");

    setPlacementSummary(carriedOver);
    beginSession();

    const started = await startSceneFor({
      scenarioEn: situationEn,
      who,
      carriedOver,
      // This scene already has a phrase in it: the one they asked about thirty seconds ago.
      recallEligible: false,
      rescue: placementRescue,
      previousConversationId: null,
      arrivalNote: null,
    });

    if (!started.ok) {
      setFlowPhase("ask");
      setPhraseStatus("done");
      setRoomNote(`${started.message} typing works too.`);
      setTurnState("ready");
    }
  }

  /**
   * A moment that already went wrong, described on /dash and handed over.
   *
   * There is no new engine here and deliberately so: `stung` is one of the room's original modes,
   * and everything downstream of the intake — the past-tense wording in five prompts, the scene
   * built from the rescue — already reads it. All that was missing was a door.
   *
   * `mode` and the coach's mode are set in the same breath for the reason `handleOpeningAttempt`
   * takes the mode explicitly: the state has not landed by the time the request goes out, and
   * getting it wrong is the tense bug in reverse.
   */
  async function runStungIntake(handoff: StungHandoff) {
    setMode("stung");
    setRoomNote(null);
    await handleOpeningAttempt(handoff.said, "stung", handoff.situationEn);
  }

  /**
   * One go at a planned event (#30).
   *
   * The FIRST go is the intake, seeded with what they said and which part of the evening this is.
   * It is the only thing in the app that produces a rescue, and every go after it starts its
   * scene from that same rescue -- which is what makes a four-session run-up possible at all
   * without four placements.
   */
  async function runEventBeat(event: StoredEvent, beatIndex: number) {
    const beat = event.beats.find((item) => item.index === beatIndex) ?? event.beats[0];
    if (!beat) return;

    activeEventRef.current = { event, beat };
    setMode("upcoming");
    setRoomNote(null);

    const rescue = (event.rescue ?? null) as RescueResponse | null;

    if (!rescue) {
      // Their own words first: the coach's prompt says the opening answer describes the event, and
      // a paraphrase of what somebody said is a worse description of their life than what they
      // said. The beat is appended so the intake starts in the right part of the evening.
      await handleOpeningAttempt(
        `${event.said} The part I need to practise: ${beat.titleEn}. ${beat.situationEn}`,
        "upcoming",
      );
      return;
    }

    /*
     * Deliberately NOT `placementSummary`. That string carries the whole transcript of the intake,
     * and dragging one evening's conversation into the next go at it is the same bug the aside had
     * -- the character reads the transcript, not the instruction, and answers the wrong scene.
     */
    const carriedOver = [
      `The learner is practising this pattern: "${rescue.transferableChunk.patternEs}"`,
      `(${rescue.transferableChunk.communicativeFunction}).`,
      event.focusBlocker && event.focusBlocker in blockerFocusLabels
        ? `What breaks for them: ${blockerFocusLabels[event.focusBlocker as BlockerType]}.`
        : "",
      `They are preparing for ${event.nameEn}, which has not happened yet.`,
      `This go is one part of it: ${beat.targetCommunicativeFunction}.`,
    ]
      .filter(Boolean)
      .join(" ");

    const character = {
      name: beat.characterName,
      relation: beat.characterRelation,
      traitEn: beat.characterTraitEn,
    };
    setSceneCharacter(character);
    setPlacementRescue(rescue);
    setPlacementSummary(carriedOver);
    beginSession();

    const started = await startSceneFor({
      scenarioEn: beat.situationEn,
      who: `${character.name}, ${character.relation} (${character.traitEn})`,
      carriedOver,
      // A run-up to a real dated evening. An unrelated phrase dropped into it is the same failure
      // as offering somebody a rotation topic beside their own dreaded call.
      recallEligible: false,
      rescue,
      previousConversationId: null,
      arrivalNote: `${beat.titleEn}. you are with ${character.name}.`,
    });

    if (!started.ok) {
      setFlowPhase("opening");
      setRoomNote(`${started.message} typing works too.`);
      setTurnState("ready");
    }
  }

  /**
   * The other way out of the scene: the room noticing before the learner asks.
   *
   * Counts replies that were HEARD but did not land -- not dead captures, which
   * `registerDudCapture` already owns and answers with hold-to-talk. The two must not share a
   * counter: "I keep missing you, noisy room?" and "that is not working, what is going on?" are
   * answers to different problems, and offering the wrong one is worse than offering neither.
   *
   * Once per session, and never stacked on top of the noisy-room offer.
   */
  /**
   * The intake's version of `noteAsideSignal`, and it has to work from much less: no evaluator has
   * run yet, so the only evidence that a learner is not producing what is being asked of them is
   * the suspicion router firing on a turn where Spanish was expected.
   *
   * Two in a row is not a bad turn, it is someone who cannot do this yet -- and the entire intake
   * is built on the premise that they can. That premise going unchallenged is how a beginner ends
   * up being asked for Spanish sentence after Spanish sentence, then handed a diagnosis about
   * which of eight blockers is theirs.
   *
   * Deliberately gated to the intake: once a session is running, `noteAsideSignal` owns this from
   * real verdicts, and two counters feeding one offer would fire it twice as fast as either meant.
   */
  function noteIntakeAsideSignal(brokeOnASpanishTurn: boolean) {
    if (flowPhaseRef.current !== "coach" || asideActiveRef.current || asideNudgeShownRef.current) return;

    if (!brokeOnASpanishTurn) {
      asideStrikesRef.current = 0;
      return;
    }

    asideStrikesRef.current += 1;
    vlog("aside", "intake strike", asideStrikesRef.current);
    if (asideStrikesRef.current < 2) return;

    asideNudgeShownRef.current = true;
    setAsideNudgeOpen(true);
  }

  function noteAsideSignal(evaluation: AttemptEvaluation | null, spokenFreeze: FreezeSignals | null) {
    if (asideActiveRef.current || asideNudgeShownRef.current) return;

    // Reaching for English mid-Spanish-turn is the same frustration in a different form, and it is
    // the signal closest to "I actually want to say something else right now".
    const reachedForEnglish = (spokenFreeze?.englishWordCount ?? 0) >= 4;

    // No verdict means /api/evaluate failed, not that the learner did. Counting an outage of ours
    // toward "this has stopped working for you" would put the offer in front of someone whose only
    // problem is our server -- and stepping out cannot fix that. Neither a strike nor a reset:
    // the run of turns is simply unmeasured.
    if (!evaluation) {
      if (!reachedForEnglish) return;
    } else if (
      (evaluation.meaningResult === "clear" || evaluation.meaningResult === "partial") &&
      !reachedForEnglish
    ) {
      asideStrikesRef.current = 0;
      // A landed turn also makes any offer still on screen stale -- it is answering a question the
      // learner has just stopped having.
      setAsideNudgeOpen(false);
      return;
    }

    asideStrikesRef.current += 1;
    vlog("aside", "strike", asideStrikesRef.current, "| meaning:", evaluation?.meaningResult ?? "none");
    if (asideStrikesRef.current < 2 || noisyOfferOpen) return;

    asideNudgeShownRef.current = true;
    setAsideNudgeOpen(true);
  }

  function startCorrectionRetry() {
    if (!activeCorrection.naturalVersion) {
      setRoomNote("OutLoud needs one correction first.");
      closeOverlay();
      return;
    }

    setCorrectionRetryResult(null);
    setRetryTarget({
      kind: "correction",
      phraseEs: activeCorrection.naturalVersion,
      phraseMeaningEn: "say the natural version once",
      attempts: 0,
    });
    closeOverlay();
    setCoachLine(activeCorrection.naturalVersion);
    showMeaning("say this back once, then we return to the conversation.", "instruction");
    setRoomNote(micModeRef.current === "open" ? "say it back whenever you're ready." : "tap the orb and say it back.");
    setTurn("ready");
    syncRealtimeMic();
  }

  function startPronunciationRetry() {
    const phraseEs = activePronunciationTarget?.word ?? activeCorrection.naturalVersion;
    if (!phraseEs) {
      setRoomNote("OutLoud needs a word or phrase first.");
      closeOverlay();
      return;
    }

    setPronunciationResult(null);
    setRetryTarget({
      kind: "pronunciation",
      phraseEs,
      phraseMeaningEn: placementRescue?.natural_version ?? "make this clear enough to understand",
      attempts: 0,
    });
    closeOverlay();
    setCoachLine(phraseEs);
    showMeaning("make it clear enough to understand.", "instruction");
    setRoomNote(micModeRef.current === "open" ? "say it once whenever you're ready." : "tap the orb and say it once.");
    setTurn("ready");
    syncRealtimeMic();
  }

  async function submitRetryAttempt(attempt: string, inputMode: "spoken" | "written", lowConfidence = false) {
    const target = retryTarget;
    if (!target) return;

    const nextAttempts = target.attempts + 1;

    try {
      if (target.kind === "pronunciation") {
        const result = await readJson<PronunciationCoaching>(
          await fetch("/api/pronunciation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phraseEs: target.phraseEs,
              phraseMeaningEn: target.phraseMeaningEn,
              attemptTranscript: attempt,
              freeze: lastVoiceFreeze ?? emptyFreezeSignals,
              context: defaultConversationContext,
            }),
          }),
        );

        setPronunciationResult(result);

        // #38 -- this used to end the attempt at `nextAttempts >= 2` whether the learner was
        // done or not, in an app whose entire premise is that people give up on speaking too
        // early. The count survives, but it now changes what is OFFERED, never what is allowed:
        // after a couple of tries the way out becomes visible instead of being taken for them.
        if (result.intelligible) {
          setRetryTarget(null);
          restoreCurrentTurn(`${result.coachingNoteEn} Back to the conversation.`);
          return;
        }

        setRetryTarget({ ...target, attempts: nextAttempts });
        setCoachLine(target.phraseEs);
        showMeaning(target.phraseMeaningEn, "instruction");
        setRoomNote(
          nextAttempts >= 2
            ? `${result.coachingNoteEn} Go again, or move on — this one keeps.`
            : `${result.coachingNoteEn} Try it one more time.`,
        );
        setTurnState("ready");
        return;
      }

      if (!placementRescue) {
        setRetryTarget(null);
        restoreCurrentTurn("Back to the conversation.");
        return;
      }

      const evaluation = await readJson<AttemptEvaluation>(
        await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originalText: target.phraseEs,
            scenarioContext: "Evaluate this as a say-it-back retry of the corrected Spanish only.",
            context: defaultConversationContext,
            rescue: placementRescue,
            attempt,
            inputMode,
            stage: "independent_rebuild",
            assistanceUsed: "repeat",
            conversationTurn: null,
            variation: null,
            lowConfidenceAttempt: lowConfidence,
          }),
        }),
      );

      setCorrectionRetryResult(evaluation);

      if (evaluation.meaningResult === "clear" || evaluation.correctedPrimaryIssue) {
        setRetryTarget(null);
        restoreCurrentTurn("Good. Back to the conversation.");
        return;
      }

      setRetryTarget({ ...target, attempts: nextAttempts });
      setCoachLine(target.phraseEs);
      showMeaning(target.phraseMeaningEn, "instruction");
      setRoomNote(evaluation.conciseFeedbackEn || "Try the natural version once more.");
      setTurnState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not check that yet.";
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  async function submitAskQuestion() {
    const question = askDraft.trim();
    if (!question || askStatus === "asking") return;

    setAskStatus("asking");
    setAskAnswer(null);

    const currentLine = currentConversationTurn
      ? {
          characterLineEs: currentConversationTurn.characterLineEs,
          characterMeaningEn: currentConversationTurn.characterMeaningEn,
          expectedCommunicativeFunction:
            currentConversationTurn.expectedCommunicativeFunction ?? "continue the conversation",
        }
      : currentPlacementPrompt
        ? {
            characterLineEs: currentPlacementPrompt.characterLineEs,
            characterMeaningEn: currentPlacementPrompt.characterMeaningEn,
            expectedCommunicativeFunction: currentPlacementPrompt.expectedCommunicativeFunction,
          }
        : null;

    try {
      const answer = await readJson<LifelineResponse>(
        await fetch("/api/lifeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: question,
            context: defaultConversationContext,
            currentLine,
            rescue: placementRescue ?? undefined,
          }),
        }),
      );
      setAskAnswer(answer);
      setAskStatus("answered");
    } catch {
      setAskStatus("error");
    }
  }

  /**
   * Counts what is already here, once, when there is somebody to say it to.
   *
   * Gated on being signed out and having a verdict: signed in there is nothing to claim, and
   * before the verdict there is no ask on screen to put the number in. Failure leaves it null,
   * which renders the older wording rather than a wrong count.
   */
  // The room is its own entry point -- plenty of people never see `/dash` at all -- so it starts
  // tracking itself rather than assuming the other screen already did.
  useEffect(() => {
    initTracking();
  }, []);

  useEffect(() => {
    if (authedEmail || !placementRescue || !clientSessionId || unclaimedRuns !== null) return;
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`/api/moments?sessionId=${encodeURIComponent(clientSessionId)}`);
        const json = await response.json();
        if (alive && response.ok && typeof json.count === "number") {
          setUnclaimedRuns(json.count);
          // Q5's denominator. The ask is on screen and this is what it can point at -- the same
          // number the copy uses, so a conversion rate can be read against what was actually said.
          track("account_ask_seen", { unclaimedRuns: json.count });
        }
      } catch {
        // Offline, or the route fell over. The ask keeps its older wording.
      }
    })();
    return () => {
      alive = false;
    };
  }, [authedEmail, placementRescue, clientSessionId, unclaimedRuns]);

  async function saveCurrentMoment(
    turnsOverride: SessionTurn[] = sessionTurns,
    currentTurnOverride: ConverseReply | null = currentConversationTurn,
    emailOverride?: string,
  ) {
    if (!placementRescue || !placementSummary || saveStatus === "saving") return savedMomentId;

    const momentId = savedMomentId ?? makeId();
    const sessionId = clientSessionId ?? makeId();
    const lastEvaluatedTurn = lastMatching(turnsOverride, (turn) => Boolean(turn.evaluation));
    const transferEvaluation = lastEvaluatedTurn?.evaluation ?? null;
    const ledgerState = derivePracticeLedgerState(primaryEvaluation, transferEvaluation);
    const replyForFocus = lastEvaluatedTurn ?? turnsOverride[turnsOverride.length - 1] ?? null;
    const primaryIssue = transferEvaluation ?? primaryEvaluation;
    const interventionOutcomes = [
      primaryEvaluation
        ? createInterventionOutcome({
            assistanceBefore: "none",
            assistanceAfter: primaryEvaluation.assistanceUsed,
            stage: "independent_rebuild",
            evaluation: primaryEvaluation,
          })
        : null,
      ...turnsOverride.flatMap((turn) =>
        turn.evaluation
          ? [
              createInterventionOutcome({
                assistanceBefore: "none",
                assistanceAfter: turn.evaluation.assistanceUsed,
                stage: "conversation_follow_up",
                evaluation: turn.evaluation,
              }),
            ]
          : [],
      ),
    ].filter(Boolean);
    const selfReportedBlocker = reportedBlocker ?? "not_sure";

    setSaveStatus("saving");
    setSavedMomentId(momentId);
    try {
      const response = await readJson<{
        ok: boolean;
        sessionId: string;
        momentId: string;
        reviewUrl: string | null;
      }>(
        await fetch("/api/moments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: momentId,
            sessionId,
            email: (emailOverride ?? returnEmail).trim(),
            originalText: placementSummary,
            entryMode: "wanted_to_say",
            context: {
              ...defaultConversationContext,
              who: conversationWho,
            },
            selfReportedBlocker,
            selfReportedBlockers: [selfReportedBlocker],
            // Was hardcoded null, so `teaching_policy_json` was empty for every moment ever
            // saved and nothing downstream could learn which help order this learner was given.
            teachingPolicy: chooseTeachingPolicy({
              selectedHypotheses: [selfReportedBlocker],
              rescue: placementRescue,
              // The client does not hold the learner's saved history; with none, the policy is
              // the base order for the blocker, which is exactly what the room just showed them.
              history: [],
            }),
            interventionOutcomes,
            personalTeachingModel: null,
            attempt: openingAnswer || placementAttempts[0]?.userAttempt || placementSummary,
            attemptTranscriptEdited: false,
            retry: transferEvaluation?.correctedAttemptEs ?? lastEvaluatedTurn?.userAttempt ?? placementRescue.natural_version,
            rebuildEvaluation: primaryEvaluation,
            transferPrompt: null,
            transferAttempt: lastEvaluatedTurn?.userAttempt ?? null,
            transferEvaluation,
            conversationTurns: turnsOverride.map((turn) => ({
              conversationId,
              turnIndex: turn.turnIndex,
              characterLineEs: turn.characterLineEs,
              characterMeaningEn: turn.characterMeaningEn,
              expectedCommunicativeFunction: turn.expectedCommunicativeFunction,
              suggestedReplyFrameEs: turn.suggestedReplyFrameEs,
              suggestedReplyEs: turn.suggestedReplyEs,
              responseGuidanceEn: turn.responseGuidanceEn,
              shouldClose: currentTurnOverride?.shouldClose ?? false,
              userAttempt: turn.userAttempt,
              userEvaluation: turn.evaluation,
            })),
            focusGap: primaryIssue
              ? {
                  source: replyForFocus ? "conversation" : "independent_rebuild",
                  turnIndex: replyForFocus?.turnIndex ?? null,
                  characterLineEs: replyForFocus?.characterLineEs ?? null,
                  characterMeaningEn: replyForFocus?.characterMeaningEn ?? null,
                  expectedCommunicativeFunction:
                    replyForFocus?.expectedCommunicativeFunction ??
                    placementRescue.transferableChunk.communicativeFunction,
                  userTranscript: replyForFocus?.userAttempt ?? openingAnswer,
                  gapType: primaryIssue.observedBlocker.type,
                  helpRequired: (primaryIssue.assistanceUsed ?? "none") as AssistanceUsed,
                  retryResult: primaryIssue.meaningResult,
                  evidence: primaryIssue.observedBlocker.evidence,
                  createdAt: new Date().toISOString(),
                }
              : null,
            attemptVoice: null,
            retryVoice: null,
            rescue: placementRescue,
            ledgerState,
            createdAt: new Date().toISOString(),
            deepLinkMomentId: null,
            // Which evening this run was a go at, so the library can say so and the event can
            // find its way back to the transcript.
            eventId: activeEventRef.current?.event.id ?? null,
          }),
        }),
      );
      setSavedMomentId(response.momentId);

      /*
       * The words go with the moment.
       *
       * `saveWordBank` had exactly one caller -- `saveReturnEmail` -- so a signed-in learner who
       * finished a session and did not type an address into the email box saved a moment and no
       * words at all. The production table says it plainly: 40 moments, 0 rows in `word_bank`.
       *
       * That is the other half of "the phrase never came back", and the bigger half. Scheduling
       * every saved phrase (2026-09-11) is worth nothing while nothing is ever saved.
       *
       * Idempotent, and it has to be: the upsert is keyed on (user_id, lower(spanish)), so the
       * repeat from `saveReturnEmail` costs a request and changes nothing. Signed out it returns
       * before touching the network, which is honest -- `word_bank.user_id` is not null.
       */
      void saveWordBank(response.momentId);

      // The go is done. Written back so the entry screen counts it, and so the run-up moves on to
      // the next part of the evening instead of offering the same one again.
      const activeEvent = activeEventRef.current;
      if (activeEvent && !activeEvent.beat.completedAt) {
        void patchEvent(activeEvent.event.id, {
          beat: {
            index: activeEvent.beat.index,
            momentId: response.momentId,
            completedAt: new Date().toISOString(),
          },
        }).then((updated) => {
          if (!updated || !activeEventRef.current) return;
          const beat = updated.beats.find((item) => item.index === activeEvent.beat.index);
          activeEventRef.current = { event: updated, beat: beat ?? activeEventRef.current.beat };
        });
      }
      setLastReviewUrl(response.reviewUrl);
      setSaveStatus("saved");
      return response.momentId;
    } catch {
      setSaveStatus("error");
      return null;
    }
  }

  /**
   * The phrases this session hands over. Shared with the closing panel on purpose: the card shows
   * what an account would keep, so it has to be the same list the account actually keeps.
   */
  function sessionWordList() {
    return [
      ...coachLoot.map((item) => ({ spanish: item.es, meaningEn: item.en, source: "coach_tool" as const })),
      ...(placementRescue
        ? [
            {
              spanish: placementRescue.important_phrase.spanish,
              meaningEn: placementRescue.important_phrase.meaning_en,
              source: "rescue_phrase" as const,
            },
            {
              spanish: placementRescue.transferableChunk.patternEs,
              meaningEn: placementRescue.transferableChunk.meaningEn,
              source: "rescue_pattern" as const,
            },
          ]
        : []),
    ].filter((word) => word.spanish.trim().length > 0);
  }

  // Words are the thing the account exists for, so they are pushed on every save.
  async function saveWordBank(momentId: string | null) {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const words = sessionWordList();
    if (!words.length) return;

    try {
      await fetch("/api/word-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ momentId, words }),
      });
    } catch {
      // The moment itself is already saved; the word bank can catch up on the next save.
    }
  }

  async function saveReturnEmail(emailOverride?: string) {
    const email = (emailOverride ?? returnEmail).trim();
    if (!email || !placementRescue) return;

    setReturnEmailStatus("saving");
    try {
      const momentId = await saveCurrentMoment(sessionTurns, currentConversationTurn, email);
      // Kept even though `saveCurrentMoment` now does this itself, for the case it cannot cover:
      // somebody who played the whole session signed out and creates the account at the verdict.
      // The moment was already saved by then, so that call returns early -- and the words, which
      // needed a token nobody had at the time, would never be written at all.
      await saveWordBank(momentId ?? null);
      await readJson<{ ok: boolean }>(
        await fetch("/api/retrieval-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            sessionId: clientSessionId,
            momentId,
            todayLine,
            tomorrowWork,
            evidence: latestSessionEvaluation?.observedBlocker.evidence ?? placementRescue.observed_blocker.evidence,
          }),
        }),
      );
      setReturnEmailStatus("saved");
    } catch {
      setReturnEmailStatus("error");
    }
  }

  async function submitFeedbackAnswer(skipped: boolean) {
    const selected =
      feedbackPick === null || !activeFeedback.options.length ? null : activeFeedback.options[feedbackPick] ?? null;
    const answers = feedbackAnswers.map((answer) =>
      answer.key === activeFeedback.key
        ? {
            ...answer,
            selected,
            text: feedbackText.trim(),
            skipped,
          }
        : answer,
    );

    setFeedbackAnswers(answers);
    setFeedbackPick(null);
    setFeedbackText("");

    const nextVisibleQuestions = visibleFeedbackQuestions(answers);
    const answersForPayload = nextVisibleQuestions
      .map((question) => answers.find((answer) => answer.key === question.key))
      .filter((answer): answer is FeedbackAnswer => Boolean(answer));

    if (feedbackStep < nextVisibleQuestions.length - 1) {
      setFeedbackStep((step) => step + 1);
      return;
    }

    setFeedbackSubmitting(true);
    try {
      await readJson<{ ok: boolean }>(
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "/",
            step: flowPhase,
            sessionId: conversationId,
            answers: answersForPayload,
            metadata: {
              placementAttempts: placementAttempts.length,
              sessionTurns: sessionTurns.length,
              hasVerdict: Boolean(placementRescue),
              device: typeof navigator === "undefined" ? null : navigator.userAgent,
              answers: Object.fromEntries(
                answersForPayload.map((answer) => [
                  answer.key,
                  answer.skipped ? "(skipped)" : answer.text || answer.selected || "(blank)",
                ]),
              ),
              answerDetails: answersForPayload.map((answer) => ({
                key: answer.key,
                screenId: answer.screenId,
                question: answer.question,
                answer: answer.skipped ? "(skipped)" : answer.text || answer.selected || "(blank)",
                timestamp: new Date().toISOString(),
              })),
            },
          }),
        }),
      );
      setFeedbackSaved(true);
    } catch {
      setFeedbackSaved(true);
    } finally {
      setFeedbackSubmitting(false);
      setFeedbackStep(feedbackQuestions.length);
    }
  }

  function openAuth(intent: "signup" | "signin") {
    // Q5. Opening the dialog is intent; finishing it is conversion. Keeping them apart is what
    // says whether the ask is unconvincing or the signup itself is where people give up.
    track("account_dialog_opened", { mode: intent });
    setAuthIntent(intent);
    setAuthOpen(true);
  }

  /**
   * Everything, written down, immediately before the page goes away.
   *
   * The guard used to be `if (!placementRescue) return` -- so the half of the session before the
   * verdict, which is the half somebody is most likely to be in when they decide to sign up, was
   * never written at all. Now the only thing that stops it is having nothing to write.
   */
  function stashRoom(journey: SnapshotJourney) {
    if (!roomHasUnsavedWork) return;
    /*
     * On the landing screen there is nothing on screen to come back to, whatever is still in state.
     *
     * This matters because the exit button does NOT clear `openingAnswer` or `placementRescue` --
     * so after somebody says "I'm done", `roomHasUnsavedWork` is still true, and without this the
     * `pagehide` below would write a snapshot of a room they had just closed and hand it straight
     * back on the next load.
     *
     * The same argument almost certainly holds for the `auth` journey. It is left alone because
     * that path is covered by a check that passes today, and widening a guard is not what this
     * change is for.
     */
    if (journey === "return" && mode === "landing") return;
    const snapshot: RoomSnapshot = {
      v: 2,
      savedAt: new Date().toISOString(),
      mode,
      flowPhase,
      conversationId,
      turnIndex,
      openingAnswer,
      placementSummary,
      placementAttempts,
      placementEvaluations,
      placementRescue,
      coachId,
      coachTurn,
      coachLoot,
      coachEvidence,
      reportedBlocker,
      sceneCharacter,
      sessionTurns,
      currentConversationTurn,
      coachLine,
      coachMeaning,
      coachMeaningKind,
      sessionCallout,
      savedMomentId,
      sessionClosedAt,
      askPhrase,
      toneMode,
    };
    try {
      snapshotStore(journey).setItem(snapshotKey(journey), JSON.stringify(snapshot));
    } catch {
      /*
       * Storage blocked, or the snapshot is bigger than the quota. OAuth still works and the
       * learner still gets their account; what they lose is the run, which is what happened every
       * time before this existed.
       *
       * Deliberately silent. An error about our storage, raised at the moment somebody has just
       * decided to trust us with an account, is the worst possible time to talk about our problems.
       */
    }
  }

  /**
   * Put them back where they were.
   *
   * Does nothing unless a snapshot is waiting. The refusals inside it are as important as the
   * restore itself -- never over a live room, and never a stale one -- and every one of them throws
   * the snapshot away rather than leaving it for later. See below.
   *
   * `email` is the address that just signed in, and **null when nobody did**. Two things hang off
   * it and must not happen on a plain return: filling the return box, and the auto-save, which
   * writes the moment AND posts a summary. Somebody who glanced at their account has not asked for
   * either.
   */
  function restoreRoom(journey: SnapshotJourney, email: string | null) {
    const key = snapshotKey(journey);
    let raw: string | null = null;
    try {
      raw = snapshotStore(journey).getItem(key);
    } catch {
      return;
    }
    if (!raw) return;

    /*
     * Read AND cleared before any of the refusals below, deliberately.
     *
     * A snapshot is one shot. If a refusal left it in place it would sit there waiting for the
     * next sign-in or reload, and the case where that happens is precisely the case where we have
     * just decided the learner does not want it -- so it would come back at an even worse moment,
     * with even less to do with what they were doing.
     */
    try {
      snapshotStore(journey).removeItem(key);
    } catch {
      // Removal failing is harmless; parsing below still guards the shape.
    }

    /*
     * Never over a live room. After an OAuth redirect the page has just reloaded and there is
     * nothing to overwrite -- but signing in with a password does NOT reload, so without this an
     * abandoned snapshot would replace the conversation somebody is having right now.
     *
     * **On the `return` journey this guard does nothing**, because it runs at mount and the room is
     * empty at mount by definition. That is exactly why that journey's safety had to come from
     * somewhere else -- see `SnapshotJourney`.
     */
    if (roomHasUnsavedWork) return;

    try {
      const snapshot = JSON.parse(raw) as Partial<RoomSnapshot>;

      // Never a stale one: the same worry, in slow motion.
      const savedAtMs = snapshot.savedAt ? new Date(snapshot.savedAt).getTime() : NaN;
      if (Number.isFinite(savedAtMs) && Date.now() - savedAtMs > pendingRoomTtlMs) return;

      // Something has to be here, or this is a snapshot of an empty room and restoring it would
      // drag somebody off the landing screen into nothing.
      const worthRestoring =
        Boolean(snapshot.openingAnswer?.trim()) ||
        Boolean(snapshot.placementRescue) ||
        Boolean(snapshot.sessionTurns?.length);
      if (!worthRestoring) return;

      // Where they were. A v1 snapshot has neither, and lands on the verdict card exactly as it
      // used to -- which is right, because that is the only place a v1 snapshot was ever written.
      setMode(snapshot.mode ?? "speaks-first");
      setFlowPhase(snapshot.flowPhase ?? "verdict");
      setConversationId(snapshot.conversationId ?? null);
      setTurnIndex(snapshot.turnIndex ?? 0);

      // The intake and what it concluded.
      setOpeningAnswer(snapshot.openingAnswer ?? "");
      setPlacementSummary(snapshot.placementSummary ?? "");
      setPlacementAttempts(snapshot.placementAttempts ?? []);
      setPlacementEvaluations(snapshot.placementEvaluations ?? []);
      setPlacementRescue(snapshot.placementRescue ?? null);
      setCoachId(snapshot.coachId ?? null);
      setCoachTurn(snapshot.coachTurn ?? null);
      setCoachLoot(snapshot.coachLoot ?? []);
      setCoachEvidence(snapshot.coachEvidence ?? []);
      // Older snapshots (written before the coach classified this) have no field; "not_sure"
      // would assert a hypothesis the learner never gave, so an absent value stays null.
      setReportedBlocker(snapshot.reportedBlocker ?? null);

      // The conversation.
      setSceneCharacter(snapshot.sceneCharacter ?? null);
      setSessionTurns(snapshot.sessionTurns ?? []);
      setCurrentConversationTurn(snapshot.currentConversationTurn ?? null);
      setCoachLine(snapshot.coachLine ?? null);
      showMeaning(snapshot.coachMeaning ?? null, snapshot.coachMeaningKind ?? null, { folded: true });
      setSessionCallout(snapshot.sessionCallout ?? null);
      setAskPhrase(snapshot.askPhrase ?? null);
      setToneMode(snapshot.toneMode ?? "real");

      // What was already banked. Without `savedMomentId` the next save writes a SECOND moment for
      // the same conversation, and the library grows a duplicate nobody can tell apart.
      setSavedMomentId(snapshot.savedMomentId ?? null);
      setSessionClosedAt(snapshot.sessionClosedAt ?? null);

      // Their turn, whatever they were doing. The mic and the realtime channel came up fresh with
      // the page, and `speaking` would leave the orb waiting for a line nobody is going to say.
      setTurnState("ready");

      /*
       * Only on the way back from somewhere they chose to go. After signing in the account card is
       * already the explanation, and a second line under it would be the app narrating itself.
       * Coming back from the account screen, or from a reload, there is nothing else on the page
       * that says why the conversation is suddenly here again -- and the same sentence already
       * does this job when a saved moment is picked up.
       */
      if (journey === "return") setRoomNote("picking this back up.");

      // The card is a card, so it needs its overlay back. Anywhere else in the room, an overlay
      // would be a sheet dropped on top of a conversation they did not ask to interrupt.
      const landedOn = snapshot.flowPhase ?? "verdict";
      setOverlay(landedOn === "verdict" ? "verdict" : null);

      if (email) setReturnEmail(email);

      /*
       * The auto-save is only for a run that is OVER, and only when somebody has just signed in.
       *
       * `saveReturnEmail` writes the moment, the words, and a retrieval email. Mid-conversation
       * that would file a half-finished run and post somebody a summary of a session they are
       * still sitting in. At the verdict and after it, it is exactly what signing up is for -- and
       * on a plain return nobody has asked for any of it.
       */
      const finished = Boolean(snapshot.placementRescue) && (landedOn === "verdict" || Boolean(snapshot.sessionClosedAt));
      if (email && finished) setPendingAutoSaveEmail(email);
    } catch {
      // Corrupt snapshot: nothing to restore.
    }
  }

  function signOut() {
    void getSupabaseBrowser()?.auth.signOut();
  }

  // Rebind after every render so channel events always see current state (see the ref comment).
  useEffect(() => {
    handleRealtimeEventRef.current = handleRealtimeEvent;
    restoreRoomRef.current = restoreRoom;
    stashRoomRef.current = stashRoom;
  });

  // One subscription for the life of the room, dispatching through the ref above.
  useEffect(() => voice.onEvent((event) => handleRealtimeEventRef.current(event)), []);

  /*
   * What this learner asked for and never produced, fetched once on arrival.
   *
   * Deliberately not per scene: a scene start is already several requests deep and nothing here is
   * allowed to make it feel slower. Signed out it returns nothing and the whole half stays off.
   */
  useEffect(() => {
    void loadDuePhrases();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on arrival
  }, []);

  /**
   * The room, written down on the way out — however they left.
   *
   * The account pill stashes in its own `onClick`, because a client-side navigation unmounts the
   * component without ever unloading the document, so nothing fires here. This covers everything
   * that DOES unload it: a reload, the back button out of the app, a tab closing, a crash. Until
   * now none of those were covered at all — a run is not written to the database until it closes,
   * so a reload at turn four threw the whole thing away.
   *
   * `pagehide` rather than `beforeunload`: mobile Safari does not fire `beforeunload` reliably, and
   * some browsers read it as a reason to put a "leave site?" dialog in front of somebody.
   *
   * A closing tab fires this too, and that is exactly why the snapshot lives in `sessionStorage` --
   * the write happens, and then the tab takes it with it.
   */
  useEffect(() => {
    const onHide = () => stashRoomRef.current("return");
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  /**
   * The room they put down on purpose, picked back up.
   *
   * **Declared first, which in this ladder means last in precedence.** Every reader below clears
   * its own key as it reads it, so a key can only be checked by an effect that runs BEFORE its
   * reader. Anything naming a particular conversation to start outranks coming back to the one you
   * left, so this has to look at all five while they are still there.
   *
   * It clears its own key even when it yields, for the reason `restoreRoom` clears before its
   * refusals: a snapshot left lying around comes back at a worse moment than the one it missed.
   */
  useEffect(() => {
    let waiting = false;
    try {
      waiting =
        Boolean(window.sessionStorage.getItem(leftRoomKey)) &&
        !window.sessionStorage.getItem(resumeMomentKey) &&
        !window.sessionStorage.getItem(eventBeatKey) &&
        !window.sessionStorage.getItem(askPhraseKey) &&
        !window.sessionStorage.getItem(stungKey) &&
        !window.sessionStorage.getItem(autoStartKey);
      if (!waiting) window.sessionStorage.removeItem(leftRoomKey);
    } catch {
      return;
    }
    if (!waiting) return;
    // Deferred like every other reader here: a synchronous setState in an effect body is a
    // cascading render, and the ref binding above has to have run first.
    const timer = window.setTimeout(() => restoreRoomRef.current("return", null), 0);
    return () => window.clearTimeout(timer);
  }, []);

  /**
   * One go at a planned event, handed over from /dash. Only the ids travel; the event itself is
   * loaded here, because running the beat needs the rescue and the character too and a copy of
   * all that in sessionStorage would be a second source of truth for something the learner is in
   * the middle of.
   *
   * Sits between the two effects around it in specificity: resuming a named conversation beats
   * it, and it beats a bare "start talking".
   */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(eventBeatKey);
      if (raw) window.sessionStorage.removeItem(eventBeatKey);
      if (window.sessionStorage.getItem(resumeMomentKey)) raw = null;
    } catch {
      return;
    }
    if (!raw) return;

    let cancelled = false;
    void (async () => {
      let handoff: EventBeatHandoff;
      try {
        handoff = JSON.parse(raw) as EventBeatHandoff;
      } catch {
        return;
      }
      const event = await loadEvent(handoff.eventId);
      if (cancelled) return;
      if (!event) {
        // The plan is gone, or unreachable. The landing panel is the honest screen for that --
        // silently starting the default intake is the failure this whole entry path exists to
        // prevent.
        setRoomNote("I couldn't find that one. we can start fresh instead.");
        return;
      }
      await runEventBeatRef.current(event, handoff.beatIndex);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A phrase question, handed over from /dash. Same ladder as the effects around it: anything
   * that points at a particular conversation or a particular go beats a question about words.
   */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(askPhraseKey);
      if (raw) window.sessionStorage.removeItem(askPhraseKey);
      if (window.sessionStorage.getItem(resumeMomentKey)) raw = null;
      if (window.sessionStorage.getItem(eventBeatKey)) raw = null;
    } catch {
      return;
    }
    if (!raw) return;
    let handoff: AskPhraseHandoff;
    try {
      handoff = JSON.parse(raw) as AskPhraseHandoff;
    } catch {
      return;
    }
    if (!handoff?.askEn?.trim()) return;
    const timer = window.setTimeout(() => void runAskPhraseRef.current(handoff), 0);
    return () => window.clearTimeout(timer);
  }, []);

  /**
   * A moment that already went wrong, handed over from /dash as the learner's own sentence.
   *
   * Same specificity ladder as the effect above: a named conversation and a named go at a planned
   * event both beat this, because both point at something particular and this only describes one.
   * /dash writes exactly one of these keys per departure, so the cross-checks here and below are
   * belt-and-braces rather than load-bearing — and note that each effect clears its own key as
   * it reads it, so a later effect can only see a key an earlier one did not reach.
   */
  useEffect(() => {
    let said: string | null = null;
    try {
      said = window.sessionStorage.getItem(stungKey);
      if (said) window.sessionStorage.removeItem(stungKey);
      if (window.sessionStorage.getItem(resumeMomentKey)) said = null;
      if (window.sessionStorage.getItem(eventBeatKey)) said = null;
      if (window.sessionStorage.getItem(askPhraseKey)) said = null;
    } catch {
      return;
    }
    if (!said) return;
    let handoff: StungHandoff;
    try {
      handoff = JSON.parse(said) as StungHandoff;
    } catch {
      return;
    }
    if (!handoff?.said?.trim()) return;
    // Deferred for the same reason as the two below: no synchronous setState in an effect body,
    // and the rebind effect above has filled the ref by the time this fires.
    const timer = window.setTimeout(() => void runStungIntakeRef.current(handoff), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // /dash hands off a plain "start talking" the same way, minus a rescue to restore. Runs before
  // the resume effect below and defers to it: if both keys are somehow set, picking a specific
  // conversation back up is the more specific intent.
  useEffect(() => {
    let wants = false;
    try {
      wants = window.sessionStorage.getItem(autoStartKey) === "1";
      if (wants) window.sessionStorage.removeItem(autoStartKey);
      if (window.sessionStorage.getItem(resumeMomentKey)) wants = false;
      if (window.sessionStorage.getItem(eventBeatKey)) wants = false;
      if (window.sessionStorage.getItem(stungKey)) wants = false;
      if (window.sessionStorage.getItem(askPhraseKey)) wants = false;
    } catch {
      return;
    }
    if (!wants) return;
    // Deferred: no synchronous setState inside an effect body, and the rebind effect above has
    // filled the ref by the time this fires.
    const timer = window.setTimeout(() => enterRoomRef.current("speaks-first"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // The dashboard's "continue" writes a saved rescue into sessionStorage and navigates here.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(resumeMomentKey);
      if (raw) window.sessionStorage.removeItem(resumeMomentKey);
    } catch {
      return;
    }
    if (!raw) return;
    const payload = raw;
    // Deferred for the same reason as the fold timer: no synchronous setState inside an effect.
    const timer = window.setTimeout(() => {
    try {
      const resume = JSON.parse(payload) as ResumeMoment;
      if (!resume.rescue) return;
      setMode("speaks-first");
      setPlacementRescue(resume.rescue as RescueResponse);
      setPlacementSummary(resume.summary);
      setPlacementAttempts([]);
      setPlacementEvaluations([]);
      setSavedMomentId(resume.momentId);
      setCoachLine("picking this back up.");
      showMeaning(null, null);
      setFlowPhase("verdict");
      setTurnState("ready");
      setOverlay("verdict");
    } catch {
      // Corrupt hand-off: start the room normally.
    }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setAuthedEmail(data.session?.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? null;
      setAuthedEmail(email);
      // A no-op unless a snapshot is waiting, the room is empty, and the snapshot is fresh.
      if (email) restoreRoomRef.current("auth", email);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // After an OAuth return, save the words once the restored rescue state has landed.
  useEffect(() => {
    if (!pendingAutoSaveEmail || !placementRescue) return;
    const timer = window.setTimeout(() => {
      void saveReturnEmail(pendingAutoSaveEmail);
      setPendingAutoSaveEmail(null);
    }, 0);
    return () => window.clearTimeout(timer);
    // saveReturnEmail is recreated per render; the timer calls a recent-enough closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSaveEmail, placementRescue]);

  useEffect(() => {
    turnStateRef.current = turnState;
  }, [turnState]);

  useEffect(() => {
    flowPhaseRef.current = flowPhase;
    coachPhaseRef.current = coachTurn?.phase ?? null;
  }, [flowPhase, coachTurn]);

  // Pressure mode shortens how long a pause can run before the turn ends. That value used to be
  // frozen into the token at mint time, so switching tone mid-session changed nothing; pushing it
  // over the open channel is what actually makes the toggle real.
  useEffect(() => {
    if (voice.capturing) applyVadProfile("capture");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the tone change should re-send.
  }, [pressureMode]);

  // Fold the coach line a beat after the coach stops talking, so the learner gets a moment to
  // finish reading before the room quiets down around the orb and the tools.
  useEffect(() => {
    if (foldTimerRef.current) {
      window.clearTimeout(foldTimerRef.current);
      foldTimerRef.current = null;
    }
    // Both directions run through a timer: unfolding immediately in the effect body would be a
    // synchronous setState during render commit (lint: cascading renders).
    const fold = turnState !== "speaking" && turnState !== "thinking";
    foldTimerRef.current = window.setTimeout(() => setCoachLineFolded(fold), fold ? 1800 : 0);
    return () => {
      if (foldTimerRef.current) {
        window.clearTimeout(foldTimerRef.current);
        foldTimerRef.current = null;
      }
    };
  }, [turnState, coachLine]);

  useEffect(() => {
    overlayRef.current = overlay;
    typedFallbackOpenRef.current = typedFallbackOpen;
    // Opening a card or the typing sheet while the mic is open ends the listen quietly.
    const endedALiveCapture = Boolean((overlay || typedFallbackOpen) && voice.capturing);
    if (endedALiveCapture) {
      voice.abortCapture();
      holdingRef.current = false;
      turnStateRef.current = "ready";
    }
    // Re-derived rather than force-closed: an overlay closing in open mode should re-arm the mic.
    syncRealtimeMic();
    if (!endedALiveCapture) return;
    // Deferred: a synchronous setState in an effect body is a cascading render. The ref above is
    // the copy the mic derivation reads, and it is already correct -- this only catches the UI up.
    const timer = window.setTimeout(() => setTurnState("ready"), 0);
    return () => window.clearTimeout(timer);
    // syncRealtimeMic reads refs only; re-creating this effect for it would just churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, typedFallbackOpen]);

  // Keep the mic in step with the turn and the chosen mode. Refs the derivation also reads (an
  // active capture, a playing static clip) are not reactive, so the imperative syncRealtimeMic()
  // calls at those transitions stay necessary -- this only covers the render-visible inputs.
  useEffect(() => {
    micModeRef.current = micMode;
    if (typeof window !== "undefined") window.localStorage.setItem("outloud-mic-mode", micMode);
    syncRealtimeMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs; deps would only churn.
  }, [turnState, micMode]);

  useEffect(() => {
    const store = window as unknown as {
      __outloudVoiceLog?: string[];
      __outloudVoiceDebug?: (on?: boolean) => string;
      __outloudVoiceDump?: () => string;
    };
    try {
      voice.debug = window.localStorage.getItem("outloud-debug-realtime") === "1";
    } catch {
      // Storage blocked: tracing simply stays off.
    }
    // Toggling without a reload, and a dump that does not depend on the console being open or
    // unfiltered when the events happened.
    store.__outloudVoiceDebug = (on = true) => {
      voice.debug = on;
      try {
        window.localStorage.setItem("outloud-debug-realtime", on ? "1" : "0");
      } catch {
        // Non-fatal: tracing still works for this page load.
      }
      return `voice tracing ${on ? "ON" : "off"}`;
    };
    store.__outloudVoiceDump = () => (store.__outloudVoiceLog ?? []).join(String.fromCharCode(10)) || "(nothing recorded)";
    if (voice.debug) {
      console.log("%c[voice] tracing ON — run __outloudVoiceDump() to copy the log", "color:#c1440e");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.outloudHydrated = "true";

    return () => {
      delete document.documentElement.dataset.outloudHydrated;
    };
  }, []);

  /**
   * The room holds the shared voice session while it is mounted, and lets go on unmount.
   *
   * `release` is deliberately not `disconnect`: leaving the entry screen unmounts it a moment
   * before the room mounts, and tearing the connection down in that gap would cost a second
   * microphone prompt and a second token mint for one continuous act. The session waits out the
   * gap and only really closes if nobody comes back.
   */
  useEffect(() => {
    voice.acquire();
    return () => {
      voice.release();
    };
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      stopMediaStream();
      stopStaticAudio(false);
      resetRealtimeSpeaking();
    },
    // Run once on unmount; cleanup reads refs, not render-time values.
    [],
  );

  useEffect(() => {
    if (!overlay) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverlay(null);
        setFeedbackStep(0);
        setFeedbackPick(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay]);


  function enterRoom(nextMode: RoomMode) {
    clearTimers();
    stopStaticAudio(false);
    resetRealtimeSpeaking();
    holdingRef.current = false;
    pressingRef.current = false;
    pressSessionRef.current += 1;
    setMode(nextMode);
    setOverlay(null);
    setTypedFallbackOpen(false);
    setTypedAttempt("");
    setTranscriptNeedsConfirm(false);
    setRoomNote(null);
    setLastTranscript(null);
    setFlowPhase("opening");
    setOpeningAnswer("");
    setAskPhrase(null);
    setPhraseAnswer(null);
    setPhraseStatus("asking");
    // Not the loaded list -- only what THIS scene was carrying. A phrase already counted as
    // resurfaced must not be counted again by the next scene in the same visit.
    activePhraseRef.current = null;
    landedPhraseRef.current = null;
    setCoachId(null);
    setCoachTurn(null);
    setCoachLoot([]);
    setCoachEvidence([]);
    setReportedBlocker(null);
    setEmailFallbackOpen(false);
    setPlacementAttempts([]);
    setPlacementRescue(null);
    setPlacementEvaluations([]);
    setPlacementSummary("");
    setCurrentConversationTurn(null);
    setSessionTurns([]);
    setSessionCallout(null);
    unaidedRunRef.current = 0;
    calloutSpokenRef.current = false;
    turnAssistanceRef.current = "none";
    turnSubtitleRef.current = false;
    setReturnEmail("");
    setReturnEmailStatus("idle");
    setFeedbackAnswers(blankFeedbackAnswers());
    setFeedbackSaved(false);
    setAskStatus("idle");
    setAskAnswer(null);
    setRetryTarget(null);
    setCorrectionRetryResult(null);
    setPronunciationResult(null);
    setLastVoiceFreeze(null);
    setLastTranscriptionConfidence(null);
    setProfileEvidenceIndex(0);
    setSavedMomentId(null);
    setSessionClosedAt(null);
    setSaveStatus("idle");
    setLastReviewUrl(null);
    setCoachLine(nextMode === "stung" ? null : openingPrompt);
    showMeaning(null, null, { folded: false });
    stopMediaStream();

    if (nextMode === "stung") {
      setTurnState("ready");
      return;
    }

    setTurnState("speaking");
    void speakCoachText(openingPrompt, "intake", 1500);
  }

  // Bound here rather than in the rebind effect near the top, which is declared above `enterRoom`
  // and so cannot reference it. Effects run in declaration order and the hand-off's timeout fires
  // after all of them, so the ref is filled by the time it is read.
  useEffect(() => {
    enterRoomRef.current = enterRoom;
    runEventBeatRef.current = runEventBeat;
    runStungIntakeRef.current = runStungIntake;
    runAskPhraseRef.current = runAskPhrase;
  });

  async function startHolding() {
    const currentTurnState = turnStateRef.current;

    if (
      isLanding ||
      overlay ||
      typedFallbackOpen ||
      currentTurnState === "thinking" ||
      currentTurnState === "speaking" ||
      currentTurnState === "listening" ||
      currentTurnState === "still-listening"
    ) {
      vlog(
        "hold",
        "BLOCKED — landing:", isLanding,
        "overlay:", overlay,
        "typed:", typedFallbackOpen,
        "state:", currentTurnState,
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      vlog("hold", "BLOCKED: getUserMedia unavailable in this browser/context");
      setRoomNote("voice is not available here. typing works too.");
      setTypedFallbackOpen(true);
      return;
    }

    const pressSession = pressSessionRef.current + 1;
    pressSessionRef.current = pressSession;
    pressingRef.current = true;

    try {
      clearTimers();
      setRoomNote(null);
      setLastTranscript(null);

      vlog("hold", "starting, press session:", pressSession);
      if (await startRealtimeListening(pressSession)) {
        return;
      }

      if (typeof MediaRecorder === "undefined") {
        setRoomNote("voice is not available here. typing works too.");
        setTypedFallbackOpen(true);
        setTurnState("ready");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia(micConstraints);

      // A newer press superseded this one while the mic permission was pending.
      if (pressSessionRef.current !== pressSession || holdingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = mediaRecorderTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      recordingStartedAtRef.current = nowMs();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const durationMs = Math.max(0, Math.round(nowMs() - recordingStartedAtRef.current));
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        mediaRecorderRef.current = null;
        stopMediaStream();
        void submitAudioAttempt(blob, durationMs);
      };

      holdingRef.current = true;
      recorder.start();
      setTurnState("listening");

      later(() => {
        setTurnState((current) => (current === "listening" ? "still-listening" : current));
      }, 2200);
    } catch {
      holdingRef.current = false;
      pressingRef.current = false;
      stopMediaStream();
      setRoomNote("voice needs permission. typing works too.");
      setTypedFallbackOpen(true);
      setTurnState("ready");
    }
  }

  function stopHolding() {
    pressingRef.current = false;

    if (!holdingRef.current) {
      vlog("hold", "stop IGNORED: not holding");
      return;
    }
    vlog("hold", "stopping | realtime capture:", voice.capturing, "| recorder:", mediaRecorderRef.current?.state ?? "none");

    clearTimers();
    holdingRef.current = false;
    setTurnState("thinking");

    if (voice.capturing) {
      void finishRealtimeListening(true);
      return;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }

    setTurnState("ready");
  }

  // Orb gestures:
  //   tap while the coach speaks  -> interrupt and start listening
  //   tap while ready             -> start listening (VAD or a second tap ends the turn)
  //   tap while listening         -> end the turn now
  //   hold while ready + release  -> classic push-to-talk
  function handleOrbPress() {
    pressStartedAtRef.current = nowMs();
    const state = turnStateRef.current;
    vlog("orb", "press, state:", state);

    if (state === "speaking") {
      pressKindRef.current = "interrupt";
      interruptSpeaking();
      return;
    }

    if (state === "listening" || state === "still-listening") {
      pressKindRef.current = "finish";
      return;
    }

    if (state === "ready") {
      pressKindRef.current = "start";
      void startHolding();
      return;
    }

    vlog("orb", "press IGNORED in state:", state);
    pressKindRef.current = null;
  }

  function handleOrbRelease() {
    const kind = pressKindRef.current;
    vlog("orb", "release, kind:", kind, "| held:", Math.round(nowMs() - pressStartedAtRef.current), "ms");
    pressKindRef.current = null;
    pressingRef.current = false;

    if (kind === "finish") {
      stopHolding();
      return;
    }

    if (kind === "start" && nowMs() - pressStartedAtRef.current >= holdToTalkThresholdMs) {
      stopHolding();
    }
  }

  async function submitAudioAttempt(blob: Blob, durationMs: number) {
    vlog("recorder", "submitting blob:", blob.size, "bytes,", Math.round(durationMs), "ms");
    if (blob.size === 0) {
      setRoomNote("nothing came through. typing works too.");
      setTurnState("ready");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("audio", blob, "outloud-attempt.webm");
      formData.append(
        "metrics",
        JSON.stringify({ firstSpeechMs: null, hesitationCount: 0, durationMs }),
      );
      const voiceAttempt = await readJson<{
        transcript: string;
        freeze: FreezeSignals;
        transcriptionConfidence: TranscriptionConfidenceTier;
      }>(await fetch("/api/transcribe", { method: "POST", body: formData }));
      const transcript = voiceAttempt.transcript.trim();
      if (!transcript) {
        throw new Error("nothing came through.");
      }
      if (voiceAttempt.transcriptionConfidence === "unreliable") {
        setRoomNote("that didn't come through clearly. try again, or type.");
        setTurnState("ready");
        return;
      }
      setLastTranscript(transcript);
      setLastVoiceFreeze(voiceAttempt.freeze);
      setLastTranscriptionConfidence(voiceAttempt.transcriptionConfidence);
      routeCapturedTranscript(transcript, voiceAttempt.transcriptionConfidence === "borderline");
    } catch (error) {
      const message = error instanceof Error ? error.message : "voice did not come through.";
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  // Opens the typed-fallback box pre-filled with a just-captured spoken transcript so the user
  // can catch a bad transcription before it's judged, instead of it being scored as-is. lowConfidence
  // carries the capture's confidence tier through to /api/evaluate even if they send without editing.
  function requestTranscriptConfirmation(transcript: string, lowConfidence: boolean) {
    clearTimers();
    setTypedAttempt(transcript);
    setTranscriptNeedsConfirm(true);
    setPendingAttemptConfidence(lowConfidence);
    setTypedFallbackOpen(true);
    setTurnState("ready");
  }

  /**
   * Somebody in the middle of a scene who says, in English, that they do not know how to say it
   * has not produced a bad transcript and has not produced a Spanish attempt. They have asked for
   * the coach.
   *
   * Without this the sentence goes to `looksBrokenAttempt` -- which keys on English filler words
   * as evidence that English leaked into Spanish, so a clear English sentence trips it every time
   * -- and the learner is shown "here's what I heard. fix anything that's wrong, then send." The
   * transcription was perfect. Telling somebody who just asked for help that the problem is their
   * pronunciation is worse than saying nothing, and it repeats for as long as they keep asking.
   *
   * The way out already exists and is already built: the aside is a room mode, the mic stays
   * open, `/api/aside` carries the scene snapshot, and leaving it puts them back where they were.
   * It was only ever reachable by pressing a chip. Now the asking reaches it, which is the point:
   * a partner who becomes a coach the moment you ask is the thing this app is supposed to be.
   */
  function stuckAskShouldStepOut(text: string) {
    if (asideActiveRef.current || !canStepOut) return false;
    // Not during the intake. English is the expected answer there, and /api/coach already answers
    // a stuck admission by handing over the words -- stepping out would replace working help with
    // a detour.
    if (expectsEnglishAnswerNow()) return false;
    return needsWordsEn(text);
  }

  /**
   * Decides whether a captured transcript needs the confirm step or can go straight to scoring.
   * Confirming EVERY spoken turn is the wrong trade once the mic is open -- it re-adds exactly the
   * tap that full-duplex removes -- so the box is reserved for transcripts that look wrong.
   *
   * The language branch matters: looksBrokenAttempt keys on English filler words ("the", "you",
   * "want"...) as evidence that English leaked into Spanish. On the turns that are SUPPOSED to be
   * answered in English -- the opening question and the coach's framing/scenario turns -- that same
   * check fires on nearly every honest answer, so it must not be used there.
   */
  function routeCapturedTranscript(transcript: string, lowConfidence: boolean) {
    const expectsEnglishAnswer = expectsEnglishAnswerNow();
    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    const suspicious = expectsEnglishAnswer
      ? lowConfidence || transcript.includes("...") || wordCount <= 1
      : lowConfidence || looksBrokenAttempt(transcript) || transcript.trim().length < 3;

    // Asked for, not mis-heard. Checked before `suspicious` is acted on, because this sentence
    // trips every one of those checks and the confirm box is the wrong answer to all of them.
    if (stuckAskShouldStepOut(transcript)) {
      void enterAside("stuck", transcript);
      return;
    }

    /*
     * Classified before anything is called suspicious, and with the SAME function the realtime
     * path uses -- these two capture routes kept disagreeing about what counts as an answer.
     *
     * The confirm box means "I heard words and they might be wrong, check them". A capture of
     * "ah..." is not that. The transcription was perfect; there was nothing in it. Showing that
     * screen tells somebody who was still thinking that the microphone misheard them, which is
     * both untrue and the opposite of the reassurance the moment needs.
     *
     * `speechSeen` is true here because this path only runs on audio that was actually recorded;
     * the no-speech verdict belongs to the realtime path, where VAD can report silence.
     */
    const captureVerdict = classifyCapture(transcript, true);

    if (captureVerdict === "filler" || captureVerdict === "empty") {
      patientCaptureRef.current = true;
      setRoomNote("take your time.");
      setTurnState("ready");
      return;
    }

    if (captureVerdict === "decode-loop") {
      // A decoder stuck in a loop, not a learner. It reads as well-formed, so nothing downstream
      // would have caught it -- and a clipped recording is what usually produces it, so the next
      // capture gets the patient window rather than the same cut-off.
      patientCaptureRef.current = true;
      setRoomNote("that came back garbled — say it once more, I'll wait longer.");
      setTurnState("ready");
      return;
    }

    // A Spanish turn answered in English is the intake's only usable "this is not working"
    // signal -- there is no evaluator before the verdict, so the suspicion router is all there is.
    noteIntakeAsideSignal(suspicious && !expectsEnglishAnswer);

    if (suspicious) {
      requestTranscriptConfirmation(transcript, lowConfidence);
      return;
    }

    void submitAttempt(transcript, "spoken", lowConfidence);
  }

  async function submitAttempt(
    attempt: string,
    inputMode: "spoken" | "written" = "written",
    lowConfidence = false,
  ) {
    const trimmed = attempt.trim();
    if (!trimmed) return;

    clearTimers();
    setTypedFallbackOpen(false);
    setTypedAttempt("");
    setTranscriptNeedsConfirm(false);
    setTurnState("thinking");

    // Checked before everything else: while the learner is stepped out, nothing they say is a
    // Spanish attempt. Routing it anywhere below would score a sentence about their week as
    // practice and hand the evaluator English to judge.
    if (asideActiveRef.current) {
      await handleAsideAttempt(trimmed);
      return;
    }

    // Typing it, or confirming it after the transcript box, has to mean the same thing as saying
    // it. Otherwise the help you get depends on which input you happened to use.
    if (stuckAskShouldStepOut(trimmed)) {
      await enterAside("stuck", trimmed);
      return;
    }

    if (retryTarget) {
      await submitRetryAttempt(trimmed, inputMode, lowConfidence);
      return;
    }

    if (flowPhase === "opening") {
      // The ask entry answers its own question: what they just said is the sentence they want, so
      // it goes straight to the lifeline rather than into a coach intake that would spend three
      // turns working out what they had already told it.
      if (isAskEntry) {
        await runAskPhrase({ said: trimmed, askEn: strippedAsk(trimmed) });
        return;
      }
      await handleOpeningAttempt(trimmed);
      return;
    }

    // The say-it-back. Only while the answer is on screen: anything spoken after the rescue lands
    // has nowhere to go, and scoring it a second time would tell them their phrase got worse.
    if (flowPhase === "ask") {
      if (phraseStatus === "ready") await handlePhraseAttempt(trimmed);
      else setTurnState("ready");
      return;
    }

    if (flowPhase === "coach") {
      await handleCoachAttempt(trimmed, inputMode, lowConfidence);
      return;
    }

    if (flowPhase !== "session") {
      setTurnState("ready");
      return;
    }

    if (!conversationId) {
      setRoomNote("start from the verdict first.");
      setTurnState("ready");
      return;
    }

    try {
      const repliedTo = currentConversationTurn;
      /**
       * Serialized on purpose, where this used to run in parallel with the coach reply.
       *
       * The character can only admit it did not understand if the verdict on what it just heard
       * exists before its line is generated. That costs the evaluation's latency on every turn --
       * measured at roughly +2.3s of a ~6s turn -- and it buys back the entire repair path, which
       * was fully written on the server and unreachable because the client always sent
       * `repairRequested: false`.
       */
      const evaluation = repliedTo
        ? await evaluateSessionAttempt(trimmed, repliedTo, lowConfidence).catch(() => null)
        : null;
      // Same verdict, a second question: repair asks "should the character admit it did not
      // understand", this asks "has this stopped working for the person". A turn can be both.
      noteAsideSignal(evaluation, inputMode === "spoken" ? lastVoiceFreeze : null);
      const repairDecision = shouldTriggerRepair({
        evaluation,
        assistanceUsed: turnAssistanceRef.current,
        lastTurnWasRepair: Boolean(currentConversationTurn?.isRepairTurn),
        lowConfidence,
      });
      const next = await readJson<ConverseReply>(
        await fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "respond",
            conversationId,
            turnIndex,
            userAttempt: trimmed,
            repairRequested: repairDecision.repair,
            pressureMode,
            // #44 -- what the character is allowed to notice. Settled verdicts on earlier turns
            // (safe to speak about as fact) and measurements of how THIS reply came out. The
            // evaluation of this reply is still in flight, which is exactly why the current turn
            // contributes delivery only; see the route's reactionPrompt.
            recentEvidence: sessionTurns
              .filter((turn) => turn.evaluation)
              .slice(-3)
              .map((turn) => ({
                meaning: turn.evaluation?.meaningResult ?? "unclear",
                blocker: turn.evaluation?.observedBlocker.type ?? null,
                assistance: turn.evaluation?.assistanceUsed ?? "none",
              })),
            thisTurn: {
              assistance: turnAssistanceRef.current,
              usedSubtitle: turnSubtitleRef.current,
              unaidedRun: unaidedRunRef.current,
              // Freeze metrics describe a SPOKEN attempt. `lastVoiceFreeze` outlives the turn it
              // was measured on, so sending it for a typed reply would have the character react
              // to a pause that never happened on this turn.
              secondsToFirstWord: inputMode === "spoken" ? lastVoiceFreeze?.timeToFirstWordSeconds ?? null : null,
              hesitations: inputMode === "spoken" ? lastVoiceFreeze?.hesitationCount ?? 0 : 0,
              englishWords: inputMode === "spoken" ? lastVoiceFreeze?.englishWordCount ?? 0 : 0,
            },
          }),
        }),
      );
      const nextTurns = repliedTo
        ? [
            ...sessionTurns,
            {
              turnIndex: repliedTo.turnIndex,
              characterLineEs: repliedTo.characterLineEs,
              characterMeaningEn: repliedTo.characterMeaningEn,
              expectedCommunicativeFunction:
                repliedTo.expectedCommunicativeFunction ?? "continue the conversation",
              suggestedReplyFrameEs: repliedTo.suggestedReplyFrameEs,
              suggestedReplyEs: repliedTo.suggestedReplyEs ?? null,
              responseGuidanceEn: repliedTo.responseGuidanceEn,
              userAttempt: trimmed,
              evaluation,
            },
          ]
        : sessionTurns;
      if (repliedTo) {
        setSessionTurns(nextTurns);
      }
      // Before the callout is built, because the callout is where a landed phrase is announced.
      notePhraseAttempt(trimmed, evaluation);
      showCoachReply(next, calloutForTurn(evaluation, Boolean(next.shouldClose)));
      if (next.shouldClose) {
        void saveCurrentMoment(nextTurns, next);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not answer yet.";
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  return (
    <main className="app-shell" aria-label="OutLoud shell">
      <section className="room" aria-label="OutLoud room">
        <header className="room-chrome" aria-label="Room controls">
          <button
            className="round-button exit-button"
            type="button"
            aria-label="leave"
            onClick={() => {
              if (overlay) {
                closeOverlay();
                return;
              }
              /*
               * Said out loud: they are finished. A snapshot left here would hand the run back on
               * the next mount, which is precisely the case where we have just been told not to.
               */
              try {
                window.sessionStorage.removeItem(leftRoomKey);
              } catch {
                // Storage blocked. Nothing was written either, so there is nothing to leave behind.
              }
              setMode("landing");
              setTypedFallbackOpen(false);
              setTypedAttempt("");
              setTranscriptNeedsConfirm(false);
              setConversationId(null);
              setCoachLine(null);
              showMeaning(null, null, { folded: false });
              setLastTranscript(null);
              setRoomNote(null);
              setEyesOffMode(false);
              setCurrentConversationTurn(null);
              setSessionTurns([]);
    setSessionCallout(null);
    unaidedRunRef.current = 0;
    calloutSpokenRef.current = false;
    turnAssistanceRef.current = "none";
    turnSubtitleRef.current = false;
              setReturnEmail("");
              setReturnEmailStatus("idle");
              setFeedbackAnswers(blankFeedbackAnswers());
              setFeedbackSaved(false);
              setProfileEvidenceIndex(0);
              setSavedMomentId(null);
              setSessionClosedAt(null);
              setSaveStatus("idle");
              setLastReviewUrl(null);
              stopMediaStream();
              disconnectRealtime();
              setTurnState("speaking");
            }}
          >
            <ExitIcon />
          </button>
          <button
            className={eyesOffMode ? "feedback-pill is-eyes-off" : "feedback-pill"}
            type="button"
            aria-label={eyesOffMode ? "eyes off controls" : "feedback"}
            onClick={() => setOverlay(eyesOffMode ? "eyes-off" : "feedback")}
          >
            <span>{eyesOffMode ? "eyes off" : "feedback"}</span>
            <HeartIcon />
          </button>
          {/* Debug only. The account pill opens the sign-in dialog when signed out, so without an
              account there is otherwise no way into /account from the room at all.
              Unmount tears down the mic and the realtime connection cleanly -- but it does NOT save
              the session, so this discards whatever is on the screen. Acceptable for a debug link
              that only appears with `?debug`; it was not acceptable for the pill below it. */}
          {debugTools ? (
            <Link className="debug-pill" href="/account" aria-label="debug: open the account page">
              debug
            </Link>
          ) : null}
          {/*
              Signed out, the profile page has nothing to show but an empty state, so the icon opens
              the sign-in dialog directly instead of routing there first.

              The two branches are treated differently now, and the difference is whether anything
              catches the session on the way out.

              **Signing in is safe.** It was not: both ways out are full-page navigations and
              neither saved anything, so somebody four turns into a conversation who tapped the
              little circle in the corner came back to an empty room. `stashRoomForAuth` now writes
              the whole room before the redirect and `restoreRoomAfterAuth` puts it back, so the
              button can stand where it is at any point in the session -- which is the point of
              building it. Master-plan #18, as Timo restated it on 2026-09-11, asks for the account
              to be earned by a win rather than gated in front of one, and a learner cannot say yes
              to that at the moment it lands on them if saying yes costs them the win.

              **The profile link still is not.** It is a plain navigation with no stash and no
              restore, so it stays hidden while there is anything to lose. Whoever gives that link
              the same treatment can delete this branch.
          */}
          {authedEmail ? (
            <Link
              className="profile-pill"
              href="/account"
              aria-label="your account"
              // Fires before the navigation, so the room is written down before it goes away. The
              // hidden branch this replaces was here because it was not.
              onClick={() => stashRoom("return")}
            >
              {authedEmail.slice(0, 1).toUpperCase() || <ProfileGlyph />}
            </Link>
          ) : (
            <button className="profile-pill" type="button" aria-label="sign in" onClick={() => openAuth("signin")}>
              <ProfileGlyph />
            </button>
          )}
        </header>

        {/*
          #47 -- the session's focus, above the orb rather than next to the mic status. Under the
          status label it read as a second instruction about what to do right now; here it reads
          as what this whole session is about, which is what it is.
        */}
        {flowPhase === "session" && !overlay && !asideActive && (sessionFocusLine || sceneCharacter) ? (
          <div className="session-header">
            {sessionFocusLine ? <p className="session-focus">today: {sessionFocusLine}</p> : null}
            {/*
              #29 -- the coach names them once, out loud, on the scenario turn. Two turns later
              nobody remembers, and the orb goes back to being a faceless blob. The name is also
              what lets the orb stop doing three jobs at once (#40).
            */}
            {sceneCharacter ? (
              <p className="session-who">
                {/*
                  A name that already contains the relation ("your girlfriend's sister") would
                  otherwise render as "with your girlfriend's sister — girlfriend's sister". The
                  prompts ask for a first name; this is what happens when they do not get one.
                */}
                {sceneCharacter.relation &&
                !sceneCharacter.name.toLowerCase().includes(sceneCharacter.relation.toLowerCase()) &&
                !sceneCharacter.relation.toLowerCase().includes(sceneCharacter.name.toLowerCase())
                  ? `with ${sceneCharacter.name} — ${sceneCharacter.relation}`
                  : `with ${sceneCharacter.name}`}
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          className={`room-orb-wrap ${turnState}${flowPhase === "ask" ? " is-compact" : ""}`}
          type="button"
          aria-label={holdLabel}
          disabled={orbDisabled}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            handleOrbPress();
          }}
          onPointerUp={(event) => {
            event.preventDefault();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            handleOrbRelease();
          }}
          onPointerCancel={(event) => {
            event.preventDefault();
            handleOrbRelease();
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <OrbCanvas state={orbState} className="room-orb" />
        </button>

        <section
          className={flowPhase === "ask" ? "room-copy is-compact" : "room-copy"}
          aria-label="Current room prompt"
        >
          {/*
            Dropped while the ask phase is waiting for them to speak. Everywhere else this line is
            the mic state sitting above a coach line; here it would sit above the question and
            read as the heading for the screen -- and "now say it." two lines down already says it
            better. The live states (listening, thinking) still show, because those ARE worth
            knowing while the mic is open.
          */}
          {(flowPhase === "ask" && turnState === "ready") || asideActive ? null : (
            <p className={isUserTurn ? "turn-label is-user" : "turn-label"}>
              {roomLabel}
            </p>
          )}
          {/*
            Both dropped while stepped out. The aside carries its own status line ("stepped out --
            we can pick this up again") and its own heading, so the room's label stacked three
            pieces of state on top of each other: "speaking", "tap the orb to interrupt", "stepped
            out". None of the three was the thing the learner was actually reading, and "interrupt"
            is wrong here anyway -- there is no scene running to interrupt.
          */}
          {roomSubcopy && !asideActive ? <p className="turn-subcopy">{roomSubcopy}</p> : null}
          {typedFallbackOpen ? (
            <div className="type-fallback" aria-label="Typed fallback">
              <h2>{transcriptNeedsConfirm ? "here's what I heard." : "I can't hear you yet."}</h2>
              <p>
                {transcriptNeedsConfirm
                  ? "fix anything that's wrong, then send."
                  : "type it instead — we'll keep going."}
              </p>
              <textarea
                aria-label="what were you trying to say?"
                placeholder="what were you trying to say?"
                value={typedAttempt}
                onChange={(event) => setTypedAttempt(event.target.value)}
              />
              <button
                type="button"
                onClick={() =>
                  void submitAttempt(
                    typedAttempt,
                    transcriptNeedsConfirm ? "spoken" : "written",
                    transcriptNeedsConfirm ? pendingAttemptConfidence : false,
                  )
                }
              >
                send
              </button>
              <button
                className="quiet-link"
                type="button"
                onClick={() => {
                  setTypedFallbackOpen(false);
                  setTranscriptNeedsConfirm(false);
                }}
              >
                {transcriptNeedsConfirm ? "start over" : "try voice again"}
              </button>
              {/*
                The transcript is usually right and the answer is usually the problem. Someone who
                has just said "I can't remember any vocabulary, I'm completely new" is being asked
                to fix a sentence that came through perfectly -- so the way out has to be on this
                screen, not behind it.
              */}
              {transcriptNeedsConfirm && canStepOut ? (
                <button
                  className="quiet-link"
                  type="button"
                  onClick={() => {
                    const said = typedAttempt.trim();
                    setTypedFallbackOpen(false);
                    setTranscriptNeedsConfirm(false);
                    // If what is in the box is itself an admission, the coach can open with the
                    // words rather than asking. Otherwise this stays the old open-ended step-out.
                    if (said && needsWordsEn(said)) void enterAside("stuck", said);
                    else void enterAside("learner");
                  }}
                >
                  that&apos;s not the problem — can we talk?
                </button>
              ) : null}
            </div>
          ) : asideActive ? (
            <div className="aside-room" aria-label="Stepped out">
              <p className="aside-badge">
                {/* There is no scene during the intake -- naming one would be the first thing the
                    learner reads, and it would be wrong. */}
                {flowPhase === "coach" ? "stepped out — we can pick this up again" : "stepped out — the scene is on pause"}
              </p>
              {/*
                Everything already said, oldest first, with the newest coach line pulled out below
                as the heading. On a phone this is the only way the learner can see that they are
                in a conversation rather than being asked a series of unrelated questions.
              */}
              {asideExchange.length > 1 ? (
                <div className="aside-thread" ref={asideThreadRef}>
                  {asideExchange.slice(0, -1).map((entry, index) => (
                    <p key={`${entry.who}-${index}`} className={entry.who === "you" ? "aside-said-you" : "aside-said-coach"}>
                      {entry.text}
                    </p>
                  ))}
                </div>
              ) : null}
              <h2>{asideLine ?? "one second."}</h2>
              {asideOffer ? (
                <div className="aside-offer">
                  <button className="sheet-primary" type="button" onClick={() => void acceptAsideOffer()}>
                    {asideOffer.labelEn}
                  </button>
                  {asideOffer.reasonEn ? <p className="tiny-note">{asideOffer.reasonEn}</p> : null}
                </div>
              ) : null}
              {roomNote ? <p className="room-note">{roomNote}</p> : null}
              {/*
                Always available, even mid-offer: an aside the learner cannot walk out of is just
                a different cage. `null` means no spoken lead-in -- they chose to leave, so the
                character line comes back on its own without the coach narrating the exit.
              */}
              <button className="quiet-link" type="button" onClick={() => leaveAside(null)}>
                back to the conversation
              </button>
              {turnState === "ready" ? (
                <button className="quiet-link" type="button" onClick={() => setTypedFallbackOpen(true)}>
                  rather type?
                </button>
              ) : null}
            </div>
          ) : flowPhase === "ask" && askPhrase ? (
            <div className="ask-room" aria-label="How to say it">
              {/*
                What they asked for, at the top and unchanged, so a misheard question is obvious
                before they spend a breath on it. The read-back on /dash is the first safety net;
                this is the second.
              */}
              <p className="ask-question">how to say: {askPhrase.askEn}</p>

              {phraseStatus === "asking" ? <h2>one second — looking that up.</h2> : null}

              {phraseStatus === "error" ? (
                <>
                  <h2>I couldn&apos;t look that one up.</h2>
                  <button className="quiet-link" type="button" onClick={() => void runAskPhrase(askPhrase)}>
                    try again
                  </button>
                </>
              ) : null}

              {phraseAnswer && phraseStatus !== "error" ? (
                <>
                  {/*
                    ALL of them, each with when to use it. The in-scene sheet shows one because it
                    is interrupting a conversation and there is no time; here, choosing between
                    them is the lesson -- "which of these would you actually say" is most of what
                    knowing a phrase means.
                  */}
                  <ul className="ask-options">
                    {phraseAnswer.options.map((option) => (
                      <li key={option.spanish} className="ask-option">
                        <p className="ask-option-es">{option.spanish}</p>
                        <p className="ask-option-en">{option.meaningEn}</p>
                        <p className="ask-option-when">{option.useWhenEn}</p>
                      </li>
                    ))}
                  </ul>
                  {phraseAnswer.noteEn ? <p className="ask-note">{phraseAnswer.noteEn}</p> : null}
                </>
              ) : null}

              {phraseStatus === "ready" ? (
                <>
                  {/*
                    The beat this whole feature exists for. Knowing the phrase and producing it
                    under pressure are different things, and a screen that stops here is a
                    dictionary -- which already exists, and is free.
                  */}
                  <h2>now say it.</h2>
                  <p className="room-translation">whichever one you&apos;d actually use.</p>
                </>
              ) : null}

              {phraseStatus === "scoring" ? <h2>one second.</h2> : null}

              {phraseStatus === "done" && placementRescue ? (
                <div className="ask-verdict">
                  <p className="ask-natural">{placementRescue.natural_version}</p>
                  <p className="ask-feedback">{placementRescue.actionable_feedback.explanationEn}</p>
                  <button className="sheet-primary" type="button" onClick={() => void startSceneFromAskedPhrase()}>
                    use it for real
                  </button>
                  {/*
                    Leaving is a first-class answer here. Somebody who wanted the words and nothing
                    else got them, and holding the door shut until they perform for us is the wrong
                    trade -- the same reason `/api/rescue` supports a skipped attempt.
                  */}
                  <button className="quiet-link" type="button" onClick={() => setMode("landing")}>
                    that&apos;s all I needed
                  </button>
                </div>
              ) : null}

              {roomNote ? <p className="room-note">{roomNote}</p> : null}
              {phraseStatus === "ready" ? (
                <button className="quiet-link" type="button" onClick={() => setTypedFallbackOpen(true)}>
                  rather type?
                </button>
              ) : null}
            </div>
          ) : isAskEntry && flowPhase === "opening" ? (
            <>
              {/*
                One direct question, so the answer IS the thing -- no router needed to work out
                what they meant. `strippedAsk` takes the asking off the front for people who
                answer a question with a question, which most people do.
              */}
              <h2>what do you want to be able to say?</h2>
              <p className="room-translation">english is fine — just the sentence.</p>
              <button className="quiet-link" type="button" onClick={() => setTypedFallbackOpen(true)}>
                rather type?
              </button>
            </>
          ) : isStung && flowPhase === "opening" ? (
            <>
              <h2>tell me what happened — english is fine.</h2>
              <p className="room-translation">say the part you couldn&apos;t get out.</p>
              <button className="quiet-link" type="button" onClick={() => setTypedFallbackOpen(true)}>
                rather type?
              </button>
            </>
          ) : (
            <>
              {turnState === "thinking" ? null : (
                <>
                  {sessionCallout ? <p className="session-callout">{sessionCallout}</p> : null}
                  {(() => {
                    const line = coachLine ?? openingPrompt;
                    const foldable = line.length > 90;
                    const folded = foldable && coachLineFolded && turnState !== "speaking";
                    return foldable ? (
                      <button
                        type="button"
                        className={folded ? "coach-line is-folded" : "coach-line"}
                        aria-expanded={!folded}
                        onClick={() => setCoachLineFolded((current) => !current)}
                      >
                        <h2>{line}</h2>
                        <span className="coach-line-toggle" aria-hidden="true">
                          {folded ? "read it again" : ""}
                        </span>
                      </button>
                    ) : (
                      <h2>{line}</h2>
                    );
                  })()}
                  {coachMeaning ? (
                    // Only a translation is foldable. An instruction is something the learner is
                    // being asked to DO, so it always renders plainly.
                    coachMeaningKind === "translation" ? (
                      <button
                        type="button"
                        className={englishFolded ? "translation-fold is-folded" : "translation-fold"}
                        aria-expanded={!englishFolded}
                        onClick={() => {
                          setEnglishFolded((current) => {
                            // Only opening counts. Closing it again does not un-read it, and the
                            // session translation starts folded, so opening is always a choice.
                            if (current) turnSubtitleRef.current = true;
                            return !current;
                          });
                        }}
                      >
                        <p className="room-translation">{coachMeaning}</p>
                        <span className="coach-line-toggle" aria-hidden="true">
                          {englishFolded ? "what that means" : ""}
                        </span>
                      </button>
                    ) : (
                      <p className="room-translation">{coachMeaning}</p>
                    )
                  ) : null}
                  {coachTool ? (
                    <CoachToolCard
                      tool={coachTool}
                      onPick={(label) => {
                        // Tapping a direction is the answer: stop talking/listening and send it.
                        cancelSpeaking();
                        voice.abortCapture();
                        holdingRef.current = false;
                        syncRealtimeMic();
                        void submitAttempt(label, "written");
                      }}
                    />
                  ) : null}
                  {roomNote ? <p className="room-note">{roomNote}</p> : null}
                  {asideNudgeOpen ? (
                    <div className="noisy-offer" aria-label="Step out of the scene">
                      <button type="button" onClick={() => void enterAside("offered")}>
                        step out and talk about it
                      </button>
                      <p className="tiny-note">
                        {flowPhase === "coach"
                          ? "nothing you have done is lost — we can pick this up again."
                          : "the scene waits — nothing you have done is lost."}
                      </p>
                      <button
                        className="quiet-link"
                        type="button"
                        onClick={() => {
                          setAsideNudgeOpen(false);
                          // Not reset: they said no once, and asking again two turns later is
                          // nagging. `asideNudgeShownRef` already keeps it to once per session.
                          asideStrikesRef.current = 0;
                        }}
                      >
                        keep going
                      </button>
                    </div>
                  ) : null}
                  {noisyOfferOpen ? (
                    <div className="noisy-offer" aria-label="Noisy room">
                      <button
                        type="button"
                        onClick={() => {
                          setMicMode("push");
                          setNoisyOfferOpen(false);
                          setRoomNote("switched to tap-to-talk. tap the orb when you're ready.");
                        }}
                      >
                        switch to hold-to-talk
                      </button>
                      <p className="tiny-note">headphones help too — they stop the mic hearing the coach.</p>
                      <button
                        className="quiet-link"
                        type="button"
                        onClick={() => {
                          setNoisyOfferOpen(false);
                          setRoomNote(null);
                        }}
                      >
                        keep the mic open
                      </button>
                    </div>
                  ) : null}
                  {flowPhase === "verdict" && !overlay ? (
                    <button className="reopen-card" type="button" onClick={() => setOverlay("verdict")}>
                      see your card again &rarr;
                    </button>
                  ) : null}
                  {flowPhase === "session" && coachLine ? (
                    <div className="audio-actions" aria-label="Audio controls">
                      <button type="button" onClick={() => replayCoachLine(false)}>
                        🔊 hear again
                      </button>
                      <button type="button" onClick={() => replayCoachLine(true)}>
                        🐢 slower
                      </button>
                    </div>
                  ) : null}
                  {showStepOut ? (
                    <button className="step-out-chip" type="button" onClick={() => void enterAside("learner")}>
                      hold on — can we talk?
                    </button>
                  ) : null}
                  {showSessionTools ? (
                    <div className="session-tools" aria-label="Session tools">
                      <button
                        type="button"
                        onClick={() => {
                          // Opening the ladder shows every rung this turn has, model answer
                          // included -- so the honest record is the strongest thing on offer.
                          noteAssistance(currentAssistanceRung === "model answer" ? "full_model" : "sentence_frame");
                          setOverlay("assistance");
                        }}
                      >
                        help
                      </button>
                      {everFix ? (
                        <button
                          className="is-revealed"
                          type="button"
                          onClick={() => {
                            noteAssistance("full_model");
                            setOverlay("correction");
                          }}
                        >
                          fix
                        </button>
                      ) : null}
                      {everPronounce ? (
                        <button
                          className="is-revealed"
                          type="button"
                          onClick={() => {
                            noteAssistance("slower_audio");
                            setOverlay("pronunciation");
                          }}
                        >
                          pronounce
                        </button>
                      ) : null}
                      {everAsk ? (
                        <button
                          className="is-revealed"
                          type="button"
                          onClick={() => {
                            noteAssistance("english_explanation");
                            setOverlay("ask");
                          }}
                        >
                          ask
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {turnState === "ready" ? (
                    <button className="quiet-link" type="button" onClick={() => setTypedFallbackOpen(true)}>
                      rather type?
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
        </section>

        {isLanding ? (
          <section className="landing-panel" aria-label="OutLoud landing">
            <div className="landing-stage">
              {/*
                The half that knows who is looking.

                A first-time visitor gets the claim the product makes; anybody with practice behind
                them gets the invitation to say what they want, which is a different job. Running
                both at once was the shape this screen had before, and it is why somebody with a
                month of sessions was still being sold the app on arrival.
              */}
              {showFunnel ? (
                <>
                  <h1>you understand Spanish. you just can&apos;t speak it.</h1>
                  <p className="landing-subcopy">
                    talk to an AI coach that figures out exactly what&apos;s holding you back
                    {" — "}and fixes it.
                  </p>
                </>
              ) : (
                <div className="dash-header" aria-live="polite">
                  <p className="dash-lead">{entry.header.lead}</p>
                  <p className="dash-alt">{entry.header.alt}</p>
                </div>
              )}

              {/*
                The orb listens here now, exactly as it does on `/dash` -- same hook, same phase
                machine, same router. The room's own orb is still mounted behind this panel and
                still disabled on the landing; it has a different job (a turn in a scene) and the
                two must not become one control that guesses which it is.
              */}
              <button className="landing-orb-wrap" type="button" {...entry.orbProps}>
                <OrbCanvas state={entry.orbState} className="landing-orb" size={440} />
              </button>

              {entryData.focus && entry.phase === "resting" && !entry.retry ? (
                <FocusLine label={entryData.focus.label} />
              ) : null}

              {entry.micBlocked && !entry.orbBusy ? (
                <form
                  className="dash-typed"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void entry.submitTyped(entry.typedDraft);
                  }}
                >
                  <input
                    className="dash-typed-box"
                    type="text"
                    aria-label="type what you want to do"
                    placeholder="type it instead"
                    value={entry.typedDraft}
                    onChange={(event) => entry.setTypedDraft(event.target.value)}
                  />
                  <button className="dash-typed-go" type="submit" disabled={!entry.typedDraft.trim()}>
                    go
                  </button>
                </form>
              ) : null}
            </div>

            <div className="landing-bottom">
              {showFunnel ? (
                <>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => enterRoom("speaks-first")}
                  >
                    start talking.
                  </button>
                  {/*
                    This ran `enterRoom("stung")` -- the engine for "a moment that went badly" -- so
                    somebody who stated the exact sentence they wanted got "tell me what happened"
                    and then a choice of two scenarios, and never the sentence.
                  */}
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => enterRoom("ask")}
                  >
                    didn&apos;t know how to say something? &rarr;
                  </button>
                  <p className="microcopy">90 seconds. no signup. just talk.</p>
                </>
              ) : (
                <>
                  <PickUpCard
                    event={entryData.liveEvent}
                    nextBeat={entryData.nextBeat}
                    readyBeat={Boolean(entryData.readyBeat)}
                    stepsOpen={Boolean(entryData.liveEvent && stepsFor === entryData.liveEvent.id)}
                    moment={entryData.pickUp}
                    momentIsDue={entryData.pickUpIsDue}
                    libraryReady={entryData.libraryState === "ready"}
                    askOutcome={entry.phase === "outcome"}
                    todayIso={entryData.todayIso}
                    accountEmail={authedEmail}
                    /* The room's chrome already carries the account pill, one layer above this. */
                    accountHref={null}
                    disabled={false}
                    onAnswerSpoke={entry.answerSpoke}
                    onStartBeat={(beatIndex) => {
                      if (entryData.liveEvent) void runEventBeat(entryData.liveEvent, beatIndex);
                    }}
                    onOpenSteps={() => {
                      entry.standDown();
                      if (entryData.liveEvent) setStepsFor(entryData.liveEvent.id);
                    }}
                    onPickUp={() => resumeSavedMoment(entryData.pickUp)}
                    onStartTalking={() => enterRoom("speaks-first")}
                  />
                  <div className="dash-tray">
                    <Link className="dash-tray-link" href="/account">
                      everything
                    </Link>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}

        {/*
          A sibling of the landing panel and a child of `.room`, never nested deeper: the drawer is
          absolutely positioned and needs an ancestor that caps its width and clips its overflow.
          `.room` is that box, and happens to be the same one `.dash-shell` is.
        */}
        {isLanding && entryData.liveEvent && stepsFor === entryData.liveEvent.id ? (
          <StepsDrawer
            event={entryData.liveEvent}
            eventDay={entryData.eventDay}
            nextBeatIndex={entryData.nextBeat?.index ?? null}
            todayIso={entryData.todayIso}
            disabled={false}
            onStartBeat={(beatIndex) => {
              if (entryData.liveEvent) void runEventBeat(entryData.liveEvent, beatIndex);
            }}
            onClose={() => setStepsFor(null)}
          />
        ) : null}

        {overlay ? (
          <div className="overlay-layer" aria-live="polite">
            <button
              className="overlay-backdrop"
              type="button"
              aria-label="dismiss overlay"
              onClick={closeOverlay}
            />
            <div
              className={`overlay-panel ${overlayKind === "card" ? "is-card" : "is-sheet"}`}
              role="dialog"
              aria-modal="true"
            >
              <button className="sheet-handle" type="button" aria-label="close overlay" onClick={closeOverlay} />

              {overlay === "verdict" ? (
                <VerdictCard
                  rescue={placementRescue}
                  authedEmail={authedEmail}
                  momentBefore={momentBefore}
                  momentAfter={momentAfter}
                  lootItems={lootItems}
                  unclaimedRuns={unclaimedRuns}
                  returnEmail={returnEmail}
                  returnEmailStatus={returnEmailStatus}
                  emailFallbackOpen={emailFallbackOpen}
                  setReturnEmail={setReturnEmail}
                  setReturnEmailStatus={setReturnEmailStatus}
                  setEmailFallbackOpen={setEmailFallbackOpen}
                  onSaveWords={(emailOverride) => void saveReturnEmail(emailOverride)}
                  onSignOut={signOut}
                  onCreateAccount={() => openAuth("signup")}
                  onStart={() => void startFirstSession()}
                />
              ) : null}

              {overlay === "after" ? (
                <AfterCard
                  openingAnswer={openingAnswer}
                  todayLine={todayLine}
                  data={closingData}
                  closing={closingRead}
                  focusLabel={sessionFocusLine}
                  saveStatus={saveStatus}
                  hasReturnLink={Boolean(lastReviewUrl)}
                  returnEmail={returnEmail}
                  returnEmailStatus={returnEmailStatus}
                  setReturnEmail={setReturnEmail}
                  setReturnEmailStatus={setReturnEmailStatus}
                  onSendLink={() => void saveReturnEmail()}
                  onReviewTranscript={() => setOverlay("transcript")}
                  onWhatWeKnow={() => setOverlay("profile")}
                  onKeepGoing={() => void startFirstSession()}
                  onDone={() => {
                    closeOverlay();
                    setMode("landing");
                    setTurnState("speaking");
                  }}
                />
              ) : null}

              {overlay === "feedback" ? (
                <FeedbackSheet
                  eyesOffMode={eyesOffMode}
                  setEyesOffMode={setEyesOffMode}
                  done={feedbackDone}
                  saved={feedbackSaved}
                  step={feedbackStep}
                  questions={activeFeedbackQuestions}
                  question={activeFeedback}
                  pick={feedbackPick}
                  setPick={setFeedbackPick}
                  text={feedbackText}
                  setText={setFeedbackText}
                  submitting={feedbackSubmitting}
                  onSubmit={(skipped) => void submitFeedbackAnswer(skipped)}
                  onClose={closeOverlay}
                />
              ) : null}

            {overlay === "profile" ? (
              <ProfileSheet
                rows={profileRows}
                onOpenEvidence={(index) => {
                  setProfileEvidenceIndex(index);
                  setOverlay("evidence");
                }}
                onOpenJourney={() => setOverlay("journey")}
                onOpenPressure={() => setOverlay("pressure")}
              />
            ) : null}

            {overlay === "journey" ? (
              <JourneySheet data={closingData} focusLabel={sessionFocusLine} />
            ) : null}

            {overlay === "evidence" ? (
              <EvidenceSheet row={activeEvidence} onBack={() => setOverlay("profile")} />
            ) : null}

            {overlay === "transcript" ? (
              <TranscriptSheet turns={sessionTurns} onBack={() => setOverlay("after")} />
            ) : null}

            {overlay === "pressure" ? (
              <PressureSheet toneMode={toneMode} setToneMode={setToneMode} />
            ) : null}

            {overlay === "assistance" ? (
              <AssistanceSheet
                ladder={assistanceLadder}
                currentRung={currentAssistanceRung}
                rationale={assistanceRationale}
                onFix={() => setOverlay("correction")}
                onPronounce={() => setOverlay("pronunciation")}
              />
            ) : null}

            {overlay === "correction" ? (
              <CorrectionSheet
                correction={activeCorrection}
                hasPronunciationTarget={Boolean(activePronunciationTarget)}
                transcriptionWasBorderline={lastTranscriptionConfidence === "borderline"}
                retryFeedback={correctionRetryResult?.conciseFeedbackEn ?? null}
                onPronounce={() => setOverlay("pronunciation")}
                onSayItBack={startCorrectionRetry}
              />
            ) : null}

            {overlay === "pronunciation" ? (
              <PronunciationSheet
                syllables={activePronunciationSyllables}
                stressedIndex={activePronunciationTarget?.stressedSyllableIndex ?? 1}
                word={activePronunciationTarget?.word ?? null}
                coachingNote={pronunciationResult?.coachingNoteEn ?? null}
                naturalVersion={activeCorrection.naturalVersion}
                isRetrying={retryTarget?.kind === "pronunciation"}
                onTryAgain={startPronunciationRetry}
                onEnough={() => {
                  setRetryTarget(null);
                  restoreCurrentTurn("Back to the conversation.");
                  setOverlay(null);
                }}
              />
            ) : null}

            {overlay === "ask" ? (
              <AskSheet
                draft={askDraft}
                setDraft={setAskDraft}
                resetStatus={() => setAskStatus("idle")}
                answer={askAnswer}
                status={askStatus}
                onAsk={() => void submitAskQuestion()}
                onClose={closeOverlay}
              />
            ) : null}

            {overlay === "eyes-off" ? (
              <EyesOffSheet
                onRepeat={() => {
                  closeOverlay();
                  replayCoachLine(false);
                }}
                onSlower={() => {
                  closeOverlay();
                  replayCoachLine(true);
                }}
                onNextWord={() => setOverlay("assistance")}
                onBackToTouch={() => {
                  setEyesOffMode(false);
                  closeOverlay();
                }}
              />
            ) : null}
            </div>
          </div>
        ) : null}
      </section>
      {authOpen ? (
        <AuthDialog
          initialMode={authIntent}
          onClose={() => setAuthOpen(false)}
          onBeforeRedirect={() => stashRoom("auth")}
          onAuthed={(email) => {
            setReturnEmail(email);
            void saveReturnEmail(email);
          }}
        />
      ) : null}
    </main>
  );
}
