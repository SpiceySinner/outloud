import type { AssistanceUsed, AttemptEvaluation, RescueRequest, RescueResponse, RetrievalVariation, VoiceAttempt } from "@/lib/types";
import { buildFreezeSignals } from "@/lib/freeze";
import { blockerHypothesisMap } from "@/lib/teaching-policy";

export function isMockAiEnabled() {
  return process.env.OUTLOUD_MOCK_AI === "true";
}

export function buildMockRescueResponse(request: RescueRequest): RescueResponse {
  const skipped = request.skippedAttempt || !request.attempt.trim();
  const selectedHypothesis = request.selfReportedBlockers?.[0] ?? request.selfReportedBlocker ?? null;
  const observedType = skipped
    ? "insufficient_evidence"
    : selectedHypothesis
      ? blockerHypothesisMap[selectedHypothesis]
      : "sentence_assembly";
  const mockProfile = mockProfileFor(observedType);
  const natural = request.originalText.toLowerCase().includes("late")
    ? "Perdón, voy a llegar tarde porque hubo tráfico."
    : mockProfile.naturalVersion;

  return {
    confirmed_intent: {
      english: request.originalText.toLowerCase().includes("food")
        ? "your food is very good"
        : request.originalText,
      spanish: natural,
    },
    intended_meaning_check: skipped
      ? ""
      : mockProfile.meaningCheck,
    meaning_result: skipped ? "skipped" : "partial",
    observed_blocker: {
      type: skipped ? "insufficient evidence" : observedType,
      confidence: skipped ? "low" : "high",
      evidence: skipped ? "There was no first attempt to inspect." : mockProfile.evidence,
      explanation_en: skipped
        ? "Outloud can help, but it needs one try before it can see what to work on."
        : mockProfile.explanation,
    },
    one_correction: mockProfile.oneCorrection,
    // Nothing was said, so there is no fragment to correct. Kept in step with the skipped_attempt
    // rules in buildRescuePrompt so the mock and the real model agree on this shape.
    primary_correction: {
      original_fragment: skipped ? "" : request.attempt,
      corrected_fragment: skipped ? "" : mockProfile.correctedFragment,
      explanation_en: skipped ? "" : mockProfile.correctionExplanation,
    },
    actionable_feedback: {
      issueType: skipped ? "insufficient_evidence" : observedType,
      observedEvidence: skipped ? "There was no first attempt." : mockProfile.evidence,
      explanationEn: skipped
        ? "Outloud needs one attempt before it can compare your guess with evidence."
        : mockProfile.feedbackExplanation,
      nextActionEn: skipped ? "Try saying a rough version before checking the answer." : mockProfile.nextAction,
      targetFragmentEs: skipped ? null : request.attempt,
      correctedFragmentEs: skipped ? null : mockProfile.correctedFragment,
    },
    natural_version: natural,
    important_phrase: {
      spanish: natural.includes("tarde") ? "voy a llegar tarde" : mockProfile.importantPhrase,
      meaning_en: natural.includes("tarde") ? "I am going to be late" : mockProfile.importantMeaning,
    },
    transferableChunk: {
      patternEs: natural.includes("tarde") ? "Voy a ___ porque ___." : mockProfile.patternEs,
      meaningEn: natural.includes("tarde") ? "I am going to ___ because ___." : mockProfile.patternMeaning,
      communicativeFunction: natural.includes("tarde") ? "explain a reason" : mockProfile.functionName,
      whyItHelpsEn: mockProfile.whyItHelps,
      exampleFromMomentEs: natural,
    },
    tone_note: mockProfile.toneNote,
    spoken_note: request.voiceAttempt ? mockProfile.spokenNote : "",
    dialect_version: request.context.dialect,
    pronunciationTargets: observedType === "pronunciation_intelligibility" && request.voiceAttempt
      ? [{ word: "estaba", syllables: ["es", "ta", "ba"], stressedSyllableIndex: 1 }]
      : [],
  };
}

function mockProfileFor(blocker: RescueResponse["actionable_feedback"]["issueType"]) {
  const profiles: Record<RescueResponse["actionable_feedback"]["issueType"], {
    meaningCheck: string;
    evidence: string;
    explanation: string;
    oneCorrection: string;
    correctedFragment: string;
    correctionExplanation: string;
    feedbackExplanation: string;
    nextAction: string;
    naturalVersion: string;
    importantPhrase: string;
    importantMeaning: string;
    patternEs: string;
    patternMeaning: string;
    functionName: string;
    whyItHelps: string;
    toneNote: string;
    spokenNote: string;
  }> = {
    vocabulary_retrieval: {
      meaningCheck: "You had the idea, but one key word did not come back quickly.",
      evidence: "The attempt stalled around the word needed to compliment the food.",
      explanation: "Vocabulary retrieval was the main thing to work on in this mock attempt.",
      oneCorrection: "Use one useful word before opening the whole sentence.",
      correctedFragment: "riquísima",
      correctionExplanation: "Riquísima is a compact everyday word for saying the food was very good.",
      feedbackExplanation: "The missing word blocked the sentence, so start with one keyword.",
      nextAction: "Look at one keyword, then hide it and rebuild the full compliment.",
      naturalVersion: "La comida estaba riquísima.",
      importantPhrase: "riquísima",
      importantMeaning: "really delicious",
      patternEs: "La ___ estaba ___.",
      patternMeaning: "The ___ was ___.",
      functionName: "compliment food",
      whyItHelps: "This keeps the rescue focused on the missing word before revealing the full sentence.",
      toneNote: "This sounds warm and natural for family or friends.",
      spokenNote: "The key word carries the compliment.",
    },
    sentence_assembly: {
      meaningCheck: "Your meaning was present, but the sentence needed structure.",
      evidence: "The attempt had useful words but not a stable sentence frame.",
      explanation: "Sentence assembly was the main thing to work on in this mock attempt.",
      oneCorrection: "Use a reusable sentence frame before the full answer.",
      correctedFragment: "La comida estaba muy rica.",
      correctionExplanation: "This frame turns the loose words into a complete compliment.",
      feedbackExplanation: "A frame gives the idea structure without forcing you to memorize every word.",
      nextAction: "Use the frame once, then hide it and say the sentence again.",
      naturalVersion: "Creo que la comida estaba muy rica.",
      importantPhrase: "estaba muy rica",
      importantMeaning: "was very good",
      patternEs: "Creo que ___ estaba muy ___.",
      patternMeaning: "I think ___ was very ___.",
      functionName: "give a warm compliment",
      whyItHelps: "This gives you a reusable sentence frame instead of one memorized answer.",
      toneNote: "This is warm and direct without sounding stiff.",
      spokenNote: "A native speaker would understand the main idea.",
    },
    hesitation_pressure: {
      meaningCheck: "The idea was clear, but pressure delayed the start.",
      evidence: "The attempt needed a starter before the sentence came out.",
      explanation: "Hesitation under pressure was the main thing to work on in this mock attempt.",
      oneCorrection: "Use a short starter, then continue.",
      correctedFragment: "Quería decir que...",
      correctionExplanation: "This buys a second and gets the sentence moving.",
      feedbackExplanation: "The issue is starting under pressure, not knowing every word perfectly.",
      nextAction: "Take one breath, use the starter, then finish the compliment.",
      naturalVersion: "Quería decir que la comida estaba muy rica.",
      importantPhrase: "Quería decir que",
      importantMeaning: "I wanted to say that",
      patternEs: "Quería decir que ___.",
      patternMeaning: "I wanted to say that ___.",
      functionName: "start under pressure",
      whyItHelps: "The starter lowers pressure without showing the whole answer.",
      toneNote: "This sounds calm and respectful.",
      spokenNote: "A short starter makes the opening easier.",
    },
    pronunciation_intelligibility: {
      meaningCheck: "The sentence idea was there, but one phrase needed clearer sound.",
      evidence: "The target phrase would benefit from slow audio and shadowing.",
      explanation: "Pronunciation intelligibility was the main thing to work on in this mock attempt.",
      oneCorrection: "Practice the short target phrase before rebuilding.",
      correctedFragment: "estaba muy rica",
      correctionExplanation: "Keep the middle syllables audible and connected.",
      feedbackExplanation: "Accent is not graded. Make the key phrase understandable.",
      nextAction: "Listen once slowly, shadow the target phrase, then rebuild the sentence.",
      naturalVersion: "La comida estaba muy rica.",
      importantPhrase: "estaba muy rica",
      importantMeaning: "was very good",
      patternEs: "___ estaba muy ___.",
      patternMeaning: "___ was very ___.",
      functionName: "make a compliment intelligible",
      whyItHelps: "The short phrase gets clearer before you rebuild the whole answer.",
      toneNote: "This is simple and natural.",
      spokenNote: "Accent is fine; clarity is the target.",
    },
    grammar_control: {
      meaningCheck: "The idea was clear, but one grammar contrast broke the sentence.",
      evidence: "The attempt confused the past-tense form and agreement.",
      explanation: "Grammar control was the main thing to work on in this mock attempt.",
      oneCorrection: "Use the corrected contrast once, then retry.",
      correctedFragment: "estaba muy rica",
      correctionExplanation: "Use estaba for how the food was, and rica to agree with comida.",
      feedbackExplanation: "One grammar contrast matters here; do not fix five things at once.",
      nextAction: "Say the same idea again using estaba muy rica.",
      naturalVersion: "La comida estaba muy rica.",
      importantPhrase: "estaba muy rica",
      importantMeaning: "was very good",
      patternEs: "La comida estaba ___.",
      patternMeaning: "The food was ___.",
      functionName: "compliment something that already happened",
      whyItHelps: "This isolates one grammar contrast and immediately tests it.",
      toneNote: "This sounds natural and respectful.",
      spokenNote: "The corrected phrase carries the grammar.",
    },
    naturalness_register: {
      meaningCheck: "Your words were understandable, but the wording sounded translated.",
      evidence: "The attempt was understandable but not the most natural social wording.",
      explanation: "Naturalness/register was the main thing to work on in this mock attempt.",
      oneCorrection: "Use the natural version for this relationship.",
      correctedFragment: "La comida estaba muy rica.",
      correctionExplanation: "This sounds like an everyday compliment instead of a literal translation.",
      feedbackExplanation: "The meaning worked; the next step is making it sound relationship-appropriate.",
      nextAction: "Compare your version with the natural version, then use the natural pattern.",
      naturalVersion: "La comida estaba muy rica.",
      importantPhrase: "muy rica",
      importantMeaning: "very good",
      patternEs: "___ estaba muy ___.",
      patternMeaning: "___ was very ___.",
      functionName: "sound natural while complimenting",
      whyItHelps: "This separates understandable Spanish from natural wording.",
      toneNote: "This is warm without sounding exaggerated.",
      spokenNote: "The wording sounds socially natural.",
    },
    follow_up_pressure: {
      meaningCheck: "The opening answer worked, but the next turn would need a repair phrase.",
      evidence: "The mock attempt prepared the opening but not the follow-up.",
      explanation: "Follow-up pressure was the main thing to work on in this mock attempt.",
      oneCorrection: "Keep a recovery phrase ready.",
      correctedFragment: "¿Puedes repetirlo más despacio?",
      correctionExplanation: "This keeps the conversation alive when the next question is too fast.",
      feedbackExplanation: "The opening is not the only test; prepare for the next turn.",
      nextAction: "Say the opening, then practice the recovery phrase before the live follow-up.",
      naturalVersion: "La comida estaba muy rica, gracias.",
      importantPhrase: "¿Puedes repetirlo más despacio?",
      importantMeaning: "Can you repeat it more slowly?",
      patternEs: "___, gracias.",
      patternMeaning: "___, thank you.",
      functionName: "answer and survive a follow-up",
      whyItHelps: "This links the opening line to a repair phrase for the next turn.",
      toneNote: "This is polite and keeps the conversation moving.",
      spokenNote: "The repair phrase is the backup plan.",
    },
    insufficient_evidence: {
      meaningCheck: "There is not enough evidence from the attempt yet.",
      evidence: "The mock attempt did not show a reliable thing to work on.",
      explanation: "Outloud needs another attempt before choosing a stronger route.",
      oneCorrection: "Start with light help.",
      correctedFragment: "La comida estaba muy rica.",
      correctionExplanation: "This is a neutral model to compare against.",
      feedbackExplanation: "There is not enough evidence, so start with light help.",
      nextAction: "Try the sentence frame, then hide it and say the idea again.",
      naturalVersion: "La comida estaba muy rica.",
      importantPhrase: "estaba muy rica",
      importantMeaning: "was very good",
      patternEs: "___ estaba muy ___.",
      patternMeaning: "___ was very ___.",
      functionName: "practice with light evidence",
      whyItHelps: "This avoids over-diagnosing from weak evidence.",
      toneNote: "This is neutral and understandable.",
      spokenNote: "Try once more for better evidence.",
    },
  };

  return profiles[blocker];
}

export function buildMockVoiceAttempt(transcript: string): VoiceAttempt {
  return {
    transcript,
    freeze: buildFreezeSignals({
      transcript,
      words: [],
      clientMetrics: {
        firstSpeechMs: 900,
        hesitationCount: 1,
        durationMs: 3500,
      },
    }),
  };
}

export function buildMockAttemptEvaluation({
  attempt,
  assistanceUsed,
  isConversationReply = false,
}: {
  attempt: string;
  assistanceUsed: AssistanceUsed;
  /**
   * True when the attempt answers a character's line rather than rebuilding the practised
   * sentence. Kept in step with the real prompt: reusing the target chunk is not the criterion
   * for a reply, so a substantive answer is clear even without it. Without this the mock path
   * reproduced the same bug the real evaluator had -- correct answers marked partial.
   */
  isConversationReply?: boolean;
}): AttemptEvaluation {
  const hasAttempt = attempt.trim().length >= 4;
  const usedChunk = /rica|deliciosa|tarde|porque/i.test(attempt);
  const meaningClear = hasAttempt && (isConversationReply || usedChunk);
  return {
    meaningResult: hasAttempt ? (meaningClear ? "clear" : "partial") : "insufficient_evidence",
    communicatedMeaningEn: hasAttempt ? "The main idea was communicated." : "",
    missingMeaningEn: meaningClear || !hasAttempt ? null : "The target reusable chunk was not clear enough.",
    usedTargetChunk: usedChunk,
    correctedPrimaryIssue: hasAttempt ? meaningClear : null,
    observedBlocker: {
      type: hasAttempt ? (meaningClear ? "naturalness_register" : "sentence_assembly") : "insufficient_evidence",
      confidence: hasAttempt ? "medium" : "low",
      evidence: hasAttempt ? "Mock evaluation inspected the submitted attempt." : "No usable attempt was submitted.",
    },
    assistanceUsed,
    conciseFeedbackEn: meaningClear
      ? "Clear enough. Keep the same pattern in the next situation."
      : "The meaning is close, but rebuild it with the target pattern.",
    // Constant on purpose. The mock cannot actually repair Spanish, and pretending to would make
    // a manual run look like it proved the prompt rules. What it does prove is that both branches
    // exist, so the correction card can be seen with and without a sentence under OUTLOUD_MOCK_AI.
    correctedAttemptEs: meaningClear || !hasAttempt ? null : "Me gustan las casas grandes.",
    pronunciationTargets: [],
  };
}

export function buildMockPostSessionObservations({
  facts,
  forwardCandidate,
}: {
  facts: string[];
  forwardCandidate: string | null;
}): { observations: string[]; forward: string | null } {
  return {
    observations: facts.slice(0, 3).map((fact) => fact.toLowerCase()),
    forward: forwardCandidate ? forwardCandidate.toLowerCase() : null,
  };
}

export function buildMockRetrievalVariation(rescue: RescueResponse): RetrievalVariation {
  return {
    situationEn: "Same dinner conversation: after you compliment the food, they ask what you thought of the soup.",
    roleEs: "Your friend",
    openingLineEs: "Que te parecio la sopa?",
    openingMeaningEn: "What did you think of the soup?",
    targetCommunicativeFunction: rescue.transferableChunk.communicativeFunction,
    targetChunkPatternEs: rescue.transferableChunk.patternEs,
    changedElements: ["person", "object"],
    expectedMeaningPoints: ["say the food item was good", "use a natural compliment"],
    difficultyReason: "It changes the object and person while keeping the same compliment pattern.",
  };
}
