import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { intentResponseJsonSchema, intentResponseSchema } from "@/lib/intent-schema";
import type { IntentResponse } from "@/lib/intent-schema";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { checkRateLimit, openAiRequestsPerDay } from "@/lib/rate-limit";

/**
 * The router behind `/dash`: one sentence in, one intent and one read-back out.
 *
 * Stateless, for the same reasons as `/api/aside`. There is nothing here worth remembering
 * between calls -- it is a single turn, and everything it needs (what is open, what the focus is)
 * belongs to the client and is sent anyway. It also keeps this out of the shared `engine_sessions`
 * table, whose `kind` check has already had to be fought once.
 *
 * The one rule that outranks every other: **it never guesses**. `unclear` is a real answer with
 * its own copy on the screen. Starting the default intake after a learner has told you what they
 * wanted is worse than admitting we missed it -- that is the "what was the point of telling it my
 * problem?" failure, and it is the reason this route exists at all.
 */

const requestSchema = z.object({
  /** What they said, as transcribed. English or Spanish; the routing is about intent, not language. */
  said: z.string().min(1).max(1200),
  /**
   * What is resumable, newest-relevant first. The model may only ever return one of these ids;
   * anything else is treated as a miss.
   */
  open: z
    .array(
      z.object({
        id: z.string().max(80),
        keyPhrase: z.string().max(200).nullable(),
        summary: z.string().max(400),
        waitingLabel: z.string().max(80).nullable(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
  /**
   * The one the header named. A deictic reference -- "that one", "the one you said" -- resolves
   * here and nowhere else, because it is the only one the learner has actually been shown.
   */
  headlineId: z.string().max(80).nullable().optional().default(null),
  /** The dimension the sessions are pointed at, in plain language. Context only. */
  focusEn: z.string().max(200).nullable().optional().default(null),
});

type RouteInput = {
  said: string;
  open: z.infer<typeof requestSchema>["open"];
  headlineId: string | null;
  focusEn: string | null;
};

const systemPrompt = [
  "You route one spoken sentence from a Spanish learner into exactly one intent. You are not a coach and not a character. You classify, and you say back what you understood. Nothing else.",
  "",
  "# The intents",
  'resume       - they want to carry on with something already open. "let\'s do that one", "pick up where I left off", "the museum one again".',
  'new_scenario - a real situation from their life that is COMING UP, and they want to be ready. "dinner at my girlfriend\'s parents on friday", "I have to call the landlord tomorrow".',
  'ask_phrase   - a QUESTION. There is something they want to be able to say, and they cannot say it. "how do I say I\'ll take care of it", "what is the word for landlord", "c\u00f3mo se dice ...".',
  'stung        - a real moment that ALREADY HAPPENED and did not come out. "I froze at the pharmacy today and switched to english", "my neighbour asked me something and I just stood there".',
  'talk         - they want open-ended conversation with you, about nothing in particular. "can we just talk for a bit", "let\'s chat".',
  "unclear      - you cannot tell. This is a REAL answer, not a failure, and choosing it is correct far more often than guessing.",
  "",
  "# ask_phrase, stung and talk are the ones you will get wrong",
  "They were one intent until recently and they read alike. Decide by what the sentence IS, not by the words in it. No phrase marks any of them -- these are the examples, and they are chosen because the obvious rule fails on half of them:",
  '  "how do I say I\'ll take care of it"                                        -> ask_phrase',
  '  "what is the word for landlord"                                            -> ask_phrase',
  '  "I never know what to say when someone asks how I am"                      -> ask_phrase  (no "how do I say" anywhere in it, and it is still a question)',
  '  "the woman at the bakery asked me something and I couldn\'t work out how to say I was just looking"  -> stung  (it CONTAINS "how to say" and is still a moment)',
  '  "I blanked when my neighbour said hello"                                   -> stung',
  '  "can we just talk for a bit"                                               -> talk',
  "The difference that actually decides it: a moment has a person, a place or a time in it, and something that already went wrong. A question has none of that -- there is only the thing they wish they could say.",
  "",
  "# When they name both",
  '"I couldn\'t say I\'ll take care of it at the pharmacy today" is both a moment and a phrase. THE MOMENT WINS: stung.',
  "A situation carries a person, a place and a reason, and the phrase can be reached from inside it -- they will need it again in the scene. The reverse is not true: a phrase on its own has nowhere to put them.",
  "",
  "# askEn",
  'On ask_phrase you MUST write askEn: the sentence they want to be able to say, in ENGLISH, with the asking stripped off. "how do I say I\'ll take care of it" -> "I\'ll take care of it." Never "how to say I\'ll take care of it", and never the Spanish -- another engine does the Spanish.',
  'If they asked in Spanish ("c\u00f3mo se dice ..."), askEn is still English.',
  'If they asked for one word, askEn is that word inside a sentence they could actually mean: "what is the word for landlord" -> "my landlord". If there is no natural sentence, the word alone is fine.',
  'If they described the hole rather than the words ("I never know what to say when someone asks how I am"), askEn is what they would want to have said: "I am fine, thanks -- and you?".',
  'A "why" question about Spanish is ask_phrase too, and this is where askEn goes wrong most easily. askEn is the thing they were TRYING to say, never a translation of their question: "why is it me duele and not yo duelo" -> askEn "my leg hurts". NOT "why is it me hurts and not I hurt", which is not a sentence any human wants to be able to say.',
  "askEn is a sentence they would say to another person. If what you wrote is a question about Spanish, it is wrong -- write the sentence underneath it instead.",
  "askEn is empty on every other intent.",
  "",
  "# The read-back",
  "On resume, new_scenario and talk you MUST write readBackEn: a short receipt of what you understood.",
  "COMPRESS it. Name the specifics; do not repeat their sentence. Echoing someone word for word proves you transcribed them, not that you understood them -- and it reads as though nobody was listening.",
  "Never a category either: \"starting a new scenario\" tells them nothing about whether you got it.",
  "Three examples of the transformation:",
  "  they said \"dinner at my girlfriend's parents on friday, her mum talks really fast\"  ->  \"friday. her parents. her mum talks fast.\"",
  "  they said \"how do I say I'll take care of it\"  ->  \"how to say you'll handle it.\"",
  "  they said \"let's do that one\" and the headline item was \"me he perdido\"  ->  \"me he perdido, again.\"",
  "  they said \"I froze at the pharmacy today and switched to english\"  ->  \"the pharmacy. you switched to english.\"",
  "  they said \"can we just talk for a bit\"  ->  \"just talking for a bit.\"    NOT \"open-ended chat requested.\", which is you naming your own category back at them",
  "On resume, name the phrase or the situation you are resuming, so they can tell WHICH one you picked.",
  'An item with a waitingLabel about waiting is one they already practised, and "again" is right for it. An item whose summary numbers it as a step ("go 2 of 4") is one they have NOT started, and "again" is wrong: it says they have been here before when they have not. The read-back is the one line they use to check you understood, which makes it the worst possible place for a small untruth.',
  "Under ten words. Lowercase. No question, no offer, no enthusiasm. It is a receipt, not a reply.",
  "On unclear, readBackEn is an empty string. There is nothing to confirm.",
  "",
  "# Choosing",
  "Take what they said at face value. Do not read ambition into a passing remark and do not upgrade a question into a scenario.",
  "If they name a situation AND ask a question about it, the situation wins: they told you where they need this.",
  'A deictic reference -- "that one", "that", "the one you mentioned" -- means the item marked `headline`, and only that one. If there is no headline item, a deictic reference is unclear.',
  "If they name something specific that matches an open item, return that item's id in resumeId. If nothing matches well, do not force it -- new_scenario or unclear is better than resuming the wrong thing.",
  "Silence, noise, or anything you would have to invent to explain: unclear.",
  "Hesitation and agreement are NOT requests, however many words they run to. \"hmm okay so\", \"yeah alright\", \"uh right then\" -- somebody is clearing their throat, not asking for anything. Answer unclear. Reading agreement as a yes to whatever was on the screen is the worst mistake available to you: it starts a session nobody asked for.",
  "To return resume they have to actually point at something -- a deictic reference, a phrase, or a description of the situation. Agreement on its own points at nothing.",
  "",
  "# What you must never do",
  "Never invent a target. If you cannot name a real open item or a real situation they described, the answer is unclear.",
  "Never return an id that was not given to you.",
  "Never teach, translate, correct, or answer their question here. Another engine does that; you only say what it is about.",
  "Never say anything about whether their Spanish was good or bad. It has not been evaluated and you have no idea.",
  "Never fill scenario, askEn or topicEn on an intent they do not belong to. scenario belongs to new_scenario and stung, askEn to ask_phrase, topicEn to talk.",
  "Never answer the phrase question here, in either language. You say what they asked for; something else says how to say it.",
].join("\n");

/**
 * Utterances that ask for nothing: hesitation, agreement, and throat-clearing.
 *
 * The prompt forbids routing these and the model did it anyway -- "hmm okay so" came back as
 * `resume`, which would start a session nobody asked for. So the server decides, because this is
 * a fact about the string rather than a judgment about the learner.
 *
 * Every token has to be in the set. That is what keeps it safe: "that one" survives because
 * neither word is filler, and "yeah let's do that one" survives because most of it is not. Only
 * an utterance made *entirely* of these is refused.
 */
const emptyUtteranceWords = new Set([
  // hesitation
  "hm", "hmm", "hmmm", "uh", "uhh", "um", "umm", "uhm", "er", "erm", "ehm", "ah", "oh", "eh",
  // agreement -- real words, but agreeing with nothing is not a request
  "ok", "okay", "yeah", "yea", "yes", "yep", "yup", "sure", "right", "alright", "fine",
  "si", "s\u00ed", "vale", "claro", "bueno",
  // discourse glue
  "so", "well", "like", "then", "and", "but", "anyway", "actually", "just",
]);

export function looksLikeNoRequest(said: string) {
  const words = said
    .toLowerCase()
    .replace(/[.,!?\u00bf\u00a1\u2026"'`\-\u2014\u2013]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  return words.every((word) => emptyUtteranceWords.has(word));
}

function guidanceFor(input: RouteInput) {
  if (!input.open.length) {
    return "There is nothing open. `resume` is impossible here -- do not return it under any circumstances, and a deictic reference with nothing to point at is unclear.";
  }
  if (!input.headlineId) {
    return "There are open items but none has been shown to the learner, so a bare \"that one\" points at nothing. Resume only on a specific match.";
  }
  return "The item marked `headline` is the one the screen named, so it is what a bare \"that one\" refers to.";
}

async function routeIntent(input: RouteInput): Promise<IntentResponse> {
  if (isMockAiEnabled()) return mockIntent(input);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          theySaid: input.said,
          openItems: input.open.map((item) => ({
            ...item,
            headline: item.id === input.headlineId,
          })),
          sessionFocus: input.focusEn,
          guidance: guidanceFor(input),
        }),
      },
    ],
    // Low: this is a classification with a fixed vocabulary. The only free text is a receipt.
    temperature: 0.2,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "entry_intent",
        strict: true,
        schema: intentResponseJsonSchema,
      },
    },
  });

  const generated = intentResponseSchema.parse(JSON.parse(response.output_text));
  return normalizeIntent(generated, input);
}

/**
 * The server owns whether an answer is actionable; the model owns only what it understood.
 *
 * Every downgrade here ends in `unclear` rather than in a guess, because the cost is asymmetric:
 * a wrong route costs a whole session and the trust that the app listens, while `unclear` costs
 * one sentence and has copy written for it.
 */
export function normalizeIntent(generated: IntentResponse, input: RouteInput): IntentResponse {
  const unclear: IntentResponse = {
    intent: "unclear",
    readBackEn: "",
    resumeId: null,
    scenario: null,
    askEn: null,
    topicEn: null,
  };

  const readBack = generated.readBackEn.trim();
  // A confident intent with nothing to show is not confident enough to act on: the read-back is
  // the contract, and acting without one is exactly what this route exists to prevent.
  if (generated.intent !== "unclear" && !readBack) return unclear;

  if (generated.intent === "resume") {
    const known = input.open.some((item) => item.id === generated.resumeId);
    // Resuming the wrong conversation is worse than admitting we missed it, and an id we never
    // sent cannot be resumed at all.
    if (!generated.resumeId || !known) return unclear;
    return { intent: "resume", readBackEn: readBack, resumeId: generated.resumeId, scenario: null, askEn: null, topicEn: null };
  }

  // Both situation intents carry the same payload and both are worthless without it. The tense is
  // the only difference, and it is the intent itself that says which.
  if (generated.intent === "new_scenario" || generated.intent === "stung") {
    const situation = generated.scenario?.situationEn.trim();
    if (!situation) return unclear;
    return {
      intent: generated.intent,
      readBackEn: readBack,
      resumeId: null,
      scenario: {
        situationEn: situation,
        whoEn: generated.scenario?.whoEn?.trim() || null,
        whenEn: generated.scenario?.whenEn?.trim() || null,
      },
      askEn: null,
      topicEn: null,
    };
  }

  if (generated.intent === "ask_phrase") {
    // askEn becomes `originalText` in the rescue, so an empty one is not a thin answer -- it is a
    // rescue for nothing. Better to admit the miss than to ask how to say "".
    const ask = generated.askEn?.trim();
    if (!ask) return unclear;
    return { intent: "ask_phrase", readBackEn: readBack, resumeId: null, scenario: null, askEn: ask, topicEn: null };
  }

  if (generated.intent === "talk") {
    // A topic is optional here: "can we talk" is a complete request, even though the answer is no.
    return { intent: "talk", readBackEn: readBack, resumeId: null, scenario: null, askEn: null, topicEn: generated.topicEn?.trim() || null };
  }

  return unclear;
}

function mockIntent(input: RouteInput): IntentResponse {
  const said = input.said.toLowerCase();
  const headline = input.open.find((item) => item.id === input.headlineId) ?? input.open[0] ?? null;

  if (headline && /\b(that one|that|again|pick up|carry on|continue|where i left)\b/.test(said)) {
    return {
      intent: "resume",
      readBackEn: headline.keyPhrase ? `${headline.keyPhrase}, again.` : "picking that back up.",
      resumeId: headline.id,
      scenario: null,
      askEn: null,
      topicEn: null,
    };
  }
  // The moment before the phrase, so a sentence carrying both lands where the real router puts it.
  if (/\b(froze|blanked|stuck|couldn't|could not|switched to english|stood there)\b/.test(said)) {
    return {
      intent: "stung",
      readBackEn: said.slice(0, 60),
      resumeId: null,
      scenario: { situationEn: input.said, whoEn: null, whenEn: null },
      askEn: null,
      topicEn: null,
    };
  }
  if (/\b(how do i say|how to say|what is the word|what's the word|c\u00f3mo se dice|como se dice)\b/.test(said)) {
    return {
      intent: "ask_phrase",
      readBackEn: "how to say that.",
      resumeId: null,
      scenario: null,
      askEn: input.said.replace(/^.*?\b(?:how do i say|how to say|what is the word for|what's the word for)\b/i, "").trim() || input.said,
      topicEn: null,
    };
  }
  if (/\b(dinner|party|call|meeting|visit|birthday|parents|interview|appointment|friday|tomorrow|weekend)\b/.test(said)) {
    return {
      intent: "new_scenario",
      readBackEn: said.slice(0, 60),
      resumeId: null,
      scenario: { situationEn: input.said, whoEn: null, whenEn: null },
      askEn: null,
      topicEn: null,
    };
  }
  if (/\b(talk|chat)\b/.test(said)) {
    return { intent: "talk", readBackEn: "just talking.", resumeId: null, scenario: null, askEn: null, topicEn: input.said };
  }
  return { intent: "unclear", readBackEn: "", resumeId: null, scenario: null, askEn: null, topicEn: null };
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "intent", openAiRequestsPerDay(), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request was incomplete." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "There was nothing to route." }, { status: 400 });
  }

  const { said, open, headlineId, focusEn } = parsed.data;
  // A headline that is not in the list would let a deictic reference resolve to something the
  // learner was never shown.
  const safeHeadline = open.some((item) => item.id === headlineId) ? headlineId : null;

  // Refused before it costs a request: nothing here can become an intent, and the model has
  // been observed turning it into one.
  if (looksLikeNoRequest(said)) {
    return NextResponse.json({
      ok: true,
      intent: "unclear",
      readBackEn: "",
      resumeId: null,
      scenario: null,
      askEn: null,
      topicEn: null,
    });
  }

  try {
    const routed = await routeIntent({ said: said.trim(), open, headlineId: safeHeadline, focusEn });
    return NextResponse.json({ ok: true, ...routed });
  } catch {
    // A router that fails must not strand the learner: `unclear` has copy on the screen and it is
    // the honest thing to say when we genuinely do not know.
    return NextResponse.json({
      ok: true,
      intent: "unclear",
      readBackEn: "",
      resumeId: null,
      scenario: null,
      askEn: null,
      topicEn: null,
    });
  }
}
