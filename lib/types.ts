export type EntryMode = "wanted_to_say" | "received_spanish";

export type RescueContext = {
  who: string;
  dialect: string;
  tone: string;
};

export type SelfReportedBlocker =
  | "words_to_sentences"
  | "freeze_under_pressure"
  | "missing_words"
  | "pronunciation_nerves"
  | "sounds_unnatural"
  | "grammar_falls_apart"
  | "follow_ups_break_me"
  | "not_sure";

export type BlockerType =
  | "vocabulary_retrieval"
  | "sentence_assembly"
  | "hesitation_pressure"
  | "pronunciation_intelligibility"
  | "grammar_control"
  | "naturalness_register"
  | "follow_up_pressure"
  | "insufficient_evidence";

export type InterventionType =
  | "keyword"
  | "sentence_frame"
  | "full_model"
  | "english_explanation"
  | "slow_audio"
  | "phrase_by_phrase_audio"
  | "shadowing"
  | "preparation_time"
  | "conversation_repair_phrase"
  | "changed_context_example"
  | "unexpected_follow_up";

export type InterventionOutcome = {
  intervention: InterventionType;
  stage:
    | "initial_attempt"
    | "guided_repair"
    | "independent_rebuild"
    | "changed_context"
    | "conversation_follow_up"
    | "delayed_retrieval";
  helped: boolean | null;
  assistanceBefore: AssistanceUsed;
  assistanceAfter: AssistanceUsed;
  evidence: string;
  timestamp: string;
};

export type TeachingPolicySnapshot = {
  selectedHypotheses: SelfReportedBlocker[];
  primaryObservedBlocker: BlockerType;
  secondaryObservedBlockers: BlockerType[];
  initialIntervention: InterventionType;
  assistanceOrder: AssistanceUsed[];
  nextAssistanceLevel: AssistanceUsed;
  rationaleEn: string;
};

export type PersonalTeachingModel = {
  effectiveInterventions: InterventionType[];
  ineffectiveInterventions: InterventionType[];
  fullAnswerDependencySigns: number;
  idealPreparationSeconds: number | null;
  nextAssistanceLevel: AssistanceUsed;
  learnerVisibleNotes: string[];
  userCorrections: TeachingModelCorrection[];
  updatedAt: string;
};

export type TeachingModelCorrection = {
  id: string;
  text: string;
  createdAt: string;
};

export type RescueRequest = {
  entryMode: EntryMode;
  /**
   * The target message the user tried to say or understand. Scenario setup belongs in
   * scenarioContext so starter prompts are never mistaken for the user's intended phrase.
   */
  originalText: string;
  scenarioContext?: string | null;
  context: RescueContext;
  selfReportedBlocker: SelfReportedBlocker | null;
  selfReportedBlockers?: SelfReportedBlocker[];
  attempt: string;
  skippedAttempt: boolean;
  voiceAttempt?: VoiceAttempt | null;
};

export type RescueResponse = {
  confirmed_intent: {
    english: string;
    spanish: string;
  };
  intended_meaning_check: string;
  meaning_result: "clear" | "partial" | "unclear" | "skipped";
  observed_blocker: {
    type: string;
    confidence: "low" | "medium" | "high";
    evidence: string;
    explanation_en: string;
  };
  one_correction: string;
  primary_correction: {
    original_fragment: string;
    corrected_fragment: string;
    explanation_en: string;
  };
  actionable_feedback: {
    issueType: BlockerType;
    observedEvidence: string;
    explanationEn: string;
    nextActionEn: string;
    targetFragmentEs: string | null;
    correctedFragmentEs: string | null;
  };
  natural_version: string;
  important_phrase: {
    spanish: string;
    meaning_en: string;
  };
  transferableChunk: {
    patternEs: string;
    meaningEn: string;
    communicativeFunction: string;
    whyItHelpsEn: string;
    exampleFromMomentEs: string;
  };
  tone_note: string;
  spoken_note: string;
  dialect_version: string | null;
  pronunciationTargets: PronunciationTarget[];
};

export type FreezeSignals = {
  timeToFirstWordSeconds: number | null;
  hesitationCount: number;
  englishWordCount: number;
  summary: string;
};

export type VoiceAttempt = {
  transcript: string;
  freeze: FreezeSignals;
};

export type AssistanceUsed =
  | "full_model"
  | "sentence_frame"
  | "keyword"
  | "repeat"
  | "slower_audio"
  | "english_explanation"
  | "none";

export type AttemptEvaluation = {
  meaningResult: "clear" | "partial" | "unclear" | "insufficient_evidence";
  communicatedMeaningEn: string;
  missingMeaningEn: string | null;
  usedTargetChunk: boolean;
  correctedPrimaryIssue: boolean | null;
  assistanceUsed: AssistanceUsed;
  observedBlocker: {
    type:
      | "vocabulary_retrieval"
      | "sentence_assembly"
      | "grammar_control"
      | "hesitation_pressure"
      | "pronunciation_intelligibility"
      | "naturalness_register"
      | "follow_up_pressure"
      | "insufficient_evidence";
    confidence: "low" | "medium" | "high";
    evidence: string;
  };
  conciseFeedbackEn: string;
  /**
   * The user's attempt, repaired -- see attemptEvaluationSchema. Null when nothing needs fixing.
   *
   * Note for anyone reading a persisted evaluation: SavedMoment.userEvaluation is this same type
   * and is stored in localStorage and Supabase, where records written before this field existed
   * simply lack it. Nothing validates on read, so treat it as possibly undefined there. The
   * correction card is safe because it only ever renders a fresh API response.
   */
  correctedAttemptEs: string | null;
  pronunciationTargets: PronunciationTarget[];
};

export type PronunciationTarget = {
  word: string;
  syllables: string[];
  stressedSyllableIndex: number;
};

export type RetrievalVariation = {
  situationEn: string;
  roleEs: string;
  openingLineEs: string;
  openingMeaningEn: string;
  targetCommunicativeFunction: string;
  targetChunkPatternEs: string;
  changedElements: string[];
  expectedMeaningPoints: string[];
  difficultyReason: string;
};

export type ConversationMeaningChunk = {
  es: string;
  en: string;
};

export type ConverseResponse = {
  conversationId: string;
  turnIndex: number;
  characterLineEs: string;
  characterMeaningEn: string;
  meaningChunks: ConversationMeaningChunk[];
  keyWord: {
    es: string;
    en: string;
  } | null;
  expectedCommunicativeFunction: string;
  suggestedReplyFrameEs: string;
  suggestedReplyEs: string;
  responseGuidanceEn: string;
  shouldClose: boolean;
  closingReason: string | null;
  /**
   * True when this turn is the character expressing genuine non-comprehension of the user's
   * last reply, instead of a normal next line -- see lib/repair-loop.ts (`shouldTriggerRepair`,
   * client-side, decides *when*) and app/api/converse/route.ts (`generateTurn`, server-side,
   * decides *how to phrase it in character*). A repair turn is pinned to the SAME `turnIndex` as
   * the turn it's repairing, so misunderstandings never consume the bounded session budget.
   */
  isRepairTurn: boolean;
  /** Non-null only when `isRepairTurn` is true. See generateTurn's repair prompt for the definitions. */
  repairType: "non_comprehension" | "mishearing" | null;
};

export type ConversationTurnEvidence = ConverseResponse & {
  userAttempt?: string;
  userEvaluation?: AttemptEvaluation;
  freeze?: FreezeSignals;
};

export type FocusGap = {
  source: "conversation" | "changed_context" | "independent_rebuild" | "original_attempt";
  turnIndex: number | null;
  characterLineEs: string | null;
  characterMeaningEn: string | null;
  expectedCommunicativeFunction: string;
  userTranscript: string;
  gapType: string;
  helpRequired: AssistanceUsed;
  retryResult: AttemptEvaluation["meaningResult"] | RescueResponse["meaning_result"];
  evidence: string;
  createdAt: string;
};

/**
 * Outcome of one misunderstanding-and-repair sequence (lib/repair-loop.ts /
 * app/api/converse/route.ts's `isRepairTurn`) within a saved moment's conversation. A moment
 * has 0 sequences (nothing was misunderstood), 1 (gentle mode's per-conversation cap), or up to
 * 2 in Pressure Mode.
 */
export type RepairSequenceOutcome = {
  turnIndex: number;
  repairType: "non_comprehension" | "mishearing";
  failedAttempts: number;
  resolvedWithoutLifeline: boolean;
  createdAt: string;
};

export type SavedMoment = {
  id: string;
  sessionId?: string;
  email: string;
  originalText: string;
  entryMode: EntryMode;
  context: RescueContext;
  selfReportedBlocker: SelfReportedBlocker | null;
  selfReportedBlockers?: SelfReportedBlocker[];
  attempt: string;
  attemptTranscriptEdited: boolean;
  retry: string;
  rebuildEvaluation?: AttemptEvaluation;
  transferPrompt?: RetrievalVariation;
  transferAttempt?: string;
  transferEvaluation?: AttemptEvaluation;
  conversationTurns?: ConversationTurnEvidence[];
  /**
   * Client-side / local-storage only for now, like other recent additions -- not synced to
   * Supabase (see worker/index.ts, supabase/schema.sql `intervention_outcomes_json` for the
   * pattern to follow if remote sync is wanted later; skipped here as out of scope/risk for this
   * task given the conversation state itself is already ephemeral/in-memory server-side).
   */
  repairSequences?: RepairSequenceOutcome[];
  /**
   * Client-side / local-storage only for now, like repairSequences -- not synced to Supabase
   * and not represented in worker/index.ts or supabase/schema.sql. Adding a top-level remote
   * column in this task would risk breaking production moment saves before the column exists.
   */
  pressureModeUsed?: boolean;
  focusGap?: FocusGap;
  attemptVoice: VoiceAttempt | null;
  retryVoice: VoiceAttempt | null;
  rescue: RescueResponse;
  teachingPolicy?: TeachingPolicySnapshot;
  interventionOutcomes?: InterventionOutcome[];
  personalTeachingModel?: PersonalTeachingModel;
  ledgerState: "needed_full_help" | "needed_hint" | "answered_on_own" | "used_new_situation" | "confirmed_real_life";
  createdAt: string;
  reviewDueAt?: string;
  deepLinkMomentId?: string;
};
