"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { OrbCanvas } from "./components/OrbCanvas";
import { assistanceRank, derivePracticeLedgerState } from "@/lib/learning-loop";
import { shouldTriggerRepair } from "@/lib/repair-loop";
import {
  assistanceOrderFor,
  blockerHypothesisMap,
  chooseTeachingPolicy,
  createInterventionOutcome,
  teachingRationaleFor,
} from "@/lib/teaching-policy";
import { blockerFocusLabels, normalizeObservedBlocker } from "@/lib/blocker-taxonomy";
import type {
  AssistanceUsed,
  AttemptEvaluation,
  BlockerType,
  FreezeSignals,
  RescueResponse,
  SelfReportedBlocker,
} from "@/lib/types";
import { openingPrompt, staticAudioForText } from "@/lib/static-lines";
import type { CoachResponse } from "@/lib/coach-schema";
import type { AsideResponse } from "@/lib/aside-schema";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { resumeMomentKey, type ResumeMoment } from "@/lib/account-links";
import type { TranscriptionConfidenceTier } from "@/lib/transcription-confidence";

type RoomMode = "landing" | "speaks-first" | "stung";
type TurnState = "ready" | "listening" | "still-listening" | "thinking" | "speaking";
type FlowPhase = "opening" | "coach" | "verdict" | "session";
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

type RealtimeSpeechMode = "intake" | "conversation";

type RealtimeTokenResponse = {
  ok: true;
  value: string;
  model: string;
  /** Restated on every language switch; a partial `transcription` object would drop the model. */
  transcribeModel?: string;
  voice: string;
  expiresAt: string | null;
};

type RealtimeServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  item?: {
    content?: Array<{
      transcript?: string;
      text?: string;
    }>;
  };
  response?: {
    status?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

// Realtime errors that are expected side effects of the turn choreography rather than real
// failures: committing an already-VAD-committed (empty) buffer, or cancelling a response that
// has already finished by the time the interrupt tap lands.
const ignorableRealtimeErrorCodes = new Set([
  "input_audio_buffer_commit_empty",
  "input_audio_buffer_commit_too_small",
  "response_cancel_not_active",
]);

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

const defaultConversationContext = {
  who: "an OutLoud Spanish coach",
  dialect: "Latin America",
  tone: "warm",
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
    mode === "stung"
      ? `The learner's real situation, in their own words: "${openingAnswer}".`
      : `The learner's self-described problem, in their own words: "${openingAnswer}".`;

  return `${header}${scenario} Transcript of the first coached conversation: ${transcript}`;
}

function clipForApi(value: string, max = 1500) {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// A spoken attempt that visibly broke: trailing off, or English leaking into the Spanish.
/**
 * Sounds a person makes while still deciding what to say.
 *
 * Deliberately narrow. "eh" and "este" are also real Spanish words and "well" and "like" are real
 * English ones. "mm", "mmm" and "mhm" are left out for a sharper reason: as a whole utterance they
 * usually mean YES, and a learner answering a yes/no question with one has answered it. Swallowing
 * that as hesitation would silently discard a correct reply -- the exact failure the short-answer
 * rule exists to prevent. "ah" is a reaction, not a stall.
 */
const fillerSounds = new Set([
  "um", "umm", "uhm", "uh", "uhh", "er", "err", "erm", "ehm", "emm", "em",
  "hm", "hmm", "hmmm", "ähm", "äh", "öhm",
]);

/**
 * True when the capture contains nothing but hesitation.
 *
 * Server VAD ends a turn on silence, and a learner who says "um..." and then thinks has produced
 * exactly that: a complete turn, by the microphone's definition, containing no answer. Sending it
 * on gets it flagged as a broken attempt and puts a confirm box in front of someone who was still
 * working out how to start -- asking them to correct a transcript that was perfectly accurate.
 */
function isFillerOnly(attempt: string) {
  const words = attempt
    .toLowerCase()
    // Punctuation only: the ellipsis a hesitation transcribes as, and the commas between two of
    // them. Letters and digits survive, so anything with real content fails this test.
    .replace(/[.,!?¿¡…"'`\-—–]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => fillerSounds.has(word));
}

function looksBrokenAttempt(attempt: string) {
  return (
    attempt.includes("...") ||
    /\b(uh|um|ehm|how do you say|the|and|you|want|is|was|do|don't|know)\b/i.test(attempt)
  );
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

function formatBlockerLabel(value: string | undefined) {
  return (value ?? "conversation").replace(/_/g, " ");
}

function tomorrowLabel() {
  return new Intl.DateTimeFormat("en", { weekday: "long" }).format(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  ).toLowerCase();
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const mediaRecorderTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
];

// Shared by both capture paths so they can't drift: echo cancellation is what stops an open mic
// from hearing the coach through the speaker, and the recorder fallback needs it just as much as
// the realtime path does.
const micConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

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

// Google OAuth is a full-page redirect, which wipes all component state. The verdict snapshot
// is stashed here before redirecting and restored (plus auto-saved) when the session comes back.
const pendingVerdictKey = "outloud-pending-verdict";

type VerdictSnapshot = {
  mode: RoomMode;
  openingAnswer: string;
  placementSummary: string;
  placementAttempts: PlacementAttempt[];
  placementRescue: RescueResponse;
  coachLoot: Array<{ es: string; en: string | null }>;
  coachEvidence: string[];
  reportedBlocker: SelfReportedBlocker | null;
};

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
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const staticAudioRef = useRef<HTMLAudioElement | null>(null);
  const staticAudioResolveRef = useRef<((played: boolean) => void) | null>(null);
  const realtimeConnectPromiseRef = useRef<Promise<boolean> | null>(null);
  const realtimeModeRef = useRef<RealtimeSpeechMode | null>(null);
  const realtimeActiveCaptureRef = useRef(false);
  const realtimeTranscriptRef = useRef("");
  const realtimeTranscriptFinalRef = useRef(false);
  const realtimeCaptureResolveRef = useRef<((value: string) => void) | null>(null);
  const realtimeCaptureTimerRef = useRef<number | null>(null);
  const realtimeSpeakingResolveRef = useRef<(() => void) | null>(null);
  const realtimeSpeakingTimerRef = useRef<number | null>(null);
  const realtimeSpeakingStartedAtRef = useRef(0);
  const realtimeFallbackRef = useRef(false);
  const realtimeSpeechActiveRef = useRef(false);
  const realtimeSpeechSeenRef = useRef(false);
  const realtimeInterruptibleRef = useRef(false);
  const realtimeInterruptedRef = useRef(false);
  const realtimeResponseDoneRef = useRef(false);
  const realtimeOutputAudioActiveRef = useRef(false);
  const overlayRef = useRef<RoomOverlay>(null);
  const typedFallbackOpenRef = useRef(false);
  // Read from realtime event handlers, which can fire inside the render the state changed in.
  const flowPhaseRef = useRef<FlowPhase>("opening");
  const coachPhaseRef = useRef<CoachResponse["phase"] | null>(null);
  const pressStartedAtRef = useRef(0);
  const pressKindRef = useRef<"start" | "finish" | "interrupt" | null>(null);
  /**
   * What the microphone is doing right now. Replaces the scattered track.enabled flipping with one
   * derived value, because full-duplex adds a third state between "off" and "recording":
   *
   * - `closed`    -- track disabled. Nothing reaches the server.
   * - `armed`     -- track live but no turn is in progress. Speaking starts one. Runs the stricter
   *                  `guard` VAD profile so room noise doesn't open a turn nobody asked for.
   * - `capturing` -- a turn is in progress and being transcribed.
   */
  const micWindowRef = useRef<"closed" | "armed" | "capturing">("closed");
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
  const restoreVerdictAfterAuthRef = useRef<(email: string) => void>(() => undefined);
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
  const realtimeDebugRef = useRef(false);
  /**
   * True from the moment a capture is closed until its transcript resolves.
   *
   * Transcription for a turn ALWAYS arrives after the mic window has closed -- `finishRealtimeListening`
   * closes it and only then waits for the text. The guard on transcript accumulation therefore
   * cannot key on "window is closed" alone; doing so discarded every real transcript on the
   * realtime path while letting through exactly nothing. This marks the window in which a closed
   * mic is still expecting its own result.
   */
  const awaitingTranscriptRef = useRef(false);
  /** Returned by the token route so a language switch can restate it. */
  const realtimeTranscribeModelRef = useRef("gpt-4o-mini-transcribe");
  /** The language currently pinned on the realtime transcriber, to avoid redundant updates. */
  const realtimeLanguageRef = useRef<"en" | "es">("en");
  function vlog(scope: string, ...rest: unknown[]) {
    if (!realtimeDebugRef.current) return;
    const line = [
      `[voice:${scope}]`,
      ...rest.map((value) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : value instanceof Error
            ? `${value.name}: ${value.message}`
            : safeJson(value),
      ),
      `| mic:${micWindowRef.current} mode:${micModeRef.current} turn:${turnStateRef.current} capturing:${realtimeActiveCaptureRef.current}`,
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
    : mode === "stung"
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
  const [savedMomentId, setSavedMomentId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastReviewUrl, setLastReviewUrl] = useState<string | null>(null);
  const isLanding = mode === "landing";
  const isStung = mode === "stung";
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
  const spokenAttempts = placementAttempts.filter((attempt) => attempt.kind !== "setup");
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
  const afterDelta =
    sessionTurns.length === 0
      ? "baseline set from your first run."
      : sessionTurns.some((turn) => turn.evaluation?.meaningResult === "clear")
        ? "you got at least one real reply across clearly."
        : "we found the exact reply to practice next.";
  const tomorrowWork = formatBlockerLabel(almostBeaten);
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
  // Within-session movement for the focus dimension. Across sessions lives on /profile, which is
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
  const journeyRows = [
    ["answer the coach's first question", placementAttempts.some((item) => item.kind !== "setup") ? "done" : "ahead", placementAttempts.find((item) => item.kind !== "setup")?.userAttempt ?? ""],
    ["retry after a hint", placementAttempts.some((item) => item.kind === "retry") ? "done" : "ahead", placementAttempts.find((item) => item.kind === "retry")?.userAttempt ?? ""],
    ["start a real conversation", sessionTurns.length ? "done" : flowPhase === "session" ? "now" : "ahead", currentConversationTurn?.characterLineEs ?? ""],
    [`practice ${tomorrowWork}`, overlay === "after" ? "now" : "ahead", todayLine],
    ["come back in a new situation", returnEmailStatus === "saved" ? "now" : "ahead", returnEmailStatus === "saved" ? tomorrowLabel() : ""],
  ];

  function closeOverlay() {
    setOverlay(null);
    setFeedbackStep(0);
    setFeedbackPick(null);
    setFeedbackText("");
    setAskDraft("");
    setAskStatus("idle");
    setAskAnswer(null);
  }

  function clearTimers() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }

  /**
   * Sends one event on the realtime data channel. Returns false when the channel isn't usable, so
   * callers can fall back rather than assume delivery. A closing channel throwing here is expected
   * -- the connection-state handler takes over.
   */
  function sendRealtimeEvent(payload: Record<string, unknown>) {
    const channel = realtimeChannelRef.current;
    if (channel?.readyState !== "open") {
      vlog("send", "DROPPED (channel not open):", payload.type, "readyState:", channel?.readyState ?? "no channel");
      return false;
    }
    try {
      channel.send(JSON.stringify(payload));
      vlog("send", "ok:", payload.type);
      return true;
    } catch (error) {
      vlog("send", "THREW:", payload.type, error);
      return false;
    }
  }

  /**
   * Server-VAD tuning, sent live over the data channel rather than baked into the token, because
   * the token route mints once per session (and is rate limited), so mint-time values can never
   * change mid-session.
   *
   * - `capture`: actively listening to the learner. Sensitive, with a long silence window so a
   *   thinking pause doesn't end their turn.
   * - `guard`: mic is open but it is not the learner's turn. The raised threshold is the primary
   *   defense against room noise and coach echo tripping a false turn.
   *
   * create_response/interrupt_response are restated on every update: a partial turn_detection
   * object would otherwise let them fall back to defaults, and create_response: true would let the
   * realtime model start answering the learner directly -- it is only a voice bridge here.
   */
  /**
   * Pins the transcriber to the language the learner is actually expected to answer in.
   *
   * Auto-detection turned short replies into Korean and a clean Spanish sentence into Danish --
   * the right meaning, the wrong language -- and those transcripts are submitted as the learner's
   * turn, so the conversation derails on input nobody produced. The flow genuinely switches
   * language (English scaffolding, Spanish practice), so this has to move with it rather than be
   * fixed at mint time.
   */
  function applyTranscriptionLanguage(language: "en" | "es") {
    if (realtimeLanguageRef.current === language) return false;
    realtimeLanguageRef.current = language;
    vlog("vad", "transcription language ->", language);
    return sendRealtimeEvent({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            // The model is restated deliberately: a partial `transcription` object drops it.
            transcription: { model: realtimeTranscribeModelRef.current, language },
          },
        },
      },
    });
  }

  function applyVadProfile(profile: "capture" | "guard" | "patient") {
    vlog("vad", "applying profile:", profile, "threshold: 0.5");
    return sendRealtimeEvent({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              // Both profiles sit at the API default. `guard` was 0.75, invented as a defence
              // against the coach's own voice tripping a turn -- but the mic is only ever armed
              // while `turnState === "ready"`, which is precisely when the coach is silent. Voice
              // barge-in, the one case where an armed mic would hear the coach, is not built. So
              // the raised threshold guarded nothing and only made "just start talking" miss quiet
              // speakers. Raise it again when Half B lands, not before.
              threshold: 0.5,
              prefix_padding_ms: 300,
              // `patient` is the answer to a capture that came back as nothing but "um": the
              // learner is mid-thought, and the fix for cutting them off is to stop cutting them
              // off. Long enough to think in, short enough that a finished answer does not sit
              // there feeling ignored.
              silence_duration_ms:
                profile === "guard" ? 600 : profile === "patient" ? 2600 : pressureMode ? 850 : 1200,
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    });
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
    if (realtimeActiveCaptureRef.current) return "capturing";
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

  /** Single place that decides whether the mic transmits, and under which VAD profile. */
  function syncRealtimeMic() {
    const next = deriveMicWindow();
    const changed = micWindowRef.current !== next;
    const before = micWindowRef.current;
    micWindowRef.current = next;
    const tracks = realtimeStreamRef.current?.getAudioTracks() ?? [];
    tracks.forEach((track) => {
      track.enabled = next !== "closed";
    });
    if (changed) {
      vlog(
        "mic",
        `window ${before} -> ${next}`,
        "| tracks:", tracks.length,
        "| enabled:", tracks.map((t) => t.enabled),
        "| muted:", tracks.map((t) => t.muted),
      );
    }
    if (changed && next !== "closed") {
      applyVadProfile(next === "capturing" ? (patientCaptureRef.current ? "patient" : "capture") : "guard");
    }
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function clearRealtimeTimers() {
    if (realtimeCaptureTimerRef.current) {
      window.clearTimeout(realtimeCaptureTimerRef.current);
      realtimeCaptureTimerRef.current = null;
    }
    if (realtimeSpeakingTimerRef.current) {
      window.clearTimeout(realtimeSpeakingTimerRef.current);
      realtimeSpeakingTimerRef.current = null;
    }
  }

  function resolveRealtimeCapture(transcript: string) {
    const resolve = realtimeCaptureResolveRef.current;
    realtimeCaptureResolveRef.current = null;
    if (realtimeCaptureTimerRef.current) {
      window.clearTimeout(realtimeCaptureTimerRef.current);
      realtimeCaptureTimerRef.current = null;
    }
    resolve?.(transcript.trim());
  }

  function resolveRealtimeSpeaking() {
    const resolve = realtimeSpeakingResolveRef.current;
    realtimeSpeakingResolveRef.current = null;
    if (realtimeSpeakingTimerRef.current) {
      window.clearTimeout(realtimeSpeakingTimerRef.current);
      realtimeSpeakingTimerRef.current = null;
    }
    resolve?.();
  }


  function disconnectRealtime() {
    realtimeActiveCaptureRef.current = false;
    awaitingTranscriptRef.current = false;
    realtimeConnectPromiseRef.current = null;
    realtimeModeRef.current = null;
    realtimeFallbackRef.current = false;
    realtimeSpeechActiveRef.current = false;
    realtimeSpeechSeenRef.current = false;
    realtimeInterruptibleRef.current = false;
    realtimeInterruptedRef.current = false;
    realtimeResponseDoneRef.current = false;
    realtimeOutputAudioActiveRef.current = false;
    setInterruptible(false);
    resolveRealtimeCapture("");
    resolveRealtimeSpeaking();
    clearRealtimeTimers();
    realtimeChannelRef.current?.close();
    realtimeChannelRef.current = null;
    realtimePeerRef.current?.close();
    realtimePeerRef.current = null;
    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeStreamRef.current = null;
    if (realtimeAudioRef.current) {
      realtimeAudioRef.current.pause();
      realtimeAudioRef.current.srcObject = null;
      realtimeAudioRef.current = null;
    }
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
        mode === "stung"
          ? "The learner started from something they could not say in real life."
          : "The learner is entering a guided first conversation from the coached intake.",
      context: defaultConversationContext,
      rescue: placementRescue,
      pressureMode,
    };
  }

  function handleRealtimeEvent(event: RealtimeServerEvent) {
    const type = event.type ?? "";

    // Opt-in trace of the realtime data channel. It is a WebRTC data channel, so none of this is
    // visible in the network tab, which makes "the mic just does nothing" almost impossible to
    // diagnose from the outside. Enable with:
    //   localStorage["outloud-debug-realtime"] = "1"
    if (realtimeDebugRef.current) {
      console.log(
        "[rt]",
        type,
        "| micWindow:", micWindowRef.current,
        "| turn:", turnStateRef.current,
        "| capture:", realtimeActiveCaptureRef.current,
        "| speechSeen:", realtimeSpeechSeenRef.current,
        "| transcript:", JSON.stringify(realtimeTranscriptRef.current),
        type === "error" ? event.error : "",
      );
    }

    if (type === "error") {
      if (event.error?.code && ignorableRealtimeErrorCodes.has(event.error.code)) {
        return;
      }
      // Any unhandled error silently drops the whole session to the MediaRecorder path, which is
      // very hard to notice while developing -- a malformed session.update looks like "voice just
      // got worse". Surface it locally; production stays quiet.
      if (process.env.NODE_ENV === "development") {
        console.warn("[realtime] unhandled error event", event.error?.code, event.error?.message);
      }
      realtimeFallbackRef.current = true;
      resolveRealtimeCapture(realtimeTranscriptRef.current);
      resolveRealtimeSpeaking();
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      realtimeSpeechActiveRef.current = true;
      realtimeSpeechSeenRef.current = true;

      if (realtimeActiveCaptureRef.current) {
        // The learner started talking, so the idle timeout no longer applies. Guarded: with an
        // armed mic this fires on room noise too, and clearTimers() wipes every pending timer --
        // including the speak fallback that hands the turn back.
        clearTimers();
        return;
      }

      // Armed and it is their turn: talking IS the tap. This is what full-duplex buys -- nobody has
      // to read an instruction to start.
      if (micWindowRef.current === "armed" && turnStateRef.current === "ready") {
        void startRealtimeListening(null, { resumingSpeech: true });
      }
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      realtimeSpeechActiveRef.current = false;
      // Server VAD has already committed the buffer; the turn ends here without any tap.
      if (realtimeActiveCaptureRef.current) {
        void finishRealtimeListening(false);
      }
      return;
    }

    if (type === "output_audio_buffer.started") {
      realtimeOutputAudioActiveRef.current = true;
      return;
    }

    if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") {
      realtimeOutputAudioActiveRef.current = false;
      // Playback has actually drained on the client, so the mic can open without echoing the coach.
      if (realtimeResponseDoneRef.current) {
        resolveRealtimeSpeaking();
      }
      return;
    }

    // Transcription can arrive for audio captured outside a turn -- an armed mic hears the room.
    // The transcript ref is only cleared when a turn STARTS, so anything accepted here would
    // otherwise be prepended to whatever the learner says next.
    if (
      micWindowRef.current === "closed" &&
      !awaitingTranscriptRef.current &&
      type.includes("input_audio_transcription")
    ) {
      vlog("transcript", "IGNORED (closed, no capture awaiting):", type, event.transcript ?? event.delta ?? "");
      return;
    }

    if (typeof event.delta === "string" && type.includes("input_audio_transcription.delta")) {
      realtimeTranscriptRef.current += event.delta;
    }

    if (typeof event.transcript === "string" && type.includes("input_audio_transcription")) {
      vlog("transcript", type, JSON.stringify(event.transcript));
      realtimeTranscriptRef.current = event.transcript;
      if (type.endsWith(".completed")) {
        realtimeTranscriptFinalRef.current = true;
        resolveRealtimeCapture(event.transcript);
      }
    }

    const contentTranscript = event.item?.content
      ?.map((item) => item.transcript ?? item.text ?? "")
      .join(" ")
      .trim();
    if (contentTranscript && type.includes("input_audio_transcription")) {
      realtimeTranscriptRef.current = contentTranscript;
      realtimeTranscriptFinalRef.current = true;
      resolveRealtimeCapture(contentTranscript);
    }

    if (
      type === "response.done" ||
      type === "response.output_audio.done" ||
      type === "response.audio.done" ||
      event.response?.status === "completed"
    ) {
      realtimeResponseDoneRef.current = true;
      if (realtimeOutputAudioActiveRef.current) {
        // Generation is done but audio is still playing out; wait for output_audio_buffer.stopped,
        // with a safety net in case that event never arrives.
        if (realtimeSpeakingTimerRef.current) {
          window.clearTimeout(realtimeSpeakingTimerRef.current);
        }
        realtimeSpeakingTimerRef.current = window.setTimeout(resolveRealtimeSpeaking, 8000);
        return;
      }
      const minimumMs = 900;
      const elapsed = nowMs() - realtimeSpeakingStartedAtRef.current;
      window.setTimeout(resolveRealtimeSpeaking, Math.max(0, minimumMs - elapsed));
    }
  }

  async function waitForRealtimeChannel(channel: RTCDataChannel) {
    if (channel.readyState === "open") return true;

    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 5000);
      channel.addEventListener(
        "open",
        () => {
          window.clearTimeout(timer);
          resolve(true);
        },
        { once: true },
      );
      channel.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          resolve(false);
        },
        { once: true },
      );
    });
  }

  async function ensureRealtime(nextMode: RealtimeSpeechMode) {
    if (
      typeof window === "undefined" ||
      typeof RTCPeerConnection === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return false;
    }

    if (
      realtimeModeRef.current === nextMode &&
      realtimePeerRef.current?.connectionState !== "closed" &&
      realtimeChannelRef.current?.readyState === "open"
    ) {
      return true;
    }

    if (realtimeConnectPromiseRef.current) {
      vlog("connect", "already connecting, awaiting existing promise");
      return realtimeConnectPromiseRef.current;
    }

    const requestBody = realtimeRequestFor(nextMode);
    if (!requestBody) {
      vlog("connect", "ABORT: no request body for mode", nextMode, "(no rescue/placement yet?)");
      return false;
    }
    vlog("connect", "starting, mode:", nextMode);

    realtimeConnectPromiseRef.current = (async () => {
      try {
        if (
          realtimePeerRef.current ||
          realtimeChannelRef.current ||
          (realtimeModeRef.current && realtimeModeRef.current !== nextMode)
        ) {
          disconnectRealtime();
        }

        const token = await readJson<RealtimeTokenResponse>(
          await fetch("/api/realtime-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          }),
        );

        const peer = new RTCPeerConnection();
        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        realtimeAudioRef.current = audio;

        peer.ontrack = (event) => {
          audio.srcObject = event.streams[0];
          void audio.play().catch(() => undefined);
        };
        peer.onconnectionstatechange = () => {
          vlog("connect", "peer state:", peer.connectionState);
          if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            realtimeFallbackRef.current = true;
          }
        };

        if (token.transcribeModel) realtimeTranscribeModelRef.current = token.transcribeModel;
        realtimeLanguageRef.current = "en";
        vlog("connect", "token minted, requesting microphone");
        const stream = await navigator.mediaDevices.getUserMedia(micConstraints);
        stream.getAudioTracks().forEach((track) => {
          track.enabled = false;
          peer.addTrack(track, stream);
        });
        vlog(
          "connect",
          "microphone granted:",
          stream.getAudioTracks().map((t) => `${t.label} (muted:${t.muted}, state:${t.readyState})`),
        );

        const channel = peer.createDataChannel("oai-events");
        channel.addEventListener("message", (message) => {
          try {
            handleRealtimeEventRef.current(JSON.parse(message.data) as RealtimeServerEvent);
          } catch {
            // Ignore malformed transport events; the app state is driven by our engine.
          }
        });
        channel.addEventListener("error", (event) => {
          vlog("connect", "DATA CHANNEL ERROR -> falling back to MediaRecorder", event);
          realtimeFallbackRef.current = true;
        });

        realtimePeerRef.current = peer;
        realtimeChannelRef.current = channel;
        realtimeStreamRef.current = stream;
        realtimeModeRef.current = nextMode;

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.value}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });

        if (!sdpResponse.ok) {
          vlog("connect", "SDP exchange failed:", sdpResponse.status, await sdpResponse.text().catch(() => ""));
          throw new Error("Realtime session could not connect.");
        }

        await peer.setRemoteDescription({
          type: "answer",
          sdp: await sdpResponse.text(),
        });

        const opened = await waitForRealtimeChannel(channel);
        if (!opened) {
          throw new Error("Realtime channel did not open.");
        }

        // State the VAD profile explicitly rather than inheriting whatever the token was minted
        // with -- the token is minted once per session, so its values can never change again.
        applyVadProfile("capture");
        vlog("connect", "CONNECTED — data channel open");

        return true;
      } catch (error) {
        // This used to be a bare `catch {}`. Every connection failure -- a 429 on the token, a
        // denied microphone, a rejected SDP -- became an identical silent drop to the
        // MediaRecorder path, which is indistinguishable from "the mic just does nothing".
        vlog("connect", "FAILED -> MediaRecorder fallback:", error);
        realtimeFallbackRef.current = true;
        disconnectRealtime();
        return false;
      } finally {
        realtimeConnectPromiseRef.current = null;
      }
    })();

    return realtimeConnectPromiseRef.current;
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
    const channel = realtimeChannelRef.current;

    if (!connected || !channel || channel.readyState !== "open") {
      later(() => {
        if (handBackTurn) setTurnState("ready");
        onDone?.();
      }, fallbackDelay);
      return;
    }

    // If a previous line is still being generated or played out, cut it before starting the
    // next one -- otherwise the new text shows while the old audio keeps talking.
    if (realtimeSpeakingResolveRef.current || realtimeOutputAudioActiveRef.current) {
      sendRealtimeEvent({ type: "response.cancel" });
      sendRealtimeEvent({ type: "output_audio_buffer.clear" });
      resolveRealtimeSpeaking();
    }

    realtimeSpeakingStartedAtRef.current = nowMs();
    realtimeResponseDoneRef.current = false;
    realtimeOutputAudioActiveRef.current = false;
    realtimeInterruptedRef.current = false;
    realtimeInterruptibleRef.current = canInterrupt;
    setInterruptible(canInterrupt);

    const finishedSpeaking = new Promise<void>((resolve) => {
      realtimeSpeakingResolveRef.current = resolve;
      realtimeSpeakingTimerRef.current = window.setTimeout(resolveRealtimeSpeaking, Math.max(2400, fallbackDelay + 5000));
    });

    sendRealtimeEvent({
      type: "response.create",
      response: {
        // Out-of-band: this response must not see (or join) the session's conversation history.
        // The realtime model is a voice bridge here; with history it sometimes "answers" the
        // learner's last utterance or repeats an earlier line instead of reading this one.
        conversation: "none",
        output_modalities: ["audio"],
        instructions: slow
          ? `Say this exact line and nothing else, noticeably slower and very clearly, without changing a word: ${text}`
          : `Say this exact line and nothing else: ${text}`,
      },
    });

    await finishedSpeaking;
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
      realtimeChannelRef.current?.readyState !== "open"
    ) {
      return;
    }

    const started = await startRealtimeListening(null);
    if (!started) return;

    // Nobody spoke. In push mode that closes the mic and hands the turn back. In open mode the
    // turn still ends, but the mic only steps down to `armed` -- closing it would break the
    // promise that they can just start talking whenever they're ready.
    later(() => {
      if (!realtimeActiveCaptureRef.current || realtimeSpeechSeenRef.current) return;
      realtimeActiveCaptureRef.current = false;
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
      if (micWindowRef.current !== "armed") return;
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
    sendRealtimeEvent({ type: "response.cancel" });
    sendRealtimeEvent({ type: "output_audio_buffer.clear" });
    resolveRealtimeSpeaking();
  }

  function interruptSpeaking() {
    if (!realtimeInterruptibleRef.current || turnStateRef.current !== "speaking") {
      return;
    }

    const channel = realtimeChannelRef.current;
    const staticPlaying = staticAudioRef.current !== null;
    if (!staticPlaying && (!channel || channel.readyState !== "open")) {
      return;
    }

    realtimeInterruptedRef.current = true;
    realtimeInterruptibleRef.current = false;
    setInterruptible(false);

    if (staticPlaying) {
      stopStaticAudio(true);
    } else {
      sendRealtimeEvent({ type: "response.cancel" });
      sendRealtimeEvent({ type: "output_audio_buffer.clear" });
      resolveRealtimeSpeaking();
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
    if (!unaided || closing || calloutSpokenRef.current || unaidedRunRef.current < 2) return null;
    calloutSpokenRef.current = true;
    return "twice in a row now — and you didn't reach for help once.";
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
    const channel = realtimeChannelRef.current;

    if (!connected || !channel || channel.readyState !== "open") {
      vlog("listen", "REFUSED: connected:", connected, "channel:", channel?.readyState ?? "none");
      return false;
    }

    // A newer press superseded this one, or the mic is already open: nothing to do.
    if (
      (pressSession !== null && pressSessionRef.current !== pressSession) ||
      realtimeActiveCaptureRef.current
    ) {
      vlog(
        "listen",
        "SKIPPED:",
        realtimeActiveCaptureRef.current ? "already capturing" : "press superseded",
        "| press:", pressSession,
        "| current:", pressSessionRef.current,
      );
      return true;
    }
    vlog("listen", "OPENING capture, resumingSpeech:", options.resumingSpeech === true);
    applyTranscriptionLanguage(expectsEnglishAnswerNow() ? "en" : "es");

    const { resumingSpeech = false } = options;
    clearTimers();
    setRoomNote(null);
    setLastTranscript(null);
    realtimeTranscriptFinalRef.current = false;
    // A new capture supersedes any transcript the previous one was still waiting on.
    awaitingTranscriptRef.current = false;
    if (!resumingSpeech) {
      realtimeTranscriptRef.current = "";
    }
    realtimeSpeechActiveRef.current = resumingSpeech;
    realtimeSpeechSeenRef.current = resumingSpeech;
    realtimeActiveCaptureRef.current = true;
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
    if (!realtimeActiveCaptureRef.current) {
      vlog("finish", "IGNORED: no active capture (manual:", manual, ")");
      return;
    }
    vlog("finish", "closing capture, manual:", manual, "| speechSeen:", realtimeSpeechSeenRef.current);
    // Set BEFORE the mic window closes below: the transcript for this capture is still to come,
    // and the accumulation guard must not mistake it for stray room noise.
    awaitingTranscriptRef.current = true;
    realtimeActiveCaptureRef.current = false;
    holdingRef.current = false;
    clearTimers();
    setTurn("thinking");
    // Closes the mic: "thinking" never derives to armed, so this also covers open mode.
    syncRealtimeMic();

    const speechSeen = realtimeSpeechSeenRef.current;
    if (manual && realtimeSpeechActiveRef.current) {
      // May already have been committed by VAD; either way we wait for the transcript in flight.
      sendRealtimeEvent({ type: "input_audio_buffer.commit" });
    }
    realtimeSpeechActiveRef.current = false;

    const transcript = await new Promise<string>((resolve) => {
      if (realtimeTranscriptFinalRef.current) {
        resolve(realtimeTranscriptRef.current.trim());
        return;
      }

      vlog("finish", "waiting for transcript, timeout:", speechSeen ? 6000 : 2000, "ms");
      realtimeCaptureResolveRef.current = resolve;
      realtimeCaptureTimerRef.current = window.setTimeout(
        () => {
          vlog("finish", "TIMED OUT waiting for transcript; using:", JSON.stringify(realtimeTranscriptRef.current));
          resolveRealtimeCapture(realtimeTranscriptRef.current);
        },
        speechSeen ? 6000 : 2000,
      );
    });

    vlog("finish", "transcript:", JSON.stringify(transcript), "| speechSeen:", speechSeen);
    awaitingTranscriptRef.current = false;

    // Voice activity was never detected during this capture, yet a transcript came back --
    // almost certainly a hallucination from background noise, not a real reply. There's no
    // graded confidence signal on the realtime path, so VAD is the only gate available.
    if (!transcript.trim() || !speechSeen) {
      vlog(
        "finish",
        "DISCARDED as dud —",
        !speechSeen ? "server VAD never reported speech (threshold too high?)" : "transcript came back empty",
        "| transcript:", JSON.stringify(transcript),
      );
      registerDudCapture();
      setTurn("ready");
      syncRealtimeMic();
      return;
    }

    // Nothing but "um" -- they are still thinking, and the microphone mistook a pause for an
    // ending. Give the time back instead of treating it as an answer.
    if (isFillerOnly(transcript.trim())) {
      fillerRetriesRef.current += 1;
      vlog("filler", "hesitation-only capture", fillerRetriesRef.current, JSON.stringify(transcript.trim()));

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
    setLastTranscript(transcript.trim());
    // No graded confidence tier exists on the realtime path -- VAD is the only signal, and it
    // already passed the gate above.
    routeCapturedTranscript(transcript.trim(), false);
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
          mode === "stung"
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

  async function handleOpeningAttempt(attempt: string) {
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
            mode: mode === "stung" ? "stung" : "speaks-first",
            openingAnswer: attempt,
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

  async function startFirstSession() {
    if (!placementRescue || !placementSummary) {
      closeOverlay();
      setRoomNote("the verdict needs one more answer first.");
      setTurnState("ready");
      return;
    }

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
    setSaveStatus("idle");
    setLastReviewUrl(null);
    setTurnState("thinking");
    setRoomNote(null);

    try {
      const first = await readJson<ConverseReply>(
        await fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            originalText: placementSummary,
            scenarioContext:
              mode === "stung"
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
            mode === "stung"
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
  async function enterAside(trigger: "learner" | "offered") {
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

    try {
      const first = await readJson<ConverseReply>(
        await fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            originalText: carriedOver,
            scenarioContext: scenarioEn,
            // Without this the new scene inherits the old situation: the route treats
            // scenarioContext as background and anchors turn 0 in originalText, which still
            // describes the place the learner just told us is not their problem.
            sceneIsNew: true,
            context: { ...defaultConversationContext, who },
            rescue: placementRescue,
            pressureMode,
          }),
        }),
      );
      if (previousConversationId) {
        void fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close", conversationId: previousConversationId }),
        }).catch(() => undefined);
      }
      showCoachReply(first, `okay, you are with ${character.name} now.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OutLoud could not set up that scene.";
      // The old scene is still live on the server, so falling back into it is a real recovery.
      leaveAside(null);
      setRoomNote(`${message} we stayed where we were.`);
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
          }),
        }),
      );
      setSavedMomentId(response.momentId);
      setLastReviewUrl(response.reviewUrl);
      setSaveStatus("saved");
      return response.momentId;
    } catch {
      setSaveStatus("error");
      return null;
    }
  }

  // Words are the thing the account exists for, so they are pushed on every save.
  async function saveWordBank(momentId: string | null) {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const words = [
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
    setAuthIntent(intent);
    setAuthOpen(true);
  }

  function stashVerdictForAuth() {
    if (!placementRescue) return;
    const snapshot: VerdictSnapshot = {
      mode,
      openingAnswer,
      placementSummary,
      placementAttempts,
      placementRescue,
      coachLoot,
      coachEvidence,
      reportedBlocker,
    };
    try {
      window.localStorage.setItem(pendingVerdictKey, JSON.stringify(snapshot));
    } catch {
      // Storage blocked: OAuth still works, the card just won't restore after the redirect.
    }
  }

  function restoreVerdictAfterAuth(email: string) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(pendingVerdictKey);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      window.localStorage.removeItem(pendingVerdictKey);
    } catch {
      // Removal failing is harmless; parsing below still guards the shape.
    }
    try {
      const snapshot = JSON.parse(raw) as VerdictSnapshot;
      if (!snapshot.placementRescue) return;
      setMode(snapshot.mode);
      setOpeningAnswer(snapshot.openingAnswer);
      setPlacementAttempts(snapshot.placementAttempts);
      setPlacementRescue(snapshot.placementRescue);
      setPlacementSummary(snapshot.placementSummary);
      setCoachLoot(snapshot.coachLoot);
      setCoachEvidence(snapshot.coachEvidence);
      // Older snapshots (written before the coach classified this) have no field; "not_sure"
      // would assert a hypothesis the learner never gave, so an absent value stays null.
      setReportedBlocker(snapshot.reportedBlocker ?? null);
      setPlacementEvaluations([]);
      setFlowPhase("verdict");
      setTurnState("ready");
      setOverlay("verdict");
      setReturnEmail(email);
      setPendingAutoSaveEmail(email);
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
    restoreVerdictAfterAuthRef.current = restoreVerdictAfterAuth;
  });

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
      // Restore is a no-op unless a pre-redirect snapshot is waiting in localStorage.
      if (email) restoreVerdictAfterAuthRef.current(email);
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
    if (realtimeActiveCaptureRef.current) applyVadProfile("capture");
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
    if ((overlay || typedFallbackOpen) && realtimeActiveCaptureRef.current) {
      realtimeActiveCaptureRef.current = false;
      holdingRef.current = false;
      turnStateRef.current = "ready";
      setTurnState("ready");
    }
    // Re-derived rather than force-closed: an overlay closing in open mode should re-arm the mic.
    syncRealtimeMic();
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
      realtimeDebugRef.current = window.localStorage.getItem("outloud-debug-realtime") === "1";
    } catch {
      // Storage blocked: tracing simply stays off.
    }
    // Toggling without a reload, and a dump that does not depend on the console being open or
    // unfiltered when the events happened.
    store.__outloudVoiceDebug = (on = true) => {
      realtimeDebugRef.current = on;
      try {
        window.localStorage.setItem("outloud-debug-realtime", on ? "1" : "0");
      } catch {
        // Non-fatal: tracing still works for this page load.
      }
      return `voice tracing ${on ? "ON" : "off"}`;
    };
    store.__outloudVoiceDump = () => (store.__outloudVoiceLog ?? []).join(String.fromCharCode(10)) || "(nothing recorded)";
    if (realtimeDebugRef.current) {
      console.log("%c[voice] tracing ON — run __outloudVoiceDump() to copy the log", "color:#c1440e");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.outloudHydrated = "true";

    return () => {
      delete document.documentElement.dataset.outloudHydrated;
    };
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      stopMediaStream();
      stopStaticAudio(false);
      disconnectRealtime();
    },
    // Run once on unmount; cleanup reads refs, not render-time values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    disconnectRealtime();
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
    vlog("hold", "stopping | realtime capture:", realtimeActiveCaptureRef.current, "| recorder:", mediaRecorderRef.current?.state ?? "none");

    clearTimers();
    holdingRef.current = false;
    setTurnState("thinking");

    if (realtimeActiveCaptureRef.current) {
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

    if (retryTarget) {
      await submitRetryAttempt(trimmed, inputMode, lowConfidence);
      return;
    }

    if (flowPhase === "opening") {
      await handleOpeningAttempt(trimmed);
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
          {/* Signed out, the profile page has nothing to show but an empty state, so the icon
              opens the sign-in dialog directly instead of routing there first. */}
          {authedEmail ? (
            <Link className="profile-pill" href="/profile" aria-label="your profile">
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
          className={`room-orb-wrap ${turnState}`}
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

        <section className="room-copy" aria-label="Current room prompt">
          <p className={isUserTurn ? "turn-label is-user" : "turn-label"}>
            {roomLabel}
          </p>
          {roomSubcopy ? <p className="turn-subcopy">{roomSubcopy}</p> : null}
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
                    setTypedFallbackOpen(false);
                    setTranscriptNeedsConfirm(false);
                    void enterAside("learner");
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
                <div className="aside-thread">
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
                        realtimeActiveCaptureRef.current = false;
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
            <OrbCanvas state="idle" className="landing-orb" size={440} />
            <h1>you understand Spanish. you just can&apos;t speak it.</h1>
            <p className="landing-subcopy">
              talk to an AI coach that figures out exactly what&apos;s holding you back
              {" — "}and fixes it.
            </p>
            <button
              className="primary-action"
              type="button"
              onClick={() => enterRoom("speaks-first")}
            >
              start talking.
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => enterRoom("stung")}
            >
              didn&apos;t know how to say something? &rarr;
            </button>
            <p className="microcopy">90 seconds. no signup. just talk.</p>
          </section>
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
              <section className="room-sheet verdict-card" aria-label="Verdict">
                <p className="verdict-kicker">what OutLoud heard</p>
                {/*
                  This used to be the sentence above, hardcoded -- the same claim for every
                  learner, printed where a diagnosis belongs. It is now the model's read of what
                  they said trips them up against what actually happened (#46). The old string
                  survives only as the fallback for moments saved before the field existed.
                */}
                <h2>
                  {placementRescue?.stated_vs_observed?.line_en ||
                    "you have enough Spanish. the gap is getting it out fast enough."}
                </h2>
                {/*
                  Telling someone their own read was wrong is the highest-stakes sentence in the
                  app, so it never stands alone: when the verdict contradicts or complicates what
                  they said, the evidence for it is shown right underneath.
                */}
                {(placementRescue?.stated_vs_observed?.result === "correct" ||
                  placementRescue?.stated_vs_observed?.result === "both") &&
                placementRescue.observed_blocker.evidence ? (
                  <p className="verdict-evidence">{placementRescue.observed_blocker.evidence}</p>
                ) : null}
                {momentAfter ? (
                  <div className="verdict-moment">
                    <span>your moment</span>
                    {momentBefore && momentBefore.userAttempt !== momentAfter.userAttempt ? (
                      <p className="moment-before">&ldquo;{momentBefore.userAttempt}&rdquo;</p>
                    ) : null}
                    <p className="moment-after">&ldquo;{momentAfter.userAttempt}&rdquo;</p>
                    <small>
                      {momentBefore && momentBefore.userAttempt !== momentAfter.userAttempt
                        ? "same session, a few replies apart."
                        : "you said this today — out loud."}
                    </small>
                  </div>
                ) : null}
                {lootItems.length ? (
                  <div className="verdict-loot">
                    <span>what you reached for</span>
                    <ul>
                      {lootItems.map((item) => (
                        <li key={item.es}>
                          <strong>{item.es}</strong>
                          {item.en ? <small>{item.en}</small> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="verdict-plan">
                  <span>next time</span>
                  <p>same words, new situation — let&apos;s see if they come out on their own.</p>
                </div>
                <div className="verdict-account">
                  {authedEmail ? (
                    <>
                      <p className="capture-sub">signed in as {authedEmail}.</p>
                      <button
                        className="account-button"
                        type="button"
                        disabled={returnEmailStatus === "saving"}
                        onClick={() => {
                          setReturnEmail(authedEmail);
                          void saveReturnEmail(authedEmail);
                        }}
                      >
                        {returnEmailStatus === "saved"
                          ? "words saved — see you tomorrow"
                          : returnEmailStatus === "saving"
                            ? "saving"
                            : "save today's words"}
                      </button>
                      {returnEmailStatus === "saved" ? (
                        <Link className="quiet-link" href="/dashboard">
                          see all your words &rarr;
                        </Link>
                      ) : null}
                      <button className="quiet-link" type="button" onClick={signOut}>
                        sign out
                      </button>
                    </>
                  ) : (
                    <>
                  {/*
                    This used to say the words "disappear when you close this", which is both an
                    understatement and the wrong problem. The run IS saved -- with whatever email
                    is given and `user_id: null` -- but reading anything back goes through
                    `getAuthedUser`, so without an account OutLoud greets a returning learner as a
                    stranger while their practice sits in the database. Someone hit exactly that.
                    So the card now says what an account does, why the line is drawn at a login,
                    and that signing up on the same address claims what is already there (which
                    /api/library really does, on first load).
                  */}
                  <p className="capture-sub">
                    nothing here comes back on its own. an account is what lets OutLoud remember
                    you — what trips you up, every session, all of it.
                  </p>
                  <button className="account-button" type="button" onClick={() => openAuth("signup")}>
                    create a free account
                  </button>
                  <p className="capture-fineprint">
                    your practice is tied to a login, not to a typed-in address — otherwise anyone
                    who guessed your email could read it. sign up with the same address and
                    everything you already saved comes with you.
                  </p>
                  <button
                    className="quiet-link"
                    type="button"
                    onClick={() => setEmailFallbackOpen((current) => !current)}
                  >
                    or just email me a link to this one
                  </button>
                  {emailFallbackOpen ? (
                    <div className="email-capture verdict-capture">
                      <div>
                        <input
                          id="verdict-email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          aria-label="email for your words"
                          placeholder="you@example.com"
                          value={returnEmail}
                          onChange={(event) => {
                            setReturnEmail(event.target.value);
                            setReturnEmailStatus("idle");
                          }}
                        />
                        <button
                          type="button"
                          disabled={!returnEmail.trim() || returnEmailStatus === "saving"}
                          onClick={() => void saveReturnEmail()}
                        >
                          {returnEmailStatus === "saving" ? "saving" : "save them"}
                        </button>
                      </div>
                      {returnEmailStatus === "saved" ? (
                        <small>sent. that link opens this session only — it won&apos;t know you next time.</small>
                      ) : null}
                      {returnEmailStatus === "error" ? <small>couldn&apos;t save yet. try once more.</small> : null}
                    </div>
                  ) : null}
                    </>
                  )}
                </div>
                <button className="sheet-primary" type="button" onClick={() => void startFirstSession()}>
                  start the conversation
                </button>
              </section>
            ) : null}

              {overlay === "after" ? (
              <section className="room-sheet after-card" aria-label="After session">
                <p className="verdict-kicker">today&apos;s line</p>
                <h2>{todayLine || "you got the conversation started."}</h2>
                <div className="after-stack">
                  <article>
                    <span>changed today</span>
                    <p>{afterDelta}</p>
                  </article>
                  <article>
                    <span>almost there</span>
                    <p>{tomorrowWork}</p>
                  </article>
                  <article className="return-hook">
                    <span>{tomorrowLabel()}</span>
                    <p>we&apos;ll bring this back in a new situation, with a little less help.</p>
                  </article>
                </div>
                <p className="sheet-note sage-note">
                  if it comes up with someone tonight, try just this line.
                </p>
                {saveStatus !== "idle" ? (
                  <p className="tiny-note">
                    {saveStatus === "saving"
                      ? "saving this run."
                      : saveStatus === "saved"
                        ? lastReviewUrl
                          ? "saved with a private return link."
                          : "saved."
                        : "could not save this run yet."}
                  </p>
                ) : null}
                <div className="email-capture">
                  {/*
                    Was "want me to bring this back tomorrow?" -- a promise an email alone cannot
                    keep. It buys a private token link to this one session; being remembered is a
                    different thing and needs an account.
                  */}
                  <label htmlFor="return-email">email me a link back to this session</label>
                  <div>
                    <input
                      id="return-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={returnEmail}
                      onChange={(event) => {
                        setReturnEmail(event.target.value);
                        setReturnEmailStatus("idle");
                      }}
                    />
                    <button
                      type="button"
                      disabled={!returnEmail.trim() || returnEmailStatus === "saving"}
                      onClick={() => void saveReturnEmail()}
                    >
                      {returnEmailStatus === "saving" ? "sending" : "send it"}
                    </button>
                  </div>
                  {returnEmailStatus === "saved" ? <small>sent — that link opens this session.</small> : null}
                  {returnEmailStatus === "error" ? <small>couldn&apos;t save yet. try once more.</small> : null}
                </div>
                {authedEmail ? null : (
                  <div className="account-nudge">
                    <p>
                      OutLoud won&apos;t know you next time without an account. that&apos;s the
                      only way it keeps what trips you up and picks up where you stopped — and it
                      takes the same email you just used.
                    </p>
                    <button className="account-button" type="button" onClick={() => openAuth("signup")}>
                      create a free account
                    </button>
                  </div>
                )}
                <div className="sheet-split-actions">
                  <button type="button" onClick={() => setOverlay("transcript")}>
                    review transcript
                  </button>
                  <button type="button" onClick={() => void startFirstSession()}>
                    keep going
                  </button>
                </div>
                {/*
                  The only way into "what OutLoud knows about you". That card and the evidence
                  card behind it opened each other and nothing else opened either -- a closed loop
                  with no door, so the surface that is supposed to prove the app remembers your
                  problem (#50) could not be reached at all. The end of a session is the right
                  door: it is the moment the learner is already looking at what just happened.
                */}
                <button className="sheet-link sage-link" type="button" onClick={() => setOverlay("profile")}>
                  what OutLoud knows about you
                </button>
                <button
                  className="sheet-primary"
                  type="button"
                  onClick={() => {
                    closeOverlay();
                    setMode("landing");
                    setTurnState("speaking");
                  }}
                >
                  done
                </button>
              </section>
            ) : null}

              {overlay === "feedback" ? (
              <section className="room-sheet" aria-label="Feedback">
                {/* eyes off is a mode, not a per-turn action, so it lives here rather than in the
                    session tool row. The header pill this sheet opens from is already its indicator. */}
                <button
                  className={eyesOffMode ? "quiet-link is-active" : "quiet-link"}
                  type="button"
                  aria-pressed={eyesOffMode}
                  onClick={() => setEyesOffMode((current) => !current)}
                >
                  {eyesOffMode ? "eyes off is on — turn it off" : "switch to eyes off"}
                </button>
                {feedbackDone ? (
                  <div className="feedback-complete">
                    <span className="complete-mark">✓</span>
                    <h2>that actually changes what we build next. thanks.</h2>
                    <p>{feedbackSaved ? "saved." : "back to the room"}</p>
                    <button className="sheet-primary" type="button" onClick={closeOverlay}>
                      done
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="feedback-progress">
                      <span>{feedbackStep + 1} of {activeFeedbackQuestions.length}</span>
                      <span className="feedback-dashes">
                        {activeFeedbackQuestions.map((item, index) => (
                          <span
                            className={index <= feedbackStep ? "is-current" : ""}
                            key={item.key}
                          />
                        ))}
                      </span>
                    </div>
                    <h2>{activeFeedback.question}</h2>
                    {activeFeedback.note ? <p className="sheet-note">{activeFeedback.note}</p> : null}
                    {activeFeedback.options.length ? (
                      <div className="feedback-options">
                        {activeFeedback.options.map((option, index) => (
                          <button
                            className={feedbackPick === index ? "is-picked" : ""}
                            key={option}
                            type="button"
                            onClick={() => setFeedbackPick(index)}
                          >
                            <span>{feedbackPick === index ? "✓" : ""}</span>
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <textarea
                      className="feedback-input"
                      aria-label={activeFeedback.placeholder}
                      placeholder={activeFeedback.placeholder}
                      value={feedbackText}
                      onChange={(event) => setFeedbackText(event.target.value)}
                    />
                    {(feedbackPick !== null || activeFeedback.options.length === 0) ? (
                      <button
                        className="sheet-primary"
                        type="button"
                        disabled={feedbackSubmitting}
                        onClick={() => void submitFeedbackAnswer(false)}
                      >
                        {feedbackSubmitting
                          ? "sending"
                          : feedbackStep === activeFeedbackQuestions.length - 1
                            ? "send feedback"
                            : "continue"}
                      </button>
                    ) : null}
                    <button
                      className="sheet-link"
                      type="button"
                      disabled={feedbackSubmitting}
                      onClick={() => void submitFeedbackAnswer(true)}
                    >
                      skip this question
                    </button>
                  </>
                )}
              </section>
            ) : null}

            {overlay === "profile" ? (
              <section className="room-sheet" aria-label="What OutLoud knows about you">
                <h2>what OutLoud knows about you</h2>
                <div className="skill-list">
                  {profileRows.length === 0 ? (
                    <p className="page-body">
                      nothing observed yet — one conversation turn and your thing shows up here.
                    </p>
                  ) : null}
                  {profileRows.map((row, index) => (
                    <button
                      key={row.blocker}
                      type="button"
                      onClick={() => {
                        setProfileEvidenceIndex(index);
                        setOverlay("evidence");
                      }}
                    >
                      <span>{row.name}</span>
                      <strong className={row.tone}>{row.state}</strong>
                      <em>›</em>
                    </button>
                  ))}
                </div>
                <div className="teaching-note">keywords unlock you; full answers make you dependent.</div>
                <div className="sheet-split-actions">
                  <button type="button" onClick={() => setOverlay("journey")}>
                    speaking journey
                  </button>
                  <button type="button" onClick={() => setOverlay("pressure")}>
                    how she speaks
                  </button>
                </div>
              </section>
            ) : null}

            {overlay === "journey" ? (
              <section className="room-sheet" aria-label="Speaking journey">
                <h2>your speaking journey</h2>
                <div className="journey-list">
                  {journeyRows.map(([label, status, note]) => (
                    <div className={`journey-row ${status}`} key={label}>
                      <span>{status === "done" ? "✓" : ""}</span>
                      <p>
                        {label}
                        {note ? <small>{note}</small> : null}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {overlay === "evidence" ? (
              <section className="room-sheet" aria-label="Evidence">
                <h2>{activeEvidence?.name ?? "nothing observed yet"}</h2>
                <div className="evidence-card">
                  <p>{activeEvidence?.evidence || "OutLoud needs one more reply before it keeps this."}</p>
                  <small>{activeEvidence?.state ?? "not enough yet"}</small>
                </div>
                <button className="sheet-link sage-link" type="button" onClick={() => setOverlay("profile")}>
                  why OutLoud thinks this
                </button>
              </section>
            ) : null}

            {overlay === "transcript" ? (
              <section className="room-sheet" aria-label="Transcript review">
                <h2>review transcript</h2>
                <div className="transcript-list">
                  {sessionTurns.length ? (
                    sessionTurns.map((turn, index) => (
                      <article key={`${turn.characterLineEs}-${index}`}>
                        <span>her</span>
                        <p>{turn.characterLineEs}</p>
                        <span>you</span>
                        <p>{turn.userAttempt}</p>
                        {turn.evaluation?.correctedAttemptEs ? (
                          <>
                            <span>natural version</span>
                            <p>{turn.evaluation.correctedAttemptEs}</p>
                          </>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <article>
                      <p>finish one conversation turn and this will show what happened.</p>
                    </article>
                  )}
                </div>
                <button className="sheet-link sage-link" type="button" onClick={() => setOverlay("after")}>
                  back
                </button>
              </section>
            ) : null}

            {overlay === "pressure" ? (
              <section className="room-sheet" aria-label="Pressure">
                <h2>how real should it feel?</h2>
                <div className="pressure-list">
                  <button
                    className={toneMode === "patient" ? "is-active" : ""}
                    type="button"
                    onClick={() => setToneMode("patient")}
                  >
                    patient
                  </button>
                  <button
                    className={toneMode === "real" ? "is-active" : ""}
                    type="button"
                    onClick={() => setToneMode("real")}
                  >
                    real person
                  </button>
                  <button
                    className={toneMode === "pressure" ? "is-active" : ""}
                    type="button"
                    onClick={() => setToneMode("pressure")}
                  >
                    under pressure
                  </button>
                </div>
                <p className="sheet-note sage-note">
                  {toneMode === "pressure"
                    ? "more interruptions, real curveballs, less waiting."
                    : toneMode === "patient"
                      ? "same pace as real person for now — a calmer mode is coming."
                      : "some interruptions. natural follow-ups. a little less waiting."}
                </p>
                <p className="tiny-note">you can change this anytime.</p>
              </section>
            ) : null}

            {overlay === "assistance" ? (
              <section className="room-sheet" aria-label="Assistance ladder">
                <h2>a little help</h2>
                <div className="ladder-list">
                  {assistanceLadder.map((rung) => (
                    <button
                      className={rung.name === currentAssistanceRung ? "is-current" : ""}
                      type="button"
                      key={rung.name}
                    >
                      <span>{rung.name}</span>
                      <strong>{rung.label}</strong>
                      {rung.sample ? <em>{rung.sample}</em> : null}
                    </button>
                  ))}
                </div>
                {/*
                  Without this the reordered ladder just looks arbitrary -- two learners see a
                  different order and neither is told why. It is one sentence and it is the whole
                  point of #48: the help is shaped by what was diagnosed.
                */}
                {assistanceRationale ? <p className="ladder-why">{assistanceRationale}</p> : null}
                <div className="sheet-split-actions">
                  <button type="button" onClick={() => setOverlay("correction")}>
                    fix the sentence
                  </button>
                  <button type="button" onClick={() => setOverlay("pronunciation")}>
                    say it clearer
                  </button>
                </div>
              </section>
            ) : null}

            {overlay === "correction" ? (
              <section className="room-sheet" aria-label="Correction">
                <h2>one correction</h2>
                <div className="correction-stack">
                  <div>
                    <span>gap</span>
                    <p>{activeCorrection.gap}</p>
                  </div>
                  <div>
                    <span>pattern</span>
                    <p>{activeCorrection.pattern}</p>
                  </div>
                  <div className="natural-line">
                    <span>natural version</span>
                    <p>{activeCorrection.naturalVersion || "finish one reply and this will fill in."}</p>
                  </div>
                </div>
                {activePronunciationTarget ? (
                  <button
                    type="button"
                    className="quiet-link"
                    onClick={() => setOverlay("pronunciation")}
                  >
                    pronunciation also affected clarity — practice it →
                  </button>
                ) : null}
                {lastTranscriptionConfidence === "borderline" ? (
                  <p className="tiny-note">this was hard to hear clearly — the correction above may be less reliable.</p>
                ) : null}
                {correctionRetryResult ? (
                  <p className="sheet-note sage-note">{correctionRetryResult.conciseFeedbackEn}</p>
                ) : null}
                <button
                  className="sheet-primary"
                  type="button"
                  disabled={!activeCorrection.naturalVersion}
                  onClick={startCorrectionRetry}
                >
                  say it back
                </button>
                <p className="tiny-note">
                  {activeCorrection.naturalVersion
                    ? `say: ${activeCorrection.naturalVersion}`
                    : "OutLoud needs one reply first."}
                </p>
              </section>
            ) : null}

            {overlay === "pronunciation" ? (
              <section className="room-sheet" aria-label="Pronunciation">
                <h2>make it clear</h2>
                <div className="syllable-row">
                  {activePronunciationSyllables.map((part, index) => (
                    <button
                      className={index === (activePronunciationTarget?.stressedSyllableIndex ?? 1) ? "is-stressed" : ""}
                      type="button"
                      key={`${part}-${index}`}
                    >
                      {part}
                    </button>
                  ))}
                </div>
                <div className="pronunciation-panel">
                  <span>intelligibility only</span>
                  <p>{pronunciationResult?.coachingNoteEn ?? activePronunciationTarget?.word ?? activeCorrection.naturalVersion}</p>
                </div>
                <button
                  className="sheet-primary"
                  type="button"
                  disabled={!activeCorrection.naturalVersion && !activePronunciationTarget?.word}
                  onClick={startPronunciationRetry}
                >
                  try again
                </button>
                {retryTarget?.kind === "pronunciation" ? (
                  <button
                    className="quiet-link"
                    type="button"
                    onClick={() => {
                      setRetryTarget(null);
                      restoreCurrentTurn("Back to the conversation.");
                      setOverlay(null);
                    }}
                  >
                    that&apos;s enough for now
                  </button>
                ) : null}
                <p className="tiny-note">go as many times as you want.</p>
              </section>
            ) : null}

            {overlay === "ask" ? (
              <section className="room-sheet" aria-label="Ask anything">
                <h2>ask anything</h2>
                <p className="sheet-note">quick question, then back to this turn.</p>
                <textarea
                  className="ask-box"
                  aria-label="ask a question"
                  placeholder="ask in English"
                  value={askDraft}
                  onChange={(event) => {
                    setAskDraft(event.target.value);
                    setAskStatus("idle");
                  }}
                />
                {askAnswer ? (
                  <div className="correction-stack">
                    <div className="natural-line">
                      <span>use this</span>
                      <p>{askAnswer.options[0]?.spanish ?? askAnswer.fallbackFrameEs}</p>
                    </div>
                    <div>
                      <span>means</span>
                      <p>{askAnswer.options[0]?.meaningEn ?? askAnswer.noteEn}</p>
                    </div>
                    <div>
                      <span>frame</span>
                      <p>{askAnswer.fallbackFrameEs}</p>
                    </div>
                  </div>
                ) : null}
                {askStatus === "error" ? (
                  <p className="sheet-note">OutLoud could not answer that yet. Try it shorter.</p>
                ) : null}
                <button
                  className="sheet-primary"
                  type="button"
                  disabled={!askDraft.trim() || askStatus === "asking"}
                  onClick={() => void submitAskQuestion()}
                >
                  {askStatus === "asking" ? "asking" : askAnswer ? "ask another" : "ask"}
                </button>
                <button className="sheet-link sage-link" type="button" onClick={closeOverlay}>
                  back to the room
                </button>
              </section>
            ) : null}

            {overlay === "eyes-off" ? (
              <section className="room-sheet" aria-label="Eyes off mode">
                <h2>eyes off</h2>
                <div className="eyes-off-stack">
                  <button
                    type="button"
                    onClick={() => {
                      closeOverlay();
                      replayCoachLine(false);
                    }}
                  >
                    repeat that
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeOverlay();
                      replayCoachLine(true);
                    }}
                  >
                    slower pacing
                  </button>
                  <button type="button" onClick={() => setOverlay("assistance")}>
                    give me the next word
                  </button>
                </div>
                <button
                  className="sheet-primary"
                  type="button"
                  onClick={() => {
                    setEyesOffMode(false);
                    closeOverlay();
                  }}
                >
                  back to touch
                </button>
              </section>
            ) : null}
            </div>
          </div>
        ) : null}
      </section>
      {authOpen ? (
        <AuthDialog
          initialMode={authIntent}
          onClose={() => setAuthOpen(false)}
          onBeforeRedirect={stashVerdictForAuth}
          onAuthed={(email) => {
            setReturnEmail(email);
            void saveReturnEmail(email);
          }}
        />
      ) : null}
    </main>
  );
}
