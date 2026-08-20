"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { OrbCanvas } from "./components/OrbCanvas";
import { derivePracticeLedgerState } from "@/lib/learning-loop";
import { createInterventionOutcome } from "@/lib/teaching-policy";
import type { AssistanceUsed, AttemptEvaluation, FreezeSignals, RescueResponse } from "@/lib/types";
import { openingPrompt, staticAudioForText } from "@/lib/static-lines";
import type { CoachResponse } from "@/lib/coach-schema";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { resumeMomentKey, type ResumeMoment } from "@/lib/account-links";

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
  responseGuidanceEn: string;
  shouldClose?: boolean;
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

function inferSelfReportedBlocker(attempt: string) {
  return /\b(vocab|vocabulary|word|words|phrase|phrases)\b/i.test(attempt)
    ? "missing_words"
    : "not_sure";
}

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
function looksBrokenAttempt(attempt: string) {
  return (
    attempt.includes("...") ||
    /\b(uh|um|ehm|how do you say|the|and|you|want|is|was|do|don't|know)\b/i.test(attempt)
  );
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

const assistanceRungs = [
  ["wait", "a little more time", ""],
  ["nudge", "small clue", "think about who you're talking to"],
  ["keyword", "one useful word", "porque"],
  ["frame", "sentence shape", "me cuesta ___"],
  ["model answer", "hear it once", "me cuesta encontrar las palabras."],
];

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
};

function ProfileGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.8 20c1.1-3.6 3.9-5.4 7.2-5.4s6.1 1.8 7.2 5.4" strokeLinecap="round" />
    </svg>
  );
}

function AuthDialog({
  open,
  onClose,
  onAuthed,
  onBeforeRedirect,
}: {
  open: boolean;
  onClose: () => void;
  onAuthed: (email: string) => void;
  /** Runs right before the OAuth full-page redirect, to stash state that must survive it. */
  onBeforeRedirect?: () => void;
}) {
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!open) return null;
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
        <p>your word bank, saved — and brought back tomorrow in a new situation.</p>
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
  const pressStartedAtRef = useRef(0);
  const pressKindRef = useRef<"start" | "finish" | "interrupt" | null>(null);
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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [coachLine, setCoachLine] = useState<string | null>(null);
  const [coachMeaning, setCoachMeaning] = useState<string | null>(null);
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
  const [askDraft, setAskDraft] = useState("");
  const [askStatus, setAskStatus] = useState<"idle" | "asking" | "answered" | "error">("idle");
  const [askAnswer, setAskAnswer] = useState<LifelineResponse | null>(null);
  const [retryTarget, setRetryTarget] = useState<RetryTarget | null>(null);
  const [correctionRetryResult, setCorrectionRetryResult] = useState<AttemptEvaluation | null>(null);
  const [pronunciationResult, setPronunciationResult] = useState<PronunciationCoaching | null>(null);
  const [lastVoiceFreeze, setLastVoiceFreeze] = useState<FreezeSignals | null>(null);
  const [flowPhase, setFlowPhase] = useState<FlowPhase>("opening");
  const [openingAnswer, setOpeningAnswer] = useState("");
  const [coachId, setCoachId] = useState<string | null>(null);
  const [coachTurn, setCoachTurn] = useState<CoachResponse | null>(null);
  // Words and frames the coach handed over during this session -- the learner's loot.
  const [coachLoot, setCoachLoot] = useState<Array<{ es: string; en: string | null }>>([]);
  // Per-turn coach observations, passed to /api/rescue so the card matches the actual session.
  const [coachEvidence, setCoachEvidence] = useState<string[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
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
  const isUserTurn = turnState === "ready" || turnState === "listening" || turnState === "still-listening";
  const orbState =
    turnState === "still-listening"
      ? "still-listening"
      : turnState === "ready"
        ? "ready"
        : turnState;
  const roomLabel = {
    ready: "your turn",
    listening: "listening",
    "still-listening": "still listening",
    thinking: "thinking",
    speaking: "speaking",
  }[turnState];
  const roomSubcopy = {
    ready: "tap the orb to speak",
    listening: "just talk — tap when you're done",
    "still-listening": "take your time",
    thinking: "putting that together",
    speaking: interruptible ? "tap the orb to interrupt" : "",
  }[turnState];
  const holdLabel = {
    ready: "tap the orb to talk",
    listening: "tap when you're done",
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
  const showSessionTools =
    !isLanding && flowPhase === "session" && !typedFallbackOpen && turnState !== "thinking";
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
  const profileRows = [
    {
      name: "finding words",
      state: latestSessionEvaluation?.observedBlocker.type === "vocabulary_retrieval" ? "working on it now" : "watching",
      tone: latestSessionEvaluation?.observedBlocker.type === "vocabulary_retrieval" ? "terracotta" : "sage",
      evidence:
        latestSessionEvaluation?.observedBlocker.type === "vocabulary_retrieval"
          ? latestSessionEvaluation.observedBlocker.evidence
          : placementRescue?.observed_blocker.evidence,
    },
    {
      name: "building sentences",
      state: latestSessionEvaluation?.observedBlocker.type === "sentence_assembly" ? "working on it now" : "improving",
      tone: latestSessionEvaluation?.observedBlocker.type === "sentence_assembly" ? "terracotta" : "sage",
      evidence: latestSessionEvaluation?.conciseFeedbackEn ?? placementRescue?.one_correction,
    },
    {
      name: "follow-up replies",
      state: sessionTurns.length ? "seen in session" : "not enough yet",
      tone: sessionTurns.length ? "terracotta" : "sage",
      evidence: sessionTurns[0]
        ? `"${sessionTurns[0].userAttempt}"`
        : "OutLoud needs one conversation turn before it keeps this.",
    },
    {
      name: "pronunciation",
      state: (latestSessionEvaluation?.pronunciationTargets.length ?? placementRescue?.pronunciationTargets.length ?? 0) > 0 ? "has a target" : "no clear issue",
      tone: (latestSessionEvaluation?.pronunciationTargets.length ?? placementRescue?.pronunciationTargets.length ?? 0) > 0 ? "terracotta" : "sage",
      evidence:
        latestSessionEvaluation?.pronunciationTargets[0]?.word ??
        placementRescue?.pronunciationTargets[0]?.word ??
        "No pronunciation target came back from the engine.",
    },
  ];
  const activeEvidence = profileRows[profileEvidenceIndex] ?? profileRows[0];
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

  function disableRealtimeMic() {
    realtimeStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }

  function disconnectRealtime() {
    realtimeActiveCaptureRef.current = false;
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
      pressureMode: false,
    };
  }

  function handleRealtimeEvent(event: RealtimeServerEvent) {
    const type = event.type ?? "";

    if (type === "error") {
      if (event.error?.code && ignorableRealtimeErrorCodes.has(event.error.code)) {
        return;
      }
      realtimeFallbackRef.current = true;
      resolveRealtimeCapture(realtimeTranscriptRef.current);
      resolveRealtimeSpeaking();
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      realtimeSpeechActiveRef.current = true;
      realtimeSpeechSeenRef.current = true;
      // The learner started talking, so the idle timeout no longer applies.
      clearTimers();
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

    if (typeof event.delta === "string" && type.includes("input_audio_transcription.delta")) {
      realtimeTranscriptRef.current += event.delta;
    }

    if (typeof event.transcript === "string" && type.includes("input_audio_transcription")) {
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
      return realtimeConnectPromiseRef.current;
    }

    const requestBody = realtimeRequestFor(nextMode);
    if (!requestBody) return false;

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
          if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            realtimeFallbackRef.current = true;
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        stream.getAudioTracks().forEach((track) => {
          track.enabled = false;
          peer.addTrack(track, stream);
        });

        const channel = peer.createDataChannel("oai-events");
        channel.addEventListener("message", (message) => {
          try {
            handleRealtimeEventRef.current(JSON.parse(message.data) as RealtimeServerEvent);
          } catch {
            // Ignore malformed transport events; the app state is driven by our engine.
          }
        });
        channel.addEventListener("error", () => {
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

        return true;
      } catch {
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
    options: { onDone?: () => void; autoListen?: boolean; interruptible?: boolean; slow?: boolean } = {},
  ) {
    const { onDone, autoListen = true, interruptible: canInterrupt = true, slow = false } = options;
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
        setTurnState("ready");
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
        setTurnState("ready");
        onDone?.();
      }, fallbackDelay);
      return;
    }

    // If a previous line is still being generated or played out, cut it before starting the
    // next one -- otherwise the new text shows while the old audio keeps talking.
    if (realtimeSpeakingResolveRef.current || realtimeOutputAudioActiveRef.current) {
      try {
        channel.send(JSON.stringify({ type: "response.cancel" }));
        channel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
      } catch {
        // Channel may be closing; the connection state handler takes over.
      }
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

    channel.send(
      JSON.stringify({
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
      }),
    );

    await finishedSpeaking;
    realtimeInterruptibleRef.current = false;
    setInterruptible(false);

    if (realtimeInterruptedRef.current) {
      // The learner tapped in; interruptSpeaking() already opened the mic.
      realtimeInterruptedRef.current = false;
      onDone?.();
      return;
    }

    setTurnState("ready");
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

    // Nobody spoke: hand the turn back to the learner instead of listening to a silent room forever.
    later(() => {
      if (!realtimeActiveCaptureRef.current || realtimeSpeechSeenRef.current) return;
      realtimeActiveCaptureRef.current = false;
      holdingRef.current = false;
      disableRealtimeMic();
      setRoomNote("tap the orb whenever you're ready.");
      setTurnState("ready");
    }, autoListenIdleMs);
  }

  // Stops whatever the coach is saying (clip or live) without opening the mic.
  function cancelSpeaking() {
    if (turnStateRef.current !== "speaking") return;
    const channel = realtimeChannelRef.current;
    realtimeInterruptedRef.current = true;
    realtimeInterruptibleRef.current = false;
    setInterruptible(false);
    if (staticAudioRef.current) {
      stopStaticAudio(true);
      return;
    }
    if (channel?.readyState === "open") {
      try {
        channel.send(JSON.stringify({ type: "response.cancel" }));
        channel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
      } catch {
        // Connection state handler takes over if the channel is gone.
      }
    }
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
      try {
        channel?.send(JSON.stringify({ type: "response.cancel" }));
        channel?.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
      } catch {
        // If the channel dropped mid-line the connection state handler takes over.
      }
      resolveRealtimeSpeaking();
    }

    void startRealtimeListening(null).then((listening) => {
      if (!listening) setTurnState("ready");
    });
  }

  function currentRealtimeMode() {
    return flowPhase === "session" && placementRescue ? "conversation" : "intake";
  }

  async function startRealtimeListening(pressSession: number | null) {
    const connected = await ensureRealtime(currentRealtimeMode());
    const channel = realtimeChannelRef.current;

    if (!connected || !channel || channel.readyState !== "open") {
      return false;
    }

    // A newer press superseded this one, or the mic is already open: nothing to do.
    if (
      (pressSession !== null && pressSessionRef.current !== pressSession) ||
      realtimeActiveCaptureRef.current
    ) {
      return true;
    }

    clearTimers();
    setRoomNote(null);
    setLastTranscript(null);
    realtimeTranscriptRef.current = "";
    realtimeTranscriptFinalRef.current = false;
    realtimeSpeechActiveRef.current = false;
    realtimeSpeechSeenRef.current = false;
    realtimeActiveCaptureRef.current = true;
    holdingRef.current = true;
    realtimeStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    setTurnState("listening");

    later(() => {
      setTurnState((current) => (current === "listening" ? "still-listening" : current));
    }, 2200);

    return true;
  }

  // manual = the learner tapped/released to end the turn. Otherwise server VAD ended it and the
  // buffer is already committed.
  async function finishRealtimeListening(manual: boolean) {
    if (!realtimeActiveCaptureRef.current) return;
    realtimeActiveCaptureRef.current = false;
    holdingRef.current = false;
    clearTimers();
    disableRealtimeMic();
    setTurnState("thinking");

    const speechSeen = realtimeSpeechSeenRef.current;
    const channel = realtimeChannelRef.current;
    if (manual && realtimeSpeechActiveRef.current && channel?.readyState === "open") {
      try {
        channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      } catch {
        // WebRTC may have already committed via VAD; wait for any transcript already in flight.
      }
    }
    realtimeSpeechActiveRef.current = false;

    const transcript = await new Promise<string>((resolve) => {
      if (realtimeTranscriptFinalRef.current) {
        resolve(realtimeTranscriptRef.current.trim());
        return;
      }

      realtimeCaptureResolveRef.current = resolve;
      realtimeCaptureTimerRef.current = window.setTimeout(
        () => {
          resolveRealtimeCapture(realtimeTranscriptRef.current);
        },
        speechSeen ? 6000 : 2000,
      );
    });

    if (!transcript.trim()) {
      setRoomNote("nothing came through. tap the orb to try again, or type.");
      setTurnState("ready");
      return;
    }

    setLastTranscript(transcript.trim());
    await submitAttempt(transcript.trim(), "spoken");
  }

  function later(callback: () => void, delay: number) {
    const timer = window.setTimeout(callback, delay);
    timers.current.push(timer);
  }

  function showCoachReply(reply: ConverseReply) {
    clearTimers();
    setConversationId(reply.conversationId);
    setTurnIndex(reply.turnIndex);
    setCoachLine(reply.characterLineEs);
    setCoachMeaning(reply.characterMeaningEn);
    setCurrentConversationTurn(reply);
    setRoomNote(reply.responseGuidanceEn || null);
    setTurnState("speaking");
    void speakCoachText(reply.characterLineEs, "conversation", 1800, {
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
    const selfReportedBlocker = inferSelfReportedBlocker(`${openingText} ${combinedAttempt}`);

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
        who: mode === "stung" ? "a real person from the learner's situation" : defaultConversationContext.who,
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
  }

  function showCoachTurn(turn: CoachResponse) {
    clearTimers();
    setCoachTurn(turn);
    collectCoachLoot(turn);
    setCoachLine(turn.sayEs);
    setCoachLineFolded(false);
    // Framing/scenario turns are already English; a "meaning" line under them is just noise.
    setCoachMeaning(turn.phase === "framing" || turn.phase === "scenario" ? null : turn.meaningEn);
    setRoomNote(null);
    setTurnState("speaking");
    void speakCoachText(turn.sayEs, "intake", 1400, {
      slow: turn.tool.type === "slow_repeat",
      // Preparation time means: no mic until they tap. Everything else hands the turn over.
      autoListen: turn.tool.type !== "preparation_time",
    });
  }

  async function handleCoachAttempt(attempt: string, inputMode: "spoken" | "written") {
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
        setCoachMeaning(next.meaningEn);
        setTurnState("speaking");
        void speakCoachText(next.sayEs, "intake", 1400, { autoListen: false, interruptible: false });
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
              who: mode === "stung" ? "a real person from the learner's situation" : defaultConversationContext.who,
            },
            rescue: placementRescue,
            pressureMode: false,
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

  async function evaluateSessionAttempt(attempt: string, turn: ConverseReply) {
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
            who: mode === "stung" ? "a real person from the learner's situation" : defaultConversationContext.who,
          },
          rescue: placementRescue,
          attempt,
          inputMode: "spoken",
          stage: "changed_context",
          assistanceUsed: "none",
          conversationTurn: {
            characterLineEs: turn.characterLineEs,
            characterMeaningEn: turn.characterMeaningEn,
            expectedCommunicativeFunction: turn.expectedCommunicativeFunction ?? "continue the conversation",
          },
          variation: null,
        }),
      }),
    );
  }

  function restoreCurrentTurn(note: string) {
    if (currentConversationTurn) {
      setCoachLine(currentConversationTurn.characterLineEs);
      setCoachMeaning(currentConversationTurn.characterMeaningEn);
    }
    setRoomNote(note);
    setTurnState("ready");
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
    setCoachMeaning("say this back once, then we return to the conversation.");
    setRoomNote("tap the orb and say it back.");
    setTurnState("ready");
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
    setCoachMeaning("make it clear enough to understand.");
    setRoomNote("tap the orb and say it once.");
    setTurnState("ready");
  }

  async function submitRetryAttempt(attempt: string, inputMode: "spoken" | "written") {
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

        if (result.intelligible || nextAttempts >= 2) {
          setRetryTarget(null);
          restoreCurrentTurn(`${result.coachingNoteEn} Back to the conversation.`);
          return;
        }

        setRetryTarget({ ...target, attempts: nextAttempts });
        setCoachLine(target.phraseEs);
        setCoachMeaning(target.phraseMeaningEn);
        setRoomNote(`${result.coachingNoteEn} Try it one more time.`);
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
      setCoachMeaning(target.phraseMeaningEn);
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
    const selfReportedBlocker = inferSelfReportedBlocker(`${openingAnswer} ${placementSummary}`);

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
              who: mode === "stung" ? "a real person from the learner's situation" : defaultConversationContext.who,
            },
            selfReportedBlocker,
            selfReportedBlockers: [selfReportedBlocker],
            teachingPolicy: null,
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
      setCoachMeaning(null);
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
      disableRealtimeMic();
      setTurnState("ready");
    }
  }, [overlay, typedFallbackOpen]);

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
    setRoomNote(null);
    setLastTranscript(null);
    setFlowPhase("opening");
    setOpeningAnswer("");
    setCoachId(null);
    setCoachTurn(null);
    setCoachLoot([]);
    setCoachEvidence([]);
    setEmailFallbackOpen(false);
    setPlacementAttempts([]);
    setPlacementRescue(null);
    setPlacementEvaluations([]);
    setPlacementSummary("");
    setCurrentConversationTurn(null);
    setSessionTurns([]);
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
    setProfileEvidenceIndex(0);
    setSavedMomentId(null);
    setSaveStatus("idle");
    setLastReviewUrl(null);
    setCoachLine(nextMode === "stung" ? null : openingPrompt);
    setCoachMeaning(null);
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
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
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

      if (await startRealtimeListening(pressSession)) {
        return;
      }

      if (typeof MediaRecorder === "undefined") {
        setRoomNote("voice is not available here. typing works too.");
        setTypedFallbackOpen(true);
        setTurnState("ready");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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
      return;
    }

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

    pressKindRef.current = null;
  }

  function handleOrbRelease() {
    const kind = pressKindRef.current;
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
      const voiceAttempt = await readJson<{ transcript: string; freeze: FreezeSignals }>(
        await fetch("/api/transcribe", { method: "POST", body: formData }),
      );
      const transcript = voiceAttempt.transcript.trim();
      if (!transcript) {
        throw new Error("nothing came through.");
      }
      setLastTranscript(transcript);
      setLastVoiceFreeze(voiceAttempt.freeze);
      await submitAttempt(transcript, "spoken");
    } catch (error) {
      const message = error instanceof Error ? error.message : "voice did not come through.";
      setRoomNote(`${message} typing works too.`);
      setTurnState("ready");
    }
  }

  async function submitAttempt(attempt: string, inputMode: "spoken" | "written" = "written") {
    const trimmed = attempt.trim();
    if (!trimmed) return;

    clearTimers();
    setTypedFallbackOpen(false);
    setTypedAttempt("");
    setTurnState("thinking");

    if (retryTarget) {
      await submitRetryAttempt(trimmed, inputMode);
      return;
    }

    if (flowPhase === "opening") {
      await handleOpeningAttempt(trimmed);
      return;
    }

    if (flowPhase === "coach") {
      await handleCoachAttempt(trimmed, inputMode);
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
      const evaluationPromise = repliedTo
        ? evaluateSessionAttempt(trimmed, repliedTo).catch(() => null)
        : Promise.resolve(null);
      const next = await readJson<ConverseReply>(
        await fetch("/api/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "respond",
            conversationId,
            turnIndex,
            userAttempt: trimmed,
            repairRequested: false,
            pressureMode: false,
          }),
        }),
      );
      const evaluation = await evaluationPromise;
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
      showCoachReply(next);
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
              setConversationId(null);
              setCoachLine(null);
              setCoachMeaning(null);
              setLastTranscript(null);
              setRoomNote(null);
              setEyesOffMode(false);
              setCurrentConversationTurn(null);
              setSessionTurns([]);
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
          <Link className="profile-pill" href="/profile" aria-label="your profile">
            {(authedEmail ?? "").slice(0, 1).toUpperCase() || <ProfileGlyph />}
          </Link>
        </header>

        <button
          className={`room-orb-wrap ${turnState}`}
          type="button"
          aria-label={holdLabel}
          disabled={
            isLanding ||
            Boolean(overlay) ||
            typedFallbackOpen ||
            turnState === "thinking" ||
            (turnState === "speaking" && !interruptible)
          }
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
              <h2>I can&apos;t hear you yet.</h2>
              <p>type it instead — we&apos;ll keep going.</p>
              <textarea
                aria-label="what were you trying to say?"
                placeholder="what were you trying to say?"
                value={typedAttempt}
                onChange={(event) => setTypedAttempt(event.target.value)}
              />
              <button type="button" onClick={() => void submitAttempt(typedAttempt)}>
                send
              </button>
              <button className="quiet-link" type="button" onClick={() => setTypedFallbackOpen(false)}>
                try voice again
              </button>
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
                  {coachMeaning ? <p className="room-translation">{coachMeaning}</p> : null}
                  {coachTool ? (
                    <CoachToolCard
                      tool={coachTool}
                      onPick={(label) => {
                        // Tapping a direction is the answer: stop talking/listening and send it.
                        cancelSpeaking();
                        realtimeActiveCaptureRef.current = false;
                        holdingRef.current = false;
                        disableRealtimeMic();
                        void submitAttempt(label, "written");
                      }}
                    />
                  ) : null}
                  {roomNote ? <p className="room-note">{roomNote}</p> : null}
                  {flowPhase === "verdict" && !overlay ? (
                    <button className="reopen-card" type="button" onClick={() => setOverlay("verdict")}>
                      see your card again &rarr;
                    </button>
                  ) : null}
                  {flowPhase === "session" && coachLine ? (
                    <div className="audio-actions" aria-label="Audio controls">
                      <button type="button">🔊 hear again</button>
                      <button type="button">🐢 slower</button>
                    </div>
                  ) : null}
                  {showSessionTools ? (
                    <div className="session-tools" aria-label="Session tools">
                      <button type="button" onClick={() => setOverlay("assistance")}>
                        help
                      </button>
                      <button type="button" onClick={() => setOverlay("correction")}>
                        fix
                      </button>
                      <button type="button" onClick={() => setOverlay("pronunciation")}>
                        pronounce
                      </button>
                      <button type="button" onClick={() => setOverlay("ask")}>
                        ask
                      </button>
                      <button
                        className={eyesOffMode ? "is-active" : ""}
                        type="button"
                        aria-pressed={eyesOffMode}
                        onClick={() => setEyesOffMode((current) => !current)}
                      >
                        eyes off
                      </button>
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
                <h2>you have enough Spanish. the gap is getting it out fast enough.</h2>
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
                  <p className="capture-sub">
                    these words disappear when you close this. keep them — and get them back tomorrow in a new
                    situation.
                  </p>
                  <button className="account-button" type="button" onClick={() => setAuthOpen(true)}>
                    create a free account
                  </button>
                  <button
                    className="quiet-link"
                    type="button"
                    onClick={() => setEmailFallbackOpen((current) => !current)}
                  >
                    or just email me the words
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
                      {returnEmailStatus === "saved" ? <small>saved. see you tomorrow.</small> : null}
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
                  <label htmlFor="return-email">want me to bring this back tomorrow?</label>
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
                  {returnEmailStatus === "saved" ? <small>saved for tomorrow.</small> : null}
                  {returnEmailStatus === "error" ? <small>couldn&apos;t save yet. try once more.</small> : null}
                </div>
                <div className="sheet-split-actions">
                  <button type="button" onClick={() => setOverlay("transcript")}>
                    review transcript
                  </button>
                  <button type="button" onClick={() => void startFirstSession()}>
                    keep going
                  </button>
                </div>
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
                  {profileRows.map((row, index) => (
                    <button
                      key={row.name}
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
                <h2>{activeEvidence.name}</h2>
                <div className="evidence-card">
                  <p>{activeEvidence.evidence ?? "OutLoud needs one more reply before it keeps this."}</p>
                  <small>{activeEvidence.state}</small>
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
                  <button type="button">patient</button>
                  <button className="is-active" type="button">real person</button>
                  <button type="button">under pressure</button>
                </div>
                <p className="sheet-note sage-note">
                  some interruptions. natural follow-ups. a little less waiting.
                </p>
                <p className="tiny-note">you can change this anytime.</p>
              </section>
            ) : null}

            {overlay === "assistance" ? (
              <section className="room-sheet" aria-label="Assistance ladder">
                <h2>a little help</h2>
                <div className="ladder-list">
                  {assistanceRungs.map(([name, label, sample], index) => (
                    <button className={index === 2 ? "is-current" : ""} type="button" key={name}>
                      <span>{name}</span>
                      <strong>{label}</strong>
                      {sample ? <em>{sample}</em> : null}
                    </button>
                  ))}
                </div>
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
                <p className="tiny-note">two tries max.</p>
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
                  <button type="button">repeat that</button>
                  <button type="button">slower pacing</button>
                  <button type="button">give me the next word</button>
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
      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onBeforeRedirect={stashVerdictForAuth}
        onAuthed={(email) => {
          setReturnEmail(email);
          void saveReturnEmail(email);
        }}
      />
    </main>
  );
}
