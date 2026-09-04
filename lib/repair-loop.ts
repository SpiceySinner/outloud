import type { AssistanceUsed, AttemptEvaluation } from "@/lib/types";

/**
 * When the character should admit it did not understand, instead of answering as if it had.
 *
 * The division of responsibility was designed before this file existed and is documented in two
 * places that both pointed here while it was missing: the client decides *when* from the real
 * `/api/evaluate` verdict, and `app/api/converse/route.ts` decides *how to phrase it in
 * character*. Until now the client sent `repairRequested: false` unconditionally, so the whole
 * repair prompt on the server was unreachable and the character answered every reply smoothly --
 * including the ones a real person would not have caught.
 *
 * Calling this requires the current reply's evaluation, which is why the client awaits the
 * evaluation before asking for the next coach line rather than running the two in parallel.
 */

export type RepairDecision = {
  repair: boolean;
  /** Why, for the caller to log or ignore. Never shown to the learner. */
  reason: string;
};

export function shouldTriggerRepair({
  evaluation,
  assistanceUsed,
  lastTurnWasRepair,
  lowConfidence,
}: {
  /** The settled evaluation of the reply the character just heard. Null when none ran. */
  evaluation: AttemptEvaluation | null;
  /** The strongest help the learner reached for on this turn. */
  assistanceUsed: AssistanceUsed;
  /** Whether the turn immediately before this one was already a repair. */
  lastTurnWasRepair: boolean;
  /** Whether the transcript of this reply was itself unreliable. */
  lowConfidence: boolean;
}): RepairDecision {
  if (!evaluation) return { repair: false, reason: "no evaluation to act on" };

  // Two "¿cómo?" in a row is a doom loop: the learner cannot tell what to change, and the
  // character stops reading as a person and starts reading as a broken app. One admission of
  // non-comprehension, then carry the conversation forward whatever happens.
  if (lastTurnWasRepair) return { repair: false, reason: "previous turn was already a repair" };

  // They were handed the sentence and said it back. A character that fails to understand its own
  // model answer is not a character, it is a bug the learner will read as being blamed.
  if (assistanceUsed === "full_model") return { repair: false, reason: "learner repeated the model answer" };

  // A bad transcript is OUR failure, and the evaluator is instructed to answer
  // `insufficient_evidence` precisely when the capture is suspect. Turning that into the
  // character saying it did not understand hands the learner the blame for our microphone --
  // the exact move Phase 0 exists to prevent.
  if (lowConfidence) return { repair: false, reason: "the transcript, not the learner, was unreliable" };

  // Both of these are genuine non-comprehension. "unclear" is a reply that did not land;
  // "insufficient_evidence" is what an evaluator returns for a reply with nothing judgeable in it
  // -- English word salad, a fragment, a false start -- which is exactly the case a real listener
  // answers with "¿cómo?". Anything softer than these is left alone: "partial" means the meaning
  // mostly arrived, and feigning confusion at something understood tells the learner they failed
  // when they did not.
  if (evaluation.meaningResult === "unclear" || evaluation.meaningResult === "insufficient_evidence") {
    return { repair: true, reason: `meaning was ${evaluation.meaningResult}` };
  }

  return { repair: false, reason: `meaning was ${evaluation.meaningResult}` };
}
