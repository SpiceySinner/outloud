import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { asideResponseJsonSchema, asideResponseSchema, asideStages, offerKindsForStage } from "@/lib/aside-schema";
import type { AsideResponse, AsideStage } from "@/lib/aside-schema";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { checkRateLimit, openAiRequestsPerDay } from "@/lib/rate-limit";

/**
 * "Step out": the learner leaves the roleplay mid-scene and talks to the coach about what is
 * actually in their way. See lib/aside-schema.ts for why this is a separate engine.
 *
 * Stateless, unlike /api/coach and /api/converse. Those two keep server-side sessions because
 * their state holds judgments the server derived and must not re-derive -- accumulated evidence,
 * the rescue card, the phase machine's position. This engine derives nothing it needs to
 * remember: the scene, the focus and the recent practice turns belong to the client and are sent
 * on every call anyway, and the only thing that accumulates is the transcript, which the client
 * is already rendering. Sending that back costs a few hundred bytes and removes an entire session
 * lifecycle -- no id to lose, no TTL, no "that aside has already closed" mid-sentence, and no
 * schema change to the shared engine_sessions table, whose `kind` check would otherwise have
 * needed a migration before any of this could run.
 *
 * The scene is not torn down while this runs -- the client keeps `conversationId`, `turnIndex`
 * and the character's current line untouched, so an aside costs no practice turns and returns to
 * exactly the sentence the learner walked away from.
 */

/** Short on purpose. A "quick word" that runs eight turns is no longer a quick word. */
const MAX_TURN_INDEX = 5;

const requestSchema = z.object({
  /** Everything the coach needs about the scene the learner just walked out of. */
  scene: z.object({
    characterEn: z.string().max(400),
    scenarioEn: z.string().max(800).nullable(),
    characterLineEs: z.string().max(800).nullable(),
    characterMeaningEn: z.string().max(800).nullable(),
  }),
  /** The blocker the session is currently pointed at, and where that came from. */
  focus: z
    .object({
      current: z.string().nullable(),
      stated: z.string().nullable(),
      observed: z.string().nullable(),
    })
    .optional(),
  /** The last few practice turns, so the coach can tell venting from a real pattern. */
  recentTurns: z
    .array(
      z.object({
        characterLineEs: z.string().max(800),
        userAttempt: z.string().max(800),
        meaning: z.string().max(120),
      }),
    )
    .max(3)
    .optional(),
  /** Who decided to step out. Changes how the coach opens; see `asideTurnGuidance`. */
  trigger: z.enum(["learner", "offered"]).optional().default("learner"),
  /**
   * Where they stepped out FROM. Decides which offers exist -- there is no scene to replace
   * during the intake, and nothing to start over once a session is running. Defaults to "session"
   * so an older client cannot accidentally unlock the intake-only offer.
   */
  stage: z.enum(asideStages).optional().default("session"),
  /** The aside so far, oldest first. Empty on the opening call. */
  exchange: z
    .array(
      z.object({
        who: z.enum(["coach", "you"]),
        text: z.string().max(1600),
      }),
    )
    .max(16)
    .optional()
    .default([]),
});

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "aside", openAiRequestsPerDay(), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request was incomplete." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Stepping out needs the scene you left." }, { status: 400 });
  }

  const { scene, focus, recentTurns, trigger, exchange, stage } = parsed.data;
  // The coach's turn number is how many times it has already spoken, so the client cannot claim a
  // later turn -- and its more decisive guidance -- than the conversation has actually reached.
  const turnIndex = Math.min(exchange.filter((entry) => entry.who === "coach").length, MAX_TURN_INDEX);
  const lastLearnerMessage = [...exchange].reverse().find((entry) => entry.who === "you")?.text ?? null;

  if (turnIndex > 0 && !lastLearnerMessage) {
    return NextResponse.json({ error: "There was nothing to answer." }, { status: 400 });
  }

  try {
    const next = await generateAsideTurn({
      scene,
      focus: focus ?? { current: null, stated: null, observed: null },
      recentTurns: recentTurns ?? [],
      trigger,
      stage,
      exchange,
      turnIndex,
      lastLearnerMessage,
    });
    return NextResponse.json(next);
  } catch (error) {
    console.error("[aside] turn failed", error);
    return NextResponse.json({ error: "OutLoud could not answer that yet." }, { status: 502 });
  }
}

type AsideInput = {
  scene: z.infer<typeof requestSchema>["scene"];
  focus: { current: string | null; stated: string | null; observed: string | null };
  recentTurns: Array<{ characterLineEs: string; userAttempt: string; meaning: string }>;
  trigger: "learner" | "offered";
  stage: AsideStage;
  exchange: Array<{ who: "coach" | "you"; text: string }>;
  turnIndex: number;
  lastLearnerMessage: string | null;
};

/**
 * The single hardest thing about this engine, stated as a turn budget.
 *
 * A coach that hears "this isn't my problem" and answers with a plan has not listened, it has
 * pattern-matched. A coach still asking gentle questions on turn five has turned a detour into a
 * therapy session, and the learner never gets back to speaking Spanish. The budget forces the
 * shape: hear it, narrow it once, say it back, offer one move.
 */
function asideTurnGuidance(turnIndex: number, trigger: "learner" | "offered") {
  if (turnIndex === 0) {
    return trigger === "offered"
      ? "This is your opening line and the learner has not spoken yet -- the room offered to step out because their last couple of replies did not land, and they took it. Do NOT assume you know why. Say in one sentence that you noticed it was not going smoothly, and ask what is actually going on. intent=probe, offer=null, done=false."
      : "This is your opening line and the learner has not spoken yet -- they walked out of the scene themselves, so something is on their mind. One short sentence inviting it: you are listening, what is up. Do not guess what it is, do not reassure them that struggling is normal, do not mention their diagnosed blocker. intent=probe, offer=null, done=false.";
  }
  if (turnIndex === 1) {
    return "They have told you something. React to THAT, not to what you expected. If it is already concrete, say back what you heard in your own words and ask ONE question that narrows it (intent=reframe or probe). If it is vague, ask the one question that would make it concrete. Still no offer: one sentence from a person is not enough to change their session on. offer=null, done=false.";
  }
  if (turnIndex === 2) {
    return "Land it this turn. If you can name what they actually want different, say it back in one line and make that offer. If you CANNOT name anything they want different -- including when they have said they are fine, or tired, or that they want to carry on -- the answer is not another question, it is kind=resume: nothing changes, and that is a real answer. Only ask one more question when they are clearly mid-thought and still telling you something (intent=probe, offer=null, done=false). Otherwise intent=offer, offer set, done=true.";
  }
  if (turnIndex < MAX_TURN_INDEX) {
    return "Land it this turn unless they are mid-thought. Name what you heard and make one offer (intent=offer, offer set, done=true).";
  }
  return "This is the last turn. Whatever you have, close it: one short line and one offer, even if that offer is just going back to the scene. intent=close, offer set, done=true.";
}

/**
 * What the coach is allowed to put in front of them, which is not the same in both places.
 *
 * During the intake there is no scene and no verdict yet, so `change_scenario` has nothing to
 * replace. What exists there instead is the biggest lever in the app: throwing away a
 * getting-to-know-you built on a wrong premise and starting it again from what the learner has
 * just said. That is the case this whole engine had to reach back into the intake for -- a
 * beginner who cannot produce Spanish at all was being asked, turn after turn, to produce Spanish.
 */
function offerRulesFor(stage: AsideStage) {
  const changeFocus = [
    'kind="change_focus" -- the situation is fine, but a DIFFERENT DIFFICULTY is the real one: not where they are, but what breaks. Set newFocus to the closest of these:',
    "   vocabulary_retrieval -- the words go missing",
    "   sentence_assembly -- the words are there but will not go together into a sentence",
    "   hesitation_pressure -- they freeze, go blank, or panic when someone is waiting on them",
    "   pronunciation_intelligibility -- they say it and are not understood",
    "   grammar_control -- the grammar falls apart once they speak at speed",
    "   naturalness_register -- understood, but it comes out like a textbook",
    "   follow_up_pressure -- the first sentence is fine, the follow-up question breaks them",
    '   "it is not the words, I just freeze" is hesitation_pressure. Someone naming a different difficulty in the same situation is asking you to look at a different thing, not to move them somewhere else.',
    "   newFocus must be DIFFERENT from the focus already set (you are given it as sessionFocus.current). Offering the focus they are already on is a button that promises a change and makes none. If the only thing you can name is what is already being worked on, that is not a change_focus -- it is a resume.",
  ];

  const resume = [
    'kind="resume" -- everything else, and it is the honest default. Most asides are someone thinking out loud. Going back having been heard is a real outcome; inventing a change so the aside feels productive is not.',
    "   If they say they are ready to continue, that it is fine, or to keep going -- resume is the ONLY correct answer, and you offer it THAT TURN. Do not ask whether they are sure, do not ask another question, do not offer them something else. Someone who just said they want to carry on should not have to say it twice. Do not read tiredness or a bad day as a request to change anything.",
  ];

  if (stage === "intake") {
    return [
      "You are still in the getting-to-know-you conversation -- there is no practice scene yet and no verdict about this learner. Work through these IN ORDER and stop at the first yes.",
      "",
      '1. Has what they said made the WHOLE conversation so far wrong -- most often that they have little or no Spanish at all and cannot produce the sentences they are being asked for, or that the thing being set up is not remotely what they came for? Then kind="start_over". Set newOpeningEn to what the intake should begin from, written the way THEY would say it about themselves ("I have basically no Spanish yet, I want to start from nothing"), never as a note about them ("learner is a beginner").',
      "   This throws away the conversation so far and asks again from the top. It is the right call surprisingly often: a getting-to-know-you built on a wrong premise gets worse every turn, not better.",
      "   Do not use it for a learner who is simply struggling with one sentence. Struggling is the point. Use it when the premise is wrong, not when the task is hard.",
      "",
      "2. " + changeFocus.join("\n"),
      "   Here this only re-points what the coming session will work on. Do not offer it while the coach is still asking what trips them up -- they can just answer the question.",
      "",
      "3. " + resume.join("\n"),
      "",
      'There is no "change_scenario" here: no scene exists yet. Never offer one.',
    ];
  }

  return [
    "Work through these three questions IN ORDER and stop at the first yes. Do not skip ahead to the one you find most interesting.",
    "",
    '1. Did they name a DIFFERENT SITUATION or DIFFERENT PEOPLE as the place they actually need this -- they will never order in a cafe, the ones they freeze in front of are their partner\'s family at dinner? Then kind="change_scenario". newScenarioEn is one sentence describing the new scene, and newCharacter NAMES the person: `name` is a FIRST NAME AND NOTHING ELSE -- one word, like Ana or Carlos or Rosa. It is never a description and never a relation: "your girlfriend\u2019s sister" is wrong, "Ana" is right, and the relation goes in `relation` where it belongs. `traitEn` is the one thing that makes them HARD. Same shape as the scene they left, because it replaces it.',
    "   Tie-break, and it comes up constantly: if they named BOTH a different situation and what goes wrong there, the SITUATION wins. Put them where they actually need this. What breaks will show itself once they are standing in the right room, and it will be real evidence instead of a guess.",
    "   A new scene is a different situation, never an easier one. Never make the new person patient, kind, calm, gentle, understanding or unhurried in order to help -- that is not a fix, it is removing the thing they came here to practise. If the old scene was hard, the new one is at least as hard.",
    "",
    "2. " + changeFocus.join("\n"),
    "",
    "3. " + resume.join("\n"),
    "",
    'There is no "start_over" here: the getting-to-know-you is finished and cannot be reopened. Never offer one.',
  ];
}

const asideSystemPromptBase = [
  "You are the OutLoud coach. The learner has just stepped out to talk to you about something that is bothering them. You are on their side and you are not in character as anyone -- if there is a person in the scene they left, that person is not here.",
  "",
  "# How you talk",
  "ENGLISH ONLY. Not one Spanish word, not even a quoted phrase. The moment you teach Spanish here you have turned their aside back into the lesson they walked out of.",
  "Every line is spoken out loud on a phone: ONE idea, under 30 words, plain sentences. No lists, no headings, no numbered steps.",
  "Lowercase, warm, direct. You sound like a good teacher who stopped the exercise to actually listen -- not like a support agent and not like a therapist.",
  "Never open with praise for the question, never say \"great point\", never say \"I hear you\". Say the thing.",
  "Ask at most ONE question per turn. Two questions in one breath is an interrogation and they will answer neither.",
  "",
  "# What you are doing",
  "Find out what is actually in their way. Not what the evaluator measured -- what THEY think is wrong. Those are often different, and when they are, theirs is the one that decides whether they come back tomorrow.",
  "Take what they say at face value. If they say the situation is useless to them, that is data, not resistance. If they say they cannot do this at all, believe them and do not talk them round.",
  "Do not defend the session, do not explain why the exercise was designed that way, do not tell them that struggling is normal. They know.",
  "",
  "OFFER_RULES_PLACEHOLDER",
  "",
  "# What you must not do",
  "Do not translate anything, do not give them a Spanish word or pattern, do not rehearse the line they were stuck on. There is a separate place for that and they did not go to it.",
  "Do not summarize their progress and do not praise their Spanish. They stepped out to talk about a problem.",
  "Do not promise anything the app cannot do: you can change the scene or change the focus, and that is all.",
].join("\n");

function asideSystemPrompt(stage: AsideStage) {
  const offerBlock = [
    "# The offer",
    "When you can name what they want different, attach exactly one offer. Never more than one, and never an offer on the first turn.",
    ...offerRulesFor(stage),
    "",
    "labelEn is button text: 2-5 words, lowercase, saying what happens.",
    "reasonEn is one short line under the button saying what changes. If nothing changes, say that plainly.",
    "NEVER invent a problem they did not state, and never upgrade a passing remark into a diagnosis so you have something to offer.",
  ].join("\n");
  return asideSystemPromptBase.replace("OFFER_RULES_PLACEHOLDER", offerBlock);
}

async function generateAsideTurn(input: AsideInput): Promise<AsideResponse> {
  if (isMockAiEnabled()) return mockAsideTurn(input);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      { role: "system", content: asideSystemPrompt(input.stage) },
      {
        role: "user",
        content: JSON.stringify({
          turnIndex: input.turnIndex,
          whyTheySteppedOut: input.trigger,
          stage: input.stage,
          sceneTheyLeft: input.scene,
          sessionFocus: input.focus,
          recentPracticeTurns: input.recentTurns,
          asideSoFar: input.exchange,
          lastLearnerMessage: input.lastLearnerMessage,
          turnGuidance: asideTurnGuidance(input.turnIndex, input.trigger),
        }),
      },
    ],
    temperature: 0.5,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "aside_response",
        strict: true,
        schema: asideResponseJsonSchema,
      },
    },
  });

  const generated = asideResponseSchema.parse(JSON.parse(response.output_text));
  return normalizeAsideTurn(generated, input.turnIndex, input.stage, input.focus.current);
}

/**
 * The server owns the structural facts about an aside turn; the model owns only what is said.
 *
 * Two of these are load-bearing rather than tidiness. An offer on turn 0 means the coach decided
 * what was wrong before the learner said a word, which is the exact failure this engine exists to
 * avoid -- so it is dropped whatever the model returns. And an offer whose payload did not
 * survive (a change_scenario with no scene in it) is downgraded to `resume` rather than rendered
 * as a button: an offer the learner accepts and that then does nothing is worse than no offer.
 */
function normalizeAsideTurn(
  generated: AsideResponse,
  turnIndex: number,
  stage: AsideStage,
  currentFocus: string | null,
): AsideResponse {
  let offer = turnIndex === 0 ? null : generated.offer;

  if (offer) {
    // An offer the stage cannot act on would render as a button that does nothing -- worse than
    // no button. The prompt says which exist; this is what happens when it is not believed.
    if (!offerKindsForStage[stage].includes(offer.kind)) {
      offer = { ...offer, kind: "resume" };
    } else if (offer.kind === "change_scenario" && !(offer.newScenarioEn?.trim() && offer.newCharacter?.name.trim())) {
      offer = { ...offer, kind: "resume" };
    } else if (offer.kind === "change_focus" && !offer.newFocus) {
      offer = { ...offer, kind: "resume" };
    } else if (offer.kind === "change_focus" && offer.newFocus === currentFocus) {
      // Observed repeatedly: asked "anything you want different?" and told "no, let's keep going",
      // the model offers to change the focus TO THE ONE ALREADY SET -- a button promising a change
      // and delivering none. The prompt forbids it and the model does it anyway, so the server
      // decides: this is a fact it holds, not a judgment call, and `resume` is the honest version
      // of the same answer.
      offer = { ...offer, kind: "resume" };
    } else if (offer.kind === "start_over" && !offer.newOpeningEn?.trim()) {
      offer = { ...offer, kind: "resume" };
    }
    offer = {
      ...offer,
      labelEn: offer.labelEn.trim() || (offer.kind === "resume" ? "back to the conversation" : "let's do that"),
      reasonEn: offer.reasonEn.trim(),
      // Payload survives only on the kind it belongs to, so the client can trust one field per kind.
      newFocus: offer.kind === "change_focus" ? offer.newFocus : null,
      newScenarioEn: offer.kind === "change_scenario" ? offer.newScenarioEn : null,
      newCharacter: offer.kind === "change_scenario" ? offer.newCharacter : null,
      newOpeningEn: offer.kind === "start_over" ? offer.newOpeningEn : null,
    };
  }

  // The budget is the server's, not the model's: the model can be talked into another turn, the
  // learner's patience cannot. An aside at the cap always ends carrying something.
  const forcedClose = turnIndex >= MAX_TURN_INDEX;
  if (forcedClose && !offer) {
    offer = {
      kind: "resume",
      labelEn: "back to the conversation",
      reasonEn: "nothing changes -- we pick up exactly where you left off.",
      newFocus: null,
      newScenarioEn: null,
      newCharacter: null,
      newOpeningEn: null,
    };
  }

  return {
    ...generated,
    turnIndex,
    sayEn: generated.sayEn.trim() || "tell me what's going on.",
    offer,
    // `done` is a function of whether there is something to act on, never of the model's mood.
    done: forcedClose || Boolean(offer),
  };
}

function mockAsideTurn(input: AsideInput): AsideResponse {
  if (input.turnIndex === 0) {
    return {
      turnIndex: 0,
      sayEn:
        input.trigger === "offered"
          ? "that wasn't landing, was it. what's actually going on?"
          : "okay, we're out of the scene. what's on your mind?",
      intent: "probe",
      offer: null,
      done: false,
    };
  }
  if (input.turnIndex === 1) {
    return {
      turnIndex: 1,
      sayEn: "so it's less the words and more the situation. is that right?",
      intent: "reframe",
      offer: null,
      done: false,
    };
  }

  const said = (input.lastLearnerMessage ?? "").toLowerCase();
  const resume = {
    kind: "resume" as const,
    labelEn: "back to the conversation",
    reasonEn: "nothing changes -- we pick up exactly where you left off.",
    newFocus: null,
    newScenarioEn: null,
    newCharacter: null,
    newOpeningEn: null,
  };

  if (input.stage === "intake") {
    const beginner = said.includes("beginner") || said.includes("completely new") || said.includes("no spanish");
    return {
      turnIndex: input.turnIndex,
      sayEn: beginner ? "then we started in the wrong place. let's back up." : "got it. let's carry on.",
      intent: "offer",
      offer: beginner
        ? {
            ...resume,
            kind: "start_over",
            labelEn: "start again from there",
            reasonEn: "we throw this out and begin from where you actually are.",
            newOpeningEn: "I have basically no Spanish yet -- I want to start from nothing.",
          }
        : resume,
      done: true,
    };
  }

  const wantsNewScene = said.includes("scene") || said.includes("situation") || said.includes("cafe");
  return {
    turnIndex: input.turnIndex,
    sayEn: wantsNewScene
      ? "then let's put you somewhere that actually matters to you."
      : "got it. let's go back and keep going.",
    intent: "offer",
    offer: wantsNewScene
      ? {
          ...resume,
          kind: "change_scenario",
          labelEn: "try a different scene",
          reasonEn: "same focus, a situation you would actually be in.",
          newScenarioEn: "You are on the phone with a landlord who wants an answer now.",
          newCharacter: { name: "Rosa", relation: "your landlord", traitEn: "brisk, and she does not repeat herself" },
        }
      : resume,
    done: true,
  };
}
