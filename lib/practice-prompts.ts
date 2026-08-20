import type { AssistanceUsed, RescueContext, RescueResponse, RetrievalVariation } from "@/lib/types";
import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";

export function buildAttemptEvaluationPrompt({
  originalText,
  scenarioContext,
  context,
  rescue,
  attempt,
  inputMode = "written",
  stage,
  assistanceUsed,
  conversationTurn,
  variation,
}: {
  originalText: string;
  scenarioContext?: string | null;
  context: RescueContext;
  rescue: RescueResponse;
  attempt: string;
  inputMode?: "spoken" | "written";
  stage: "independent_rebuild" | "changed_context";
  assistanceUsed: AssistanceUsed;
  /** Present only when the attempt is a reply inside a live conversation. */
  conversationTurn?: {
    characterLineEs: string;
    characterMeaningEn?: string;
    expectedCommunicativeFunction?: string;
  } | null;
  variation?: RetrievalVariation | null;
}) {
  return [
    {
      role: "system" as const,
      content:
        "You evaluate one Spanish practice attempt truthfully. Do not reward button clicks. " +
        naturalSpanishSystemPrompt + " " +
        "Judge meaning communication, whether the target pattern/chunk was used, and whether the primary issue was corrected. " +
        "Do not punish understandable accent. Do not infer global fluency. Output only structured JSON.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        target_message: originalText,
        scenario_context: scenarioContext ?? null,
        context,
        stage,
        input_mode: inputMode,
        assistance_used: assistanceUsed,
        rescue_target: {
          natural_version: rescue.natural_version,
          primary_correction: rescue.primary_correction,
          transferable_chunk: rescue.transferableChunk,
          important_phrase: rescue.important_phrase,
        },
        changed_context_variation: variation ?? null,
        conversation_turn: conversationTurn ?? null,
        user_attempt: attempt,
        instructions: [
          "If evidence is too short or empty, use insufficient_evidence.",
          "scenario_context is background only. Evaluate whether user_attempt communicates the target_message or changed_context_variation, not whether it repeats the scenario setup.",
          // Without this the evaluator has only target_message to measure against, and a correct
          // answer to the character's question reads as a failure to reproduce that sentence.
          "If conversation_turn is present, user_attempt is a REPLY inside a live conversation. Judge whether it is a comprehensible, appropriate Spanish response to conversation_turn.character_line_es and its expected_communicative_function. Do NOT require user_attempt to reproduce target_message: that is the sentence the user practised earlier, and repeating it instead of answering the question would usually be the wrong move, not the right one.",
          "When conversation_turn is present, usedTargetChunk stays a separate observation and never drives meaningResult. A reply that answers the question clearly without reusing the practised pattern is meaningResult clear and usedTargetChunk false. Do not report a correction when the user was right.",
          "When conversation_turn is present, conciseFeedbackEn must be about the reply the user actually gave. Never tell the user to ask the question that was just asked of them.",
          "If input_mode is spoken, never flag spelling, missing accent marks, or transcript orthography as the user's mistake. Evaluate meaning, grammar that would be audible, pronunciation/intelligibility, hesitation, and naturalness only.",
          "If input_mode is written, spelling can matter only when it changes the meaning or would confuse a reader; still prioritize one high-impact spoken-use issue.",
          "usedTargetChunk means the user produced the reusable pattern or a clear equivalent, not necessarily exact wording.",
          "correctedPrimaryIssue should be null only when evidence is insufficient.",
          "Use observedBlocker.type pronunciation_intelligibility when the issue is whether a word landed clearly.",
          "If pronunciation_intelligibility is the observed blocker, pronunciationTargets must list 1 to 3 specific Spanish words to sound out with syllables and stress. If pronunciation is not the blocker, pronunciationTargets must be an empty array.",
          "Never grade accent or nativeness. Only mark words whose sound affects understandability.",
          "Keep conciseFeedbackEn short and actionable.",
          // The card that renders this used to show rescue_target.natural_version instead, which is
          // fixed for the whole session -- so every correction showed the same sentence and quietly
          // dropped whatever the user had actually meant.
          "correctedAttemptEs is the USER'S OWN sentence, repaired: keep their meaning, keep their content words, keep roughly their length. Repair only what is wrong. It is not a rewrite and not a better sentence you would prefer.",
          "Never substitute rescue_target.natural_version, target_message, or any other prepared sentence for correctedAttemptEs. If the user meant something other than the practised sentence, that is their choice, not an error to correct.",
          'Never drop or add content. If the user said "Yo gustan grande casas", correctedAttemptEs is "Me gustan las casas grandes" -- NOT "Me gustan las casas". The word for big is theirs and must survive the repair.',
          "correctedAttemptEs must be null when meaningResult is clear or insufficient_evidence, and null whenever there is nothing worth repairing.",
          "If input_mode is spoken, correctedAttemptEs must not differ from the attempt only in spelling or accent marks -- repair what would be heard, or return null.",
        ],
      }),
    },
  ];
}

export function buildRetrievalVariationPrompt({
  originalText,
  scenarioContext,
  context,
  rescue,
}: {
  originalText: string;
  scenarioContext?: string | null;
  context: RescueContext;
  rescue: RescueResponse;
}) {
  return [
    {
      role: "system" as const,
      content:
        "Create one nearby but meaningfully different Spanish speaking situation for transfer practice. " +
        naturalSpanishSystemPrompt + " " +
        "It must test the same communicative function and reusable phrase pattern, change only close surface details, and avoid becoming much harder. " +
        "The new situation must be obviously connected to what the user just practiced; do not jump domains, relationships, topics, or objects in a way that feels random. " +
        "When natural, frame situationEn/openingLineEs as what the other person might say next so curiosity pulls the user forward. " +
        "Do not create garden-path leaps such as dinner compliments turning into dog compliments. Do not merely paraphrase the same sentence. Output only structured JSON.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        target_message: originalText,
        scenario_context: scenarioContext ?? null,
        context,
        target: {
          natural_version: rescue.natural_version,
          transferable_chunk: rescue.transferableChunk,
          observed_blocker: rescue.observed_blocker,
        },
        instructions: [
          "Keep targetChunkPatternEs the same skill/pattern the user just practiced.",
          "Use scenario_context only to keep the new situation socially coherent. Do not turn scenario_context into the target phrase.",
          "openingLineEs should be an AI-generated Spanish line only if it helps the user know what they are replying to.",
          "roleEs should label who is speaking or prompting the user.",
          "situationEn should make the connection to the original moment obvious.",
        ],
      }),
    },
  ];
}
