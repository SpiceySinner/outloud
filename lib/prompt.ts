import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";
import type { RescueRequest } from "@/lib/types";

export const rescueJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "confirmed_intent",
    "intended_meaning_check",
    "meaning_result",
    "observed_blocker",
    "one_correction",
    "primary_correction",
    "actionable_feedback",
    "natural_version",
    "important_phrase",
    "transferableChunk",
    "tone_note",
    "spoken_note",
    "dialect_version",
    "pronunciationTargets",
  ],
  properties: {
    confirmed_intent: {
      type: "object",
      additionalProperties: false,
      required: ["english", "spanish"],
      properties: {
        english: {
          type: "string",
          description:
            "The extracted target message in plain English. For wanted_to_say, strip framing like 'I wanted to tell X that...' and keep only the message to teach. For received_spanish, summarize the likely intended meaning.",
        },
        spanish: {
          type: "string",
          description: "A natural Spanish version of the extracted target message.",
        },
      },
    },
    intended_meaning_check: {
      type: "string",
      description: "Warm one-line English note on whether the user's attempted meaning came through. Empty only if they skipped.",
    },
    meaning_result: {
      type: "string",
      enum: ["clear", "partial", "unclear", "skipped"],
      description: "Whether the attempted meaning would come through to a native speaker. Use skipped only when skipped_attempt is true.",
    },
    observed_blocker: {
      type: "object",
      additionalProperties: false,
      required: ["type", "confidence", "evidence", "explanation_en"],
      properties: {
        type: {
          type: "string",
          description: "A short blocker label based only on the attempt, such as word order, missing verb, register, freeze, or vocabulary gap.",
        },
        confidence: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        evidence: {
          type: "string",
          description: "The specific evidence from the user's attempt. If skipped, say there was no attempt to observe.",
        },
        explanation_en: {
          type: "string",
          description: "A short plain-English explanation of what the attempt showed. No diagnosis.",
        },
      },
    },
    one_correction: {
      type: "string",
      description: "The single highest-impact correction in plain English. Never list multiple errors.",
    },
    primary_correction: {
      type: "object",
      additionalProperties: false,
      required: ["original_fragment", "corrected_fragment", "explanation_en"],
      properties: {
        original_fragment: {
          type: "string",
          description: "The exact fragment from the attempt that should change. Empty when skipped.",
        },
        corrected_fragment: {
          type: "string",
          description: "The corrected Spanish fragment or phrase. Empty only when skipped.",
        },
        explanation_en: {
          type: "string",
          description: "Plain-English reason this correction matters.",
        },
      },
    },
    actionable_feedback: {
      type: "object",
      additionalProperties: false,
      required: ["issueType", "observedEvidence", "explanationEn", "nextActionEn", "targetFragmentEs", "correctedFragmentEs"],
      properties: {
        issueType: {
          type: "string",
          enum: [
            "vocabulary_retrieval",
            "sentence_assembly",
            "hesitation_pressure",
            "pronunciation_intelligibility",
            "grammar_control",
            "naturalness_register",
            "follow_up_pressure",
            "insufficient_evidence",
          ],
        },
        observedEvidence: { type: "string" },
        explanationEn: { type: "string" },
        nextActionEn: { type: "string" },
        targetFragmentEs: { type: ["string", "null"] },
        correctedFragmentEs: { type: ["string", "null"] },
      },
    },
    natural_version: {
      type: "string",
      description: "The natural Spanish version for the selected relationship, tone, and dialect.",
    },
    important_phrase: {
      type: "object",
      additionalProperties: false,
      required: ["spanish", "meaning_en"],
      properties: {
        spanish: {
          type: "string",
          description: "One useful Spanish chunk from the natural version worth remembering.",
        },
        meaning_en: {
          type: "string",
          description: "The English meaning of that chunk.",
        },
      },
    },
    transferableChunk: {
      type: "object",
      additionalProperties: false,
      required: ["patternEs", "meaningEn", "communicativeFunction", "whyItHelpsEn", "exampleFromMomentEs"],
      properties: {
        patternEs: {
          type: "string",
          description: "A reusable Spanish phrase pattern with blanks, not only this exact sentence.",
        },
        meaningEn: {
          type: "string",
          description: "Natural English meaning of the pattern.",
        },
        communicativeFunction: {
          type: "string",
          description: "What the pattern helps the user do, such as explain a reason, make a request, clarify, describe a problem, or repair a conversation.",
        },
        whyItHelpsEn: {
          type: "string",
          description: "Short English explanation of why this pattern solves the observed production gap.",
        },
        exampleFromMomentEs: {
          type: "string",
          description: "One example using this pattern for the user's current moment.",
        },
      },
    },
    tone_note: {
      type: "string",
      description: "One prominent English line about register, warmth, relationship fit, and whether it sounds too stiff or too casual.",
    },
    spoken_note: {
      type: "string",
      description:
        "One intelligibility-only spoken note when a spoken attempt exists. Judge whether a native would understand, never accent or nativeness. Empty string when no spoken attempt exists.",
    },
    dialect_version: {
      type: ["string", "null"],
      description: "A regional note or alternate version only when truly confident. Null when not needed.",
    },
    pronunciationTargets: {
      type: "array",
      description:
        "Only when pronunciation/intelligibility is the observed or self-reported blocker and a spoken attempt exists: 1 to 3 specific Spanish words whose sound needs to land more clearly. Empty array otherwise.",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "syllables", "stressedSyllableIndex"],
        properties: {
          word: { type: "string", description: "The Spanish word to practice, without surrounding punctuation." },
          syllables: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: { type: "string" },
            description: "Simple speakable syllable chunks for that word, in order.",
          },
          stressedSyllableIndex: {
            type: "integer",
            minimum: 0,
            description: "Zero-based index of the stressed syllable. Must point inside syllables.",
          },
        },
      },
    },
  },
} as const;

export function buildRescuePrompt(request: RescueRequest) {
  return [
    {
      role: "system" as const,
      content:
        "You are a sharp bilingual friend helping English speakers who understand Spanish but freeze when speaking. " +
        "Be warm, blunt, and human. Never shame. Never overteach. Never invent slang to sound local. " +
        naturalSpanishSystemPrompt + " " +
        "Give exactly one correction. Choose meaning, tense, word choice, pronoun, preposition, or register over accents. " +
        "If a spoken attempt exists, give exactly one spoken_note about intelligibility only. Do not punish foreign accent. " +
        "Judge whether a native speaker would understand the attempt, not whether the user sounds native. " +
        "Do not make accent marks the correction unless the phrase is otherwise already natural. " +
        "Never compare a word to the same visible word. Keep all English explanations short. " +
        "Output only the requested structured JSON.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        product_positioning:
          "Other AI tutors invent conversations. This learns from the real conversations the user froze in and trains that moment.",
        entry_mode: request.entryMode,
        original_text: request.originalText,
        scenario_context: request.scenarioContext ?? null,
        selected_context: request.context,
        self_reported_blocker: request.selfReportedBlocker,
        self_reported_blockers: request.selfReportedBlockers ?? (request.selfReportedBlocker ? [request.selfReportedBlocker] : []),
        first_attempt: request.attempt,
        voice_attempt: request.voiceAttempt,
        skipped_attempt: request.skippedAttempt,
        instructions: [
          "If entry_mode is wanted_to_say, first extract the target message from the user's description of intent. Strip framing such as 'I wanted to tell X that...', 'I wanted to say...', 'I was trying to tell them...', and similar setup language. Teach the extracted message, not the literal framing sentence.",
          "scenario_context is only the surrounding scene or relationship setup. Use it for tone, role, and formality only. Never treat scenario_context as the target message to teach.",
          "original_text is the target message or user attempt to rescue. If scenario_context and original_text conflict, teach original_text and keep scenario_context as background only.",
          "For wanted_to_say, confirmed_intent.english must be the extracted target message in natural English, and confirmed_intent.spanish must be the natural Spanish version you are teaching.",
          "Example: if original_text says 'I wanted to tell my girlfriend's mom that her food is good', confirmed_intent.english should be like 'your food is very good' and the taught Spanish should be like 'su comida esta muy rica', not a translation of the whole meta-sentence.",
          "If entry_mode is received_spanish, confirmed_intent should summarize the received meaning or likely reply target in English and Spanish.",
          "If entry_mode is received_spanish, explain what they likely received, then provide a natural reply if appropriate.",
          "Always include a tone note that evaluates relationship/register fit.",
          "If voice_attempt is present, spoken_note should be one concrete note about understandability only.",
          "If voice_attempt is present, never flag spelling, missing accent marks, or transcript orthography as the user's mistake. Those are transcription/writing issues, not spoken Spanish mistakes.",
          "If voice_attempt is absent, spoken_note must be an empty string.",
          "If pronunciation or intelligibility is the current blocker and voice_attempt is present, pronunciationTargets must identify the specific word or words that need clearer sound, with syllables and stress. This is not accent grading; only choose words that affect whether the meaning lands clearly.",
          "If pronunciation is not the current blocker, or the user did not speak, pronunciationTargets must be an empty array.",
          "Treat self_reported_blocker as the user's hypothesis, not a diagnosis.",
          "If self_reported_blockers contains multiple hypotheses, compare them with the observed attempt and choose the highest-impact current blocker.",
          "observed_blocker must be based only on original_text, first_attempt, voice_attempt, and skipped_attempt.",
          "actionable_feedback must name one issue, explain it in English, and tell the user exactly what to do next.",
          "If skipped_attempt is true, meaning_result must be skipped and observed_blocker confidence must be low.",
          "If skipped_attempt is true there is NO attempt to inspect. observed_blocker.evidence and observed_blocker.explanation_en must describe that absence plainly, in the spirit of 'Outloud can help, but it cannot observe your blocker until you try once.' Never describe the user's Spanish as unclear, fragmented, incorrect, or hard to understand when skipped_attempt is true -- there is nothing to describe, and inventing a finding is worse than reporting the gap.",
          "If skipped_attempt is true, the primary_correction fields must all be empty strings -- there is no fragment to correct. actionable_feedback.issueType must be insufficient_evidence, and observedEvidence must state that there was no attempt rather than describe one. one_correction must be the single next step that would produce evidence, not a correction of Spanish that was never said.",
          "Address the user directly as 'you'. Never refer to them in the third person as 'the user'. Keep every English string in lowercase sentence style, matching the product's voice.",
          "Only include dialect_version when a confident regional choice matters.",
          "Always include transferableChunk as a reusable structure the user can transfer to nearby real situations.",
          "The transferableChunk must match the selected social context and demonstrated ability. It must avoid unverified slang.",
          "transferableChunk.whyItHelpsEn must explain how the pattern is built -- what each part does and what belongs in each blank -- so the user can rebuild it for a different sentence. Stating only the benefit leaves them with one sentence to memorise instead of a structure they can reuse, and the structure is the thing worth keeping.",
          "If skipped_attempt is true, intended_meaning_check should be an empty string.",
        ],
      }),
    },
  ];
}
