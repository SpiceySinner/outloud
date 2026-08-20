import { freezePhraseForBlocker } from "@/lib/observation-facts";
import { normalizeObservedBlocker } from "@/lib/blocker-taxonomy";
import type {
  AssistanceUsed,
  AttemptEvaluation,
  ConversationTurnEvidence,
  FocusGap,
  FreezeSignals,
  InterventionOutcome,
  RescueResponse,
  RetrievalVariation,
  SavedMoment,
  VoiceAttempt,
} from "@/lib/types";

export const assistanceRank: Record<AssistanceUsed, number> = {
  full_model: 6,
  sentence_frame: 5,
  english_explanation: 4,
  slower_audio: 3,
  repeat: 2,
  keyword: 1,
  none: 0,
};

export const meaningRank: Record<AttemptEvaluation["meaningResult"] | RescueResponse["meaning_result"], number> = {
  skipped: 0,
  insufficient_evidence: 0,
  unclear: 1,
  partial: 2,
  clear: 3,
};

export const ledgerRank: Record<SavedMoment["ledgerState"], number> = {
  needed_full_help: 0,
  needed_hint: 1,
  answered_on_own: 2,
  used_new_situation: 3,
  confirmed_real_life: 4,
};

export const ledgerLabels: Record<SavedMoment["ledgerState"], string> = {
  needed_full_help: "Needed full help",
  needed_hint: "Needed a hint",
  answered_on_own: "Answered on my own",
  used_new_situation: "Used in a new situation",
  confirmed_real_life: "Confirmed in real life",
};

export function derivePracticeLedgerState(
  rebuildEvaluation: AttemptEvaluation | null,
  transferEvaluation: AttemptEvaluation | null,
): SavedMoment["ledgerState"] {
  if (transferEvaluation?.meaningResult === "clear" && transferEvaluation.usedTargetChunk) return "used_new_situation";
  if (rebuildEvaluation?.meaningResult === "clear" && rebuildEvaluation.assistanceUsed === "none") return "answered_on_own";
  if (rebuildEvaluation?.meaningResult === "clear" || rebuildEvaluation?.assistanceUsed === "keyword") return "needed_hint";
  return "needed_full_help";
}

export function deriveReviewLedgerState(
  transferEvaluation: Pick<AttemptEvaluation, "meaningResult" | "usedTargetChunk" | "assistanceUsed"> | null,
): SavedMoment["ledgerState"] {
  if (
    transferEvaluation?.meaningResult === "clear" &&
    transferEvaluation.usedTargetChunk &&
    transferEvaluation.assistanceUsed === "none"
  ) {
    return "confirmed_real_life";
  }
  if (transferEvaluation?.meaningResult === "clear" && transferEvaluation.usedTargetChunk) return "used_new_situation";
  if (transferEvaluation?.meaningResult === "clear" || transferEvaluation?.assistanceUsed === "keyword") return "needed_hint";
  return "needed_full_help";
}

export function nextReviewAt(baseMs: number, ledgerState: SavedMoment["ledgerState"], isDeepLinkReview: boolean) {
  const days = isDeepLinkReview ? reviewSpacingDaysAfterReview(ledgerState) : 1;
  return new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export function reviewSpacingDaysAfterReview(ledgerState: SavedMoment["ledgerState"]) {
  if (ledgerState === "confirmed_real_life") return 7;
  if (ledgerState === "used_new_situation") return 5;
  if (ledgerState === "answered_on_own") return 3;
  return 2;
}

export function assistanceForMoment(moment: SavedMoment): AssistanceUsed {
  return (
    moment.focusGap?.helpRequired ??
    moment.transferEvaluation?.assistanceUsed ??
    moment.rebuildEvaluation?.assistanceUsed ??
    "full_model"
  );
}

export function resultForMoment(moment: SavedMoment): AttemptEvaluation["meaningResult"] | RescueResponse["meaning_result"] {
  return (
    moment.focusGap?.retryResult ??
    moment.transferEvaluation?.meaningResult ??
    moment.rebuildEvaluation?.meaningResult ??
    moment.rescue.meaning_result
  );
}

export function evidenceForMoment(moment: SavedMoment) {
  if (moment.focusGap?.evidence) return moment.focusGap.evidence;
  const beforeStart = moment.attemptVoice?.freeze.timeToFirstWordSeconds;
  const afterStart = moment.retryVoice?.freeze.timeToFirstWordSeconds;
  if (moment.rebuildEvaluation?.meaningResult !== "clear" && moment.transferEvaluation?.meaningResult === "clear") {
    return "Meaning became clearer";
  }
  if (
    moment.rebuildEvaluation?.assistanceUsed &&
    moment.rebuildEvaluation.assistanceUsed !== "none" &&
    moment.transferEvaluation?.assistanceUsed === "none"
  ) {
    return "Needed less help";
  }
  if (typeof beforeStart === "number" && typeof afterStart === "number" && afterStart < beforeStart) {
    return "Started sooner";
  }
  if (moment.transferEvaluation?.usedTargetChunk) return "Used the pattern in a new situation";
  if (moment.rebuildEvaluation?.meaningResult === "clear") return "Rebuilt the meaning";
  return "Not enough comparable evidence yet";
}

export function evidenceForArc(earliest: SavedMoment, latest: SavedMoment, count: number) {
  if (count > 1 && assistanceRank[assistanceForMoment(latest)] < assistanceRank[assistanceForMoment(earliest)]) {
    return `${formatAssistance(assistanceForMoment(earliest))} -> ${formatAssistance(assistanceForMoment(latest))}`;
  }
  if (count > 1 && meaningRank[resultForMoment(latest)] > meaningRank[resultForMoment(earliest)]) {
    return "Meaning became clearer";
  }
  if (latest.ledgerState !== earliest.ledgerState && ledgerRank[latest.ledgerState] > ledgerRank[earliest.ledgerState]) {
    return `${ledgerLabels[earliest.ledgerState]} -> ${ledgerLabels[latest.ledgerState]}`;
  }
  if (latest.transferEvaluation?.usedTargetChunk) return "Used the pattern in a new situation";
  if (latest.focusGap?.source === "conversation") return "Saved the exact conversation break";
  return evidenceForMoment(latest);
}

export function describeFreezeChange(before: FreezeSignals, after: FreezeSignals) {
  const beforeStart = before.timeToFirstWordSeconds;
  const afterStart = after.timeToFirstWordSeconds;
  if (typeof beforeStart === "number" && typeof afterStart === "number") {
    if (afterStart < beforeStart) {
      return {
        label: "started sooner",
        detail: `first try: ${beforeStart}s to start. retry: ${afterStart}s.`,
      };
    }
    if (afterStart === beforeStart) {
      return {
        label: "same start speed",
        detail: `both tries started in ${afterStart}s. Check the sentence quality next.`,
      };
    }
    return {
      label: "needed more time",
      detail: `first try: ${beforeStart}s to start. retry: ${afterStart}s. That can happen when you remove hints.`,
    };
  }
  return {
    label: "recording compared",
    detail: `first try: ${beforeStart ?? "?"}s to start. retry: ${afterStart ?? "?"}s.`,
  };
}

export function formatAssistance(value: AssistanceUsed) {
  return value.replace(/_/g, " ");
}

export type SessionComparisonInput = {
  attemptVoice: VoiceAttempt | null;
  interventionOutcomes: InterventionOutcome[];
  conversationTurns: ConversationTurnEvidence[];
};

export type SessionComparisonResult =
  | { kind: "none" }
  | { kind: "baseline"; label: string; detail: string }
  | { kind: "comparison"; label: string; detail: string };

/**
 * `createInterventionOutcome` logs one entry per evaluated stage regardless of whether
 * any assistance was actually shown, so raw `.length` is not "hints used." Only outcomes
 * where `assistanceAfter` is not "none" reflect real help given.
 */
function countRealHints(outcomes: InterventionOutcome[] | undefined) {
  return (outcomes ?? []).filter((outcome) => outcome.assistanceAfter !== "none").length;
}

/**
 * A turn only counts as genuinely "handled" if the user's answer wasn't just the
 * full-model answer being read back -- otherwise `meaningResult: "clear"` reflects the
 * model's words, not the user's independent handling of the follow-up.
 */
function hasIndependentlyHandledFollowUp(turns: ConversationTurnEvidence[] | undefined) {
  return (turns ?? []).some(
    (turn) => turn.userEvaluation?.meaningResult === "clear" && turn.userEvaluation.assistanceUsed !== "full_model",
  );
}

/**
 * Compares the current (not-yet-saved) moment against the user's own saved history.
 * Every fact is derived directly from stored fields -- nothing here is inferred or
 * estimated. If a fact isn't computable from the data, it's left out rather than guessed.
 */
export function buildSessionComparison(
  current: SessionComparisonInput,
  priorMoments: SavedMoment[],
): SessionComparisonResult {
  const priorMoment = priorMoments[0] ?? null;

  if (!priorMoment) {
    const facts: string[] = [];
    const startSeconds = current.attemptVoice?.freeze.timeToFirstWordSeconds;
    if (typeof startSeconds === "number") facts.push(`${Math.round(startSeconds)}s to first word`);
    const hintCount = countRealHints(current.interventionOutcomes);
    facts.push(hintCount === 1 ? "1 hint" : `${hintCount} hints`);
    if (facts.length === 0) return { kind: "none" };
    return {
      kind: "baseline",
      label: "baseline set",
      detail: `${facts.join(", ")} — everything from here is beating this.`,
    };
  }

  const facts: string[] = [];

  const currentStart = current.attemptVoice?.freeze.timeToFirstWordSeconds;
  const priorStart = priorMoment.attemptVoice?.freeze.timeToFirstWordSeconds;
  if (typeof currentStart === "number" && typeof priorStart === "number") {
    const delta = Math.round(priorStart - currentStart);
    if (delta > 0) facts.push(`${delta} second${delta === 1 ? "" : "s"} faster to start`);
    else if (delta < 0) facts.push(`${Math.abs(delta)} second${Math.abs(delta) === 1 ? "" : "s"} slower to start`);
  }

  const currentHints = countRealHints(current.interventionOutcomes);
  const priorHints = countRealHints(priorMoment.interventionOutcomes);
  const hintDelta = priorHints - currentHints;
  if (hintDelta > 0) {
    facts.push(hintDelta === 1 ? "one fewer hint" : `${hintDelta} fewer hints`);
  } else if (hintDelta < 0) {
    const more = Math.abs(hintDelta);
    facts.push(more === 1 ? "one more hint" : `${more} more hints`);
  }

  const hasClearFollowUpNow = hasIndependentlyHandledFollowUp(current.conversationTurns);
  const hadClearFollowUpBefore = priorMoments.some((moment) => hasIndependentlyHandledFollowUp(moment.conversationTurns));
  if (hasClearFollowUpNow && !hadClearFollowUpBefore) {
    facts.push("you handled your first unexpected follow-up");
  }

  if (facts.length === 0) return { kind: "none" };
  return {
    kind: "comparison",
    label: "compared to last time",
    detail: `${facts.join(" · ")}.`,
  };
}

/**
 * Builds the single line of context shown at the start of a retrieval session (the private
 * spaced-retrieval email link), connecting today's Pass 3 target back to the stored gap from
 * last time. Deliberately says "last time" rather than "yesterday" -- `reviewSpacingDaysAfterReview`
 * (above) schedules repeat reviews 2/3/5/7 days out depending on ledgerState, and
 * `MomentReviewSeed` doesn't carry the original moment's date, so there's no way to compute
 * actual elapsed time. Every clause is derived directly from stored fields -- `focusGap.evidence`
 * (real text) and `focusGap.gapType` (normalized through the same `normalizeObservedBlocker` map
 * used by the "I've noticed" card, via the shared `freezePhraseForBlocker` phrase table) plus
 * `transferPrompt.targetCommunicativeFunction`. If any of those pieces is missing, this
 * returns `null` rather than falling back to a generic line -- an honest line beats a filler
 * one.
 */
export function buildRetrievalContextLine(
  focusGap: FocusGap | null,
  transferPrompt: RetrievalVariation | null,
): string | null {
  if (!focusGap || !transferPrompt) return null;
  const evidence = focusGap.evidence?.trim();
  if (!evidence) return null;

  const normalized = normalizeObservedBlocker(focusGap.gapType);
  if (normalized === "insufficient_evidence") return null;

  const lastTimePhrase = freezePhraseForBlocker[normalized];
  if (!lastTimePhrase) return null;

  const todayPhrase = transferPrompt.targetCommunicativeFunction.trim().toLowerCase();
  if (!todayPhrase) return null;

  return `today: ${todayPhrase} — because last time you froze on ${lastTimePhrase} (${evidence}).`;
}
