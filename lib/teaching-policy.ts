import { assistanceRank } from "@/lib/learning-loop";
import { normalizeObservedBlocker } from "@/lib/blocker-taxonomy";
import type {
  AssistanceUsed,
  AttemptEvaluation,
  BlockerType,
  InterventionOutcome,
  InterventionType,
  PersonalTeachingModel,
  RescueResponse,
  SavedMoment,
  SelfReportedBlocker,
  TeachingModelCorrection,
  TeachingPolicySnapshot,
} from "@/lib/types";

export const blockerHypothesisMap: Record<SelfReportedBlocker, BlockerType> = {
  words_to_sentences: "sentence_assembly",
  freeze_under_pressure: "hesitation_pressure",
  missing_words: "vocabulary_retrieval",
  pronunciation_nerves: "pronunciation_intelligibility",
  sounds_unnatural: "naturalness_register",
  grammar_falls_apart: "grammar_control",
  follow_ups_break_me: "follow_up_pressure",
  not_sure: "insufficient_evidence",
};

const defaultAssistanceOrder: AssistanceUsed[] = [
  "none",
  "keyword",
  "repeat",
  "sentence_frame",
  "english_explanation",
  "slower_audio",
  "full_model",
];

const policyByBlocker: Record<BlockerType, { intervention: InterventionType; order: AssistanceUsed[]; rationale: string }> = {
  vocabulary_retrieval: {
    intervention: "keyword",
    order: ["keyword", "sentence_frame", "full_model"],
    rationale: "the word is what goes missing, so help starts with one word — not the whole answer.",
  },
  sentence_assembly: {
    intervention: "sentence_frame",
    order: ["keyword", "sentence_frame", "english_explanation", "full_model"],
    rationale: "you have the ideas; it is the shape that breaks. so you get the frame before you get the answer.",
  },
  hesitation_pressure: {
    intervention: "preparation_time",
    order: ["repeat", "keyword", "sentence_frame", "full_model"],
    rationale: "the freeze is part of it, so you get the question again and a way in before anything else.",
  },
  pronunciation_intelligibility: {
    intervention: "slow_audio",
    order: ["slower_audio", "repeat", "keyword", "sentence_frame", "full_model"],
    rationale: "a specific sound is getting in the way, so you hear it slowly first. this is not accent grading.",
  },
  grammar_control: {
    intervention: "english_explanation",
    order: ["english_explanation", "sentence_frame", "keyword", "full_model"],
    rationale: "one grammar contrast is doing the damage, so you get the reason first and try again right away.",
  },
  naturalness_register: {
    intervention: "changed_context_example",
    order: ["sentence_frame", "english_explanation", "keyword", "full_model"],
    rationale: "the meaning lands but the register does not, so you get wording that fits who you are talking to.",
  },
  follow_up_pressure: {
    intervention: "unexpected_follow_up",
    order: ["repeat", "keyword", "sentence_frame", "conversation_repair_phrase" as AssistanceUsed, "full_model"].filter(
      (value): value is AssistanceUsed => value !== ("conversation_repair_phrase" as AssistanceUsed),
    ),
    rationale: "your opening is fine; the follow-up is what breaks. so you hear the question again and answer that.",
  },
  insufficient_evidence: {
    intervention: "sentence_frame",
    order: defaultAssistanceOrder,
    rationale: "not enough seen yet to shape this, so help stays light and adjusts after your next reply.",
  },
};

export function toggleBlockerHypothesis(
  selected: SelfReportedBlocker[],
  value: SelfReportedBlocker,
): SelfReportedBlocker[] {
  if (value === "not_sure") return selected.includes("not_sure") ? [] : ["not_sure"];
  const withoutNotSure = selected.filter((item) => item !== "not_sure");
  return withoutNotSure.includes(value)
    ? withoutNotSure.filter((item) => item !== value)
    : [...withoutNotSure, value];
}

/**
 * Re-exported so existing `import { normalizeObservedBlocker } from "@/lib/teaching-policy"`
 * call sites keep working unchanged now that the implementation lives in the leaf module
 * `@/lib/blocker-taxonomy` (see that file's comment for why it moved).
 */
export { normalizeObservedBlocker };

/**
 * The assistance order for one blocker, in escalating strength. Same words -> the word first;
 * same sentence that will not assemble -> the shape first; a freeze -> time first.
 *
 * Read directly rather than through `chooseTeachingPolicy` because the room derives its focus
 * blocker from a richer chain than the rescue alone (it prefers `actionable_feedback.issueType`
 * and falls back to the learner's own hypothesis). Driving the ladder from anything else would
 * let the help order disagree with the focus line printed above it in the same room.
 */
export function assistanceOrderFor(blocker: BlockerType): AssistanceUsed[] {
  return policyByBlocker[blocker].order;
}

/** Why this blocker gets that order, in the product's voice. Shown under the ladder. */
export function teachingRationaleFor(blocker: BlockerType): string {
  return policyByBlocker[blocker].rationale;
}

export function chooseTeachingPolicy({
  selectedHypotheses,
  rescue,
  history,
}: {
  selectedHypotheses: SelfReportedBlocker[];
  rescue: RescueResponse | null;
  history: SavedMoment[];
}): TeachingPolicySnapshot {
  const primaryObservedBlocker = rescue
    ? normalizeObservedBlocker(rescue.observed_blocker.type)
    : selectedHypotheses.length
      ? blockerHypothesisMap[selectedHypotheses[0]]
      : "insufficient_evidence";
  const secondaryObservedBlockers = selectedHypotheses
    .map((hypothesis) => blockerHypothesisMap[hypothesis])
    .filter((blocker) => blocker !== primaryObservedBlocker && blocker !== "insufficient_evidence")
    .slice(0, 3);
  const model = derivePersonalTeachingModel(history);
  const base = policyByBlocker[primaryObservedBlocker];
  const nextAssistanceLevel = model.nextAssistanceLevel === "full_model" ? base.order[0] : model.nextAssistanceLevel;
  const personalRationale = teachingModelHasEvidence(model) ? model.learnerVisibleNotes[0] : null;

  return {
    selectedHypotheses,
    primaryObservedBlocker,
    secondaryObservedBlockers,
    initialIntervention: model.effectiveInterventions[0] ?? base.intervention,
    assistanceOrder: base.order,
    nextAssistanceLevel,
    rationaleEn: personalRationale ?? base.rationale,
  };
}

function teachingModelHasEvidence(model: PersonalTeachingModel) {
  return (
    model.effectiveInterventions.length > 0 ||
    model.ineffectiveInterventions.length > 0 ||
    model.fullAnswerDependencySigns > 0
  );
}

export function interventionFromAssistance(assistance: AssistanceUsed): InterventionType {
  if (assistance === "keyword") return "keyword";
  if (assistance === "sentence_frame") return "sentence_frame";
  if (assistance === "english_explanation") return "english_explanation";
  if (assistance === "slower_audio") return "slow_audio";
  if (assistance === "full_model") return "full_model";
  return "preparation_time";
}

export function createInterventionOutcome({
  assistanceBefore,
  assistanceAfter,
  stage,
  evaluation,
}: {
  assistanceBefore: AssistanceUsed;
  assistanceAfter: AssistanceUsed;
  stage: InterventionOutcome["stage"];
  evaluation: AttemptEvaluation | null;
}): InterventionOutcome {
  const helped =
    evaluation?.meaningResult === "clear"
      ? true
      : evaluation?.meaningResult === "partial"
        ? null
        : evaluation
          ? false
          : null;
  return {
    intervention: interventionFromAssistance(assistanceAfter),
    stage,
    helped,
    assistanceBefore,
    assistanceAfter,
    evidence: evaluation?.conciseFeedbackEn ?? "No evaluated attempt yet.",
    timestamp: new Date().toISOString(),
  };
}

export function nextAssistanceAfterOutcome(current: AssistanceUsed, evaluation: AttemptEvaluation | null): AssistanceUsed {
  const rank = assistanceRank[current] ?? 0;
  if (evaluation?.meaningResult === "clear" && rank > 0) {
    return assistanceByRank(rank - 1);
  }
  if ((evaluation?.meaningResult === "unclear" || evaluation?.meaningResult === "insufficient_evidence") && rank < 6) {
    return assistanceByRank(rank + 1);
  }
  return current;
}

export function derivePersonalTeachingModel(
  moments: SavedMoment[],
  corrections: TeachingModelCorrection[] = [],
): PersonalTeachingModel {
  const outcomes = moments.flatMap((moment) => moment.interventionOutcomes ?? []);
  const helped = countInterventions(outcomes.filter((outcome) => outcome.helped === true));
  const notHelped = countInterventions(outcomes.filter((outcome) => outcome.helped === false));
  const effectiveInterventions = Object.entries(helped)
    .sort((a, b) => b[1] - a[1])
    .map(([intervention]) => intervention as InterventionType);
  const ineffectiveInterventions = Object.entries(notHelped)
    .sort((a, b) => b[1] - a[1])
    .map(([intervention]) => intervention as InterventionType);
  const fullAnswerDependencySigns = outcomes.filter(
    (outcome) => outcome.assistanceAfter === "full_model" && outcome.helped !== true,
  ).length;
  const latest = moments[0];
  const nextAssistanceLevel = latest?.interventionOutcomes?.[0]
    ? latest.interventionOutcomes[0].assistanceAfter
    : latest?.rebuildEvaluation
      ? nextAssistanceAfterOutcome(latest.rebuildEvaluation.assistanceUsed, latest.rebuildEvaluation)
      : "keyword";
  const learnerVisibleNotes = buildTeachingNotes(effectiveInterventions, fullAnswerDependencySigns, latest);

  return {
    effectiveInterventions,
    ineffectiveInterventions,
    fullAnswerDependencySigns,
    idealPreparationSeconds: null,
    nextAssistanceLevel,
    learnerVisibleNotes,
    userCorrections: normalizeTeachingModelCorrections(corrections),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeTeachingModelCorrections(corrections: TeachingModelCorrection[]) {
  return corrections
    .filter((correction) => correction.id && correction.createdAt && correction.text.trim().length > 0)
    .map((correction) => ({
      ...correction,
      text: correction.text.trim().slice(0, 240),
    }))
    .slice(0, 6);
}

function countInterventions(outcomes: InterventionOutcome[]) {
  return outcomes.reduce<Partial<Record<InterventionType, number>>>((counts, outcome) => {
    counts[outcome.intervention] = (counts[outcome.intervention] ?? 0) + 1;
    return counts;
  }, {});
}

function buildTeachingNotes(
  effectiveInterventions: InterventionType[],
  fullAnswerDependencySigns: number,
  latest: SavedMoment | undefined,
) {
  const notes: string[] = [];
  if (effectiveInterventions[0] === "sentence_frame") {
    notes.push("Sentence frames have helped before, so Outloud will try that before showing the full answer.");
  } else if (effectiveInterventions[0] === "keyword") {
    notes.push("A keyword has helped before, so Outloud will start small before giving the full sentence.");
  }
  if (fullAnswerDependencySigns > 0) {
    notes.push("The full answer may help immediately, but Outloud will check whether you can rebuild it after the wording changes.");
  }
  if (latest?.focusGap?.source === "conversation") {
    notes.push("Your saved evidence came from a follow-up, so Outloud will keep testing the conversation turn, not only the opening line.");
  }
  return notes.length ? notes : ["Outloud will update this after more evaluated attempts."];
}

function assistanceByRank(rank: number): AssistanceUsed {
  const found = Object.entries(assistanceRank).find(([, value]) => value === rank)?.[0] as AssistanceUsed | undefined;
  return found ?? "none";
}
