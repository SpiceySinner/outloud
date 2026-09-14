import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { coachResponseJsonSchema, coachResponseSchema, type CoachPhase, type CoachResponse } from "@/lib/coach-schema";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { needsWordsEn } from "@/lib/stuck-signal";
import { naturalSpanishSystemPrompt } from "@/lib/natural-spanish";
import { checkRateLimit, openAiRequestsPerDay } from "@/lib/rate-limit";
import { createSession, deleteSession, loadSession, saveSession } from "@/lib/session-store";

/**
 * The adaptive coach that replaces the fixed placement questions. It hears what trips the
 * learner up, asks one real question at a time, and is allowed to teach from the very first
 * stumble by picking a UI tool (keyword card, sentence frame, say-it-back, ...). Diagnosis
 * happens on the side: every reply carries `evidence` about the last attempt, and `done` flips
 * once the coach has seen enough for the verdict.
 */

type CoachState = {
  mode: "speaks-first" | "stung" | "upcoming";
  openingAnswer: string;
  context: { who: string; dialect: string; tone: string };
  /** Where the conversation is: framing -> scenario -> coaching -> closing. */
  phase: CoachPhase;
  /** One rotation topic drawn at start so option B is not always the same. */
  rotationTopic: string;
  /** Set once the learner picked a direction -- or before the first turn, if they already had. */
  chosenScenario: string | null;
  /**
   * Whether this session has a framing turn at all. Fixed at start and never recomputed, which is
   * the point: `chosenScenario` becomes non-null for EVERY session the moment framing is answered,
   * so it cannot double as "we skipped framing" once the session is under way.
   */
  skipsFraming: boolean;
  turns: Array<{
    turnIndex: number;
    sayEs: string;
    phase: CoachPhase;
    intent: CoachResponse["intent"];
    tool: CoachResponse["tool"]["type"];
    options?: CoachResponse["tool"]["options"];
    expectedCommunicativeFunction: string;
    userAttempt?: string;
    inputMode?: "spoken" | "written";
  }>;
  evidence: NonNullable<CoachResponse["evidence"]>[];
  currentTurnIndex: number;
};

// Everyday situations the coach can offer as the "other" direction next to the learner's own
// context. Real, low-stakes, and each one forces actual speaking rather than a yes/no.
const rotationTopics = [
  "ordering food or coffee and changing something about the order",
  "small talk with a neighbour or colleague about the weekend",
  "explaining to a friend why you were late",
  "asking for directions and checking you understood",
  "telling someone about your job in two sentences",
  "making plans with a friend for next week",
  "returning something to a shop and saying what is wrong with it",
  "talking about a show, a game, or a song you liked recently",
];

const configuredMaxTurns = Number(process.env.MAX_COACH_TURNS ?? 8);
const MAX_TURN_INDEX = Math.max(3, Math.min(11, Number.isFinite(configuredMaxTurns) ? configuredMaxTurns - 1 : 7));

const contextSchema = z.object({
  who: z.string().min(1).max(80),
  dialect: z.string().min(1).max(80),
  tone: z.string().min(1).max(80),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    mode: z.enum(["speaks-first", "stung", "upcoming"]).default("speaks-first"),
    openingAnswer: z.string().min(1).max(1600),
    /**
     * The situation, already named and verified before the session started -- the entry router
     * only returns `stung` when it carries one. When this is set there is nothing left for a
     * framing turn to ask, so there is no framing turn.
     */
    namedScenario: z.string().max(400).nullable().optional().default(null),
    context: contextSchema,
  }),
  z.object({
    action: z.literal("respond"),
    coachId: z.string(),
    userAttempt: z.string().min(1).max(1600),
    inputMode: z.enum(["spoken", "written"]).default("spoken"),
  }),
  z.object({
    action: z.literal("close"),
    coachId: z.string(),
  }),
]);

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "coach", openAiRequestsPerDay(), 24 * 60 * 60 * 1000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Coach request is incomplete." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Coach request is incomplete." }, { status: 400 });
  }

  try {
    if (parsed.data.action === "start") {
      const coachId = crypto.randomUUID();
      /*
       * Settled before the first turn when we already know what they are practising: `upcoming`
       * always does (they named the event and the app named the part of it), and `stung` does
       * whenever the entry router handed one over. Everything else earns it on turn 0.
       */
      const settledScenario =
        parsed.data.mode === "upcoming"
          ? parsed.data.openingAnswer.trim()
          : parsed.data.namedScenario?.trim() || null;
      const state: CoachState = {
        mode: parsed.data.mode,
        openingAnswer: parsed.data.openingAnswer.trim(),
        context: parsed.data.context,
        phase: settledScenario ? "scenario" : "framing",
        rotationTopic: rotationTopics[Math.floor(Math.random() * rotationTopics.length)],
        chosenScenario: settledScenario,
        skipsFraming: settledScenario !== null,
        turns: [],
        evidence: [],
        currentTurnIndex: 0,
      };
      const first = await generateTurn(coachId, state, null, 0);
      recordTurn(state, first);
      // Persisted only once the opening turn exists: a failed generation leaves no stray row.
      if (!first.done) await createSession("coach", coachId, state);
      return NextResponse.json(first);
    }

    const state = await loadSession<CoachState>("coach", parsed.data.coachId);
    if (!state) {
      return NextResponse.json({ error: "Coach session expired. Start again." }, { status: 404 });
    }

    if (parsed.data.action === "close") {
      await deleteSession("coach", parsed.data.coachId);
      return NextResponse.json({ ok: true });
    }

    const userAttempt = parsed.data.userAttempt.trim();
    if (!state.turns.length) {
      return NextResponse.json({ error: "Coach session expired. Start again." }, { status: 404 });
    }

    const last = state.turns[state.turns.length - 1];
    state.turns[state.turns.length - 1] = { ...last, userAttempt, inputMode: parsed.data.inputMode };
    if (last.phase === "framing" && last.tool === "path_choice") {
      state.chosenScenario = pickScenario(state, userAttempt);
    }

    const nextTurnIndex = state.currentTurnIndex + 1;
    const next = await generateTurn(parsed.data.coachId, state, userAttempt, nextTurnIndex);
    recordTurn(state, next);
    state.currentTurnIndex = nextTurnIndex;
    // The state object is a local copy of the stored row, so every mutation above has to be
    // written back explicitly -- there is no shared reference doing it for us any more.
    if (next.done) await deleteSession("coach", parsed.data.coachId);
    else await saveSession("coach", parsed.data.coachId, state);
    return NextResponse.json(next);
  } catch {
    return NextResponse.json({ error: "Outloud could not continue coaching yet." }, { status: 502 });
  }
}

/**
 * The phase is a function of where we are, never of what the model labelled. Trusting the model's
 * own `phase` once let a mislabelled scenario turn drag the session back into framing forever.
 *
 * **A session whose situation is already settled has no framing turn.** Framing exists to ask
 * which of two situations to practise in, and somebody who has just named their landlord call, or
 * the pharmacy they froze in, has already answered that question. Asking it anyway is the "what
 * was the point of telling it my problem?" failure rebuilt one screen later -- and offering them a
 * rotation topic next to their own dreaded call is worse than not asking at all. So turn 0 sets
 * the scene and turn 1 is already coaching.
 *
 * The test is the settled scenario, not the mode. `mode` was only ever standing in for it, and it
 * stood in badly: `stung` reaches this the same way `upcoming` does whenever the entry router
 * hands over a situation, and asked the question anyway. Somebody whose whole answer is "I just
 * froze, I don't know" still gets framing, which is right -- for them the two concrete options
 * are the help, not the insult.
 */
function phaseForTurn(turnIndex: number, done: boolean, skipsFraming: boolean): CoachPhase {
  if (done) return "closing";
  if (skipsFraming) return turnIndex === 0 ? "scenario" : "coaching";
  if (turnIndex === 0) return "framing";
  if (turnIndex === 1) return "scenario";
  return "coaching";
}

/**
 * Rows written before `skipsFraming` existed do not have it. Falling back to the old rule keeps a
 * session that is already in flight on the pacing it started with, instead of shifting every
 * remaining turn by one under a learner mid-sentence.
 */
function skipsFramingFor(state: CoachState) {
  return state.skipsFraming ?? state.mode === "upcoming";
}

function recordTurn(state: CoachState, turn: CoachResponse) {
  state.phase = turn.phase;
  state.turns.push({
    turnIndex: turn.turnIndex,
    sayEs: turn.sayEs,
    phase: turn.phase,
    intent: turn.intent,
    tool: turn.tool.type,
    options: turn.tool.options,
    expectedCommunicativeFunction: turn.expectedCommunicativeFunction,
  });
  if (turn.evidence && turn.phase === "coaching") state.evidence.push(turn.evidence);
}

function realAttemptCount(state: CoachState) {
  // Spanish attempts that answered a probe/advance question -- not setup answers, not repeats.
  return state.turns.filter(
    (turn) => turn.userAttempt && turn.phase === "coaching" && turn.intent !== "retry" && turn.intent !== "teach",
  ).length;
}

/**
 * Which situation the session is built in, once they have answered the framing question.
 *
 * **Their word wins.** Timo's rule, 2026-09-14, and it replaces what was here: *wenn ich sage,
 * welches Szenario ich möchte, dann nehmen wir das, egal ob es vorgeschlagen war.*
 *
 * What was here tried to MAP their answer onto one of the two offered directions, by counting how
 * many words longer than three characters the answer shared with each option. That is a decent
 * idea and it fails on ordinary English. He was offered "ordering at a cafe" and said he wanted a
 * restaurant; the option's own text carries words like "want" and "order", his sentence carried
 * one of them, the option scored above zero, and the escape hatch below it only opened for answers
 * of six words or more. So "in a restaurant" -- three words, a completely different place --
 * resolved to the cafe, and the app practised the scene he had just turned down.
 *
 * The shape of that bug is the same one this repo has now paid for three times in a week: a list
 * of words standing in for a judgment. So the matching is gone. What is left is the part that is
 * genuinely closed and cannot grow:
 *
 *   an ordinal        -- "the first one", "die zweite" -- points at an option, so take it
 *   bare agreement    -- "yes", "sure", "egal", "you choose" -- they deferred, so option A stands
 *   anything else     -- their words, exactly as they said them
 *
 * The model still gets the raw answer and both options, so a pointer it can read and this cannot
 * ("the cafe one") is resolved where that judgment belongs. The one thing it may never do is
 * overrule a place they named.
 */
const deferredToUs = new Set([
  "yes", "yeah", "yep", "ok", "okay", "sure", "fine", "either", "whatever", "any", "anything",
  "you", "your", "choose", "pick", "decide", "one", "both", "that", "this", "sounds", "good",
  "works", "great", "lets", "let", "us", "go", "do", "it", "please", "thanks", "thank",
  // He talks to it in German as often as English.
  "ja", "gerne", "egal", "klar", "passt", "such", "aus", "du", "beides", "eins", "danke",
]);

function pickScenario(state: CoachState, answer: string) {
  const framing = [...state.turns].reverse().find((turn) => turn.phase === "framing" && turn.options?.length);
  const options = framing?.options ?? [];
  const trimmed = answer.trim();
  if (!options.length) return trimmed;
  const optionA = options[0];
  const optionB = options[1] ?? options[0];
  const lower = trimmed.toLowerCase();

  // Pointing at one of the two, which is the only case where the option beats their sentence.
  if (/\b(first|1|former|erste|ersten|erstes)\b/.test(lower)) return optionA.scenarioEn;
  if (/\b(second|2|latter|other|zweite|zweiten|zweites|andere)\b/.test(lower)) return optionB.scenarioEn;

  const words = lower.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  // Nothing of their own in it: they handed the choice back, and option A is their own context.
  if (!words.length || words.every((word) => deferredToUs.has(word))) return optionA.scenarioEn;

  // They named something. That is the scene, whether or not it was on the menu.
  return trimmed;
}

async function generateTurn(
  coachId: string,
  state: CoachState,
  userAttempt: string | null,
  turnIndex: number,
): Promise<CoachResponse> {
  const mustFinish = turnIndex >= MAX_TURN_INDEX;

  if (isMockAiEnabled()) {
    return mockTurn(coachId, state, userAttempt, turnIndex, mustFinish);
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI is not configured.");
  }

  // The coach turn this attempt was answering -- already updated with userAttempt by the caller.
  const repliedTo = state.turns.length ? state.turns[state.turns.length - 1] : null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      { role: "system", content: systemPrompt(state) },
      {
        role: "user",
        content: JSON.stringify({
          coachId,
          turnIndex,
          mode: state.mode,
          openingAnswer: state.openingAnswer,
          context: state.context,
          currentPhase: state.phase,
          rotationTopic: state.rotationTopic,
          chosenScenario: state.chosenScenario,
          priorTurns: state.turns,
          evidenceSoFar: state.evidence,
          realAttemptsSoFar: realAttemptCount(state),
          lastUserAttempt:
            userAttempt === null || !repliedTo
              ? null
              : {
                  text: userAttempt,
                  answering: {
                    phase: repliedTo.phase,
                    coachLine: repliedTo.sayEs,
                    expected: repliedTo.expectedCommunicativeFunction,
                  },
                  checkFirst:
                    "Before anything else decide: does `text` actually answer `answering.coachLine`? " +
                    "If YES: react to its content in character. " +
                    "If NO (off-topic or misunderstood, e.g. talking about returning a shirt when asked about their day): your line MUST address that in character with warm confusion, and evidence.observedBlocker MUST be 'comprehension mismatch' -- never 'none'.",
                },
          lastAttemptLooksFine: userAttempt !== null && attemptLooksFine(userAttempt),
          lastAttemptLooksMixed: userAttempt !== null && attemptLooksMixed(userAttempt),
          lastAttemptDeclaresStuck: userAttempt !== null && attemptDeclaresStuck(userAttempt),
          alreadyAsked: state.turns.map((turn) => turn.sayEs),
          pacing: pacingGuidance(
            state,
            turnIndex,
            realAttemptCount(state),
            mustFinish,
            userAttempt !== null && attemptLooksFine(userAttempt),
            userAttempt !== null && attemptLooksMixed(userAttempt),
            userAttempt !== null && attemptDeclaresStuck(userAttempt),
          ),
        }),
      },
    ],
    temperature: 0.4,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "coach_turn",
        strict: true,
        schema: coachResponseJsonSchema,
      },
    },
  });

  const generated = coachResponseSchema.parse(JSON.parse(response.output_text));
  return normalizeTurn(generated, coachId, turnIndex, mustFinish, userAttempt === null, skipsFramingFor(state));
}

function normalizeTurn(
  turn: CoachResponse,
  coachId: string,
  turnIndex: number,
  mustFinish: boolean,
  isOpening: boolean,
  skipsFraming: boolean,
): CoachResponse {
  const noTool = { type: "none" as const, primaryEs: null, primaryEn: null, exampleEs: null, noteEn: null, options: null };
  // Framing (and the choice chips) happen exactly once, on turn 0. Never let the model finish
  // early during setup either -- the learner has not spoken Spanish yet.
  const done = mustFinish || (turn.done && turnIndex >= 2);
  const phase = phaseForTurn(turnIndex, done, skipsFraming);
  const reoffered = phase !== "framing" && turn.tool.type === "path_choice";
  const tool = turn.tool.type === "none" || reoffered ? noTool : turn.tool;
  return {
    ...turn,
    coachId,
    turnIndex,
    tool,
    phase,
    evidence: isOpening || phase !== "coaching"
      ? null
      : turn.evidence ?? { observedBlocker: "unclear", confidence: "low", noteEn: "No specific issue observed on this attempt." },
    // Pinned to the scenario turn for the same reason `selfReportedBlocker` is pinned to framing:
    // this is the one turn that introduces the person, and a later turn quietly replacing them
    // would leave the learner talking to someone who was never introduced.
    sceneCharacter: phase === "scenario" ? turn.sceneCharacter : null,
    // Pinned to the framing turn structurally, not just by prompt: it is the only turn that has
    // read the opening answer, and a later turn overwriting it would silently replace what the
    // learner said about themselves with the model's own running read.
    selfReportedBlocker: phase === "framing" ? turn.selfReportedBlocker : null,
    done,
    doneReason: mustFinish && !turn.doneReason ? "Enough for a first read." : turn.doneReason,
    intent: mustFinish ? "wrap_up" : turn.intent,
  };
}

// Cheap surface read of an attempt: a few words, no English filler, no explicit "I don't know".
// Only a hint for pacing -- the model still judges the content.
const englishWords =
  /\b(uh|um|how do you say|i don't know|i dont know|the|and|with|went|was|is|do|you|want|wanna|can|like|have|my|your|what|where|when|this|that|it's|its|i'm|im|are|we|they|for|but|not|really|maybe|thing|something)\b/i;

// The attempt contains English function words -> the learner is code-switching or lost.
function attemptLooksMixed(attempt: string) {
  return englishWords.test(attempt) || /no s[eé] c[oó]mo/i.test(attempt) || attempt.includes("...");
}

function attemptLooksFine(attempt: string) {
  const words = attempt.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3 && !attemptLooksMixed(attempt) && !attemptDeclaresStuck(attempt);
}

/**
 * The learner saying, in plain English, that they cannot answer.
 *
 * This exists because "no idea honestly" passed `attemptLooksFine` -- three words, no English
 * function words in the list -- so the server itself told the model "the last attempt looks fine,
 * tool MUST be none, ask a NEW question". The coach then replied "¡Qué rico! ¿qué más hiciste?",
 * reacting warmly to a steak sentence the learner had just said they could not produce.
 *
 * ENGLISH ONLY, deliberately. A learner asked something in Spanish who answers "no sé" has given a
 * real and correct Spanish answer; treating that as a cry for help would take a good turn away
 * from them. Declaring it in English is stepping out of the task, and that is the signal.
 */
/*
 * The detector now lives in `lib/stuck-signal.ts` and is imported by the room as well.
 *
 * It was inlined here, and the harness that verified it carried a copy. When the pattern turned
 * out to be broken -- it only ever matched a straight apostrophe, so nothing typed on a phone
 * matched at all -- the copy was broken identically and the test agreed with the bug. One home,
 * so a fix reaches every caller and a check cannot quietly share the fault it is checking for.
 */
function attemptDeclaresStuck(attempt: string) {
  // Both shapes: "I don't know how to say it" and "how do I say it". Somebody who half speaks the
  // language mostly does the second, mid-sentence, and only the first was ever recognised.
  return needsWordsEn(attempt);
}

function pacingGuidance(
  state: CoachState,
  turnIndex: number,
  realAttempts: number,
  mustFinish: boolean,
  lastLooksFine: boolean,
  lastLooksMixed: boolean,
  lastDeclaresStuck: boolean,
) {
  if (mustFinish) {
    return "This is the last turn: phase=closing, say one warm closing line (no new question), set done=true, tool=none.";
  }
  // Checked before everything else: a learner who has just said they do not know must not be
  // handled by any branch that assumes they attempted something.
  /*
   * The second half of this note is not a flourish. With only the first half, the coach reliably
   * handed over a phrase -- for the wrong thing. Somebody who had said they could not say "I'll
   * take care of it" was given "Quisiera un café y un sándwich", because `chosenScenario` was a
   * cafe and "the SAME thing" read as "the same as the scene".
   *
   * Helping confidently with something nobody asked about is the "what was the point of telling it
   * my problem?" failure with a tool attached, and it is worse than not helping: it looks like
   * listening.
   */
  const stuckNote = lastDeclaresStuck
    ? " THEY HAVE JUST TOLD YOU, IN ENGLISH, THAT THEY DO NOT KNOW. Never react as though they said the thing you were hoping for -- no \"¡qué rico!\", no \"perfecto\", no reacting to content that does not exist. This turn MUST carry a tool (keyword_card, sentence_frame, say_it_back or preparation_time), intent=retry or teach, and your line invites them to use it. Asking a new question here leaves them exactly where they are." +
      " WHAT the tool carries is decided by THEM, not by the scene: it is the thing they said they could not say. If this turn is vague (\"I still don't know how to say it\"), the \"it\" is whatever they named earlier in this conversation -- look back and find it. Do NOT substitute the topic of chosenScenario. Handing somebody a phrase about ordering coffee when they told you they were stuck on telling their girlfriend's mother they would take care of something is worse than saying nothing: it looks like listening and it is not."
    : "";
  const fineNote = lastLooksFine
    ? " The last attempt looks fine on the surface: if it really answered you, tool MUST be none and you ask a NEW question about a different detail or a related situation (never one from alreadyAsked)."
    : lastLooksMixed && turnIndex >= 2
      ? " The last attempt contains English or a freeze: this is a stumble. You MUST repair now -- pick keyword_card, sentence_frame or say_it_back with the Spanish they were missing, intent=retry, and in character invite them to say the same thing again. Do NOT ask a new question."
      : "";
  /*
   * A session that skips framing is one turn ahead of one that does not, so every branch below
   * shifts. Shifting the index here rather than duplicating the branches keeps the pacing rules --
   * when to repair, when to raise pressure, when it may finish -- identical either way, which is
   * the whole reason they are written once.
   */
  const step = skipsFramingFor(state) ? turnIndex + 1 : turnIndex;

  if (step === 0) {
    return `Framing turn, IN ENGLISH. phase=framing, intent=probe, tool=path_choice with exactly two options. Structure of sayEs: (1) one short sentence that shows you heard them -- name the problem naturally, in your own words, like a coach would ("Words going missing mid-sentence -- that is the most common one."). NEVER start with "You said" and never quote their answer back; that phrasing is reserved for quoting their Spanish later. (2) one sentence that makes it normal and workable; (3) end with ONE question offering two concrete SITUATIONS to try it in, e.g. "Where do you want to try it first -- ordering at a cafe, or telling a friend about your weekend?". Both options MUST be situations (a place + a person + something to get done), phrased in the same grammatical form, never the skill itself (never "talking about vocabulary", "sentence structure practice", "grammar"). Option A: the situation from THEIR opening answer if they mentioned a place/person/moment; if they only named a skill, pick the everyday situation where exactly that skill bites hardest. Option B: a concrete situation built from rotationTopic: "${state.rotationTopic}". Each option: labelEn = 3-6 words naming the situation (shown as a button, e.g. "Ordering at a cafe"), scenarioEn = one sentence describing the scene: who they talk to and what they want. sayEs stays under 32 words total -- it is spoken AND shown on a phone screen. No Spanish yet.`;
  }
  /*
   * They answered the framing question by telling us, in English, that they have no words.
   *
   * The scenario turn below is hardcoded to `intent=probe, tool=none` and ends by demanding
   * Spanish -- so running it here sets a scene in front of somebody who has just said they cannot
   * enter one, and asks them for the very thing they said they do not have. Every later turn is
   * already protected by `stuckNote`; this one was not, because its instruction says the opposite
   * and a note appended to it would just contradict itself.
   *
   * So the turn changes shape instead of gaining a footnote. The scene still gets set and
   * `sceneCharacter` still gets filled -- naming the person is the valuable half and everything
   * downstream needs it -- but the turn ends by handing over words rather than asking for them.
   *
   * Structural for the same reason the framing turn was in #30: the turn machine is what produces
   * the turn, and a prompt cannot argue a turn out of the instruction that defines it.
   */
  if (step === 1 && lastDeclaresStuck) {
    return `Scenario turn, IN ENGLISH, and they have just told you IN ENGLISH that they do not know how to say it. Do NOT ask them for Spanish this turn. phase=scenario, intent=teach.

chosenScenario is "${state.chosenScenario ?? "their own context from the opening answer"}" -- but if what they just said named a different person, place or thing they wanted to say, THAT is the scene. What they just told you outranks anything chosen earlier.

Still set the scene in one concrete sentence naming the person and what they are like -- a first name, their relation to the learner, and the one trait that makes them hard -- and still fill sceneCharacter with exactly that person (name, relation, traitEn). The practice that follows is with them.

Then, instead of inviting them to speak: hand them the words. Pick ONE tool (keyword_card, sentence_frame or say_it_back) carrying the Spanish for THE THING THEY JUST SAID THEY COULD NOT SAY -- not a general phrase, not a greeting, the actual thing. Your line ends by inviting them to use it. Never end this turn on a question that leaves them exactly as stuck as they were: they told you what they needed, and the only useful next move is to give it to them.

sayEs under 40 words and entirely in English; the Spanish belongs in the tool.`;
  }
  if (step === 1) {
    return `Scenario turn, IN ENGLISH. phase=scenario, intent=probe, tool=none (or preparation_time if their opening answer suggests they freeze). chosenScenario is "${state.chosenScenario ?? "their own context from the opening answer"}" -- and it is WHAT THEY SAID, not one of the two directions you offered. If it points at one of them ("the cafe one"), use that direction. Otherwise it is their own, and it OUTRANKS anything you put in front of them: somebody who was offered a cafe and answered "a restaurant" gets a restaurant. Never steer them back to an option they turned down. NEVER offer the two directions again and never use path_choice from now on.${
      skipsFramingFor(state)
        ? state.mode === "upcoming"
          ? " This is the FIRST turn of the session and they have not spoken to you yet, so open with one short sentence acknowledging the thing they are preparing for -- in the future, as something that has not happened -- before you set the scene. Do NOT ask them where they want to practise or offer them anything to choose between: they already told you, and chosenScenario is it."
          : " This is the FIRST turn of the session and they have not spoken to you yet, so open with one short sentence acknowledging what happened to them -- as something that ALREADY went wrong, never as something coming up -- before you set the scene. Do NOT ask them where they want to practise or offer them anything to choose between: they already told you, and chosenScenario is it. The scene you set is that same situation, run again, so they get to say this time what they could not say then."
        : ""
    } YOU set the scene in one concrete sentence that NAMES the person and says what they are like -- a first name, their relation to the learner, and the one trait that makes them hard (e.g. "This is Carmen, your girlfriend's aunt -- warm, but she talks fast and won't slow down for you." or "This is Marco behind the counter -- friendly, but it is lunchtime and there are five people behind you."). A named stranger with a temperament is the whole point: the learner freezes in front of people, not in front of an exercise. Never a role alone ("the waiter"), never a name alone. Also fill sceneCharacter with exactly that person: name (first name only), relation (how they relate to the learner), traitEn (the one thing that makes them hard). It must match the sentence you just said, because the practice session that follows is with this same person. Then invite them: show me what you would say -- in Spanish, however it comes out. Do NOT ask them to describe the scene; you describe it, they speak in it. End on that invitation. sayEs under 40 words and ENTIRELY IN ENGLISH (the learner speaks Spanish next, you do not). No Spanish sentence to repeat; the point is that THEY produce it.`;
  }
  if (step === 2) {
    return `First coaching turn, phase=coaching. If instead of Spanish they told you in English that they do not have the words, do not know where to start, or do not know what their problem is, do NOT open the scene and wait for them: hand them the words for the things THEY just described, with one tool, and invite them to use those. Someone who has just said they cannot enter this scene will not be helped by being dropped into it. If the learner only agreed ("yes", "ok", "sure") or hesitated instead of speaking Spanish, become the other person in chosenScenario and open the scene with ONE short natural Spanish line they now have to answer (e.g. the waiter greeting them). If they already produced Spanish, react as the other person in the scene and continue -- and if what they produced was a QUESTION to you, your line is the ANSWER to it, with real invented detail, never the same question aimed back at them. If what they produced is broken or half English (e.g. "do you wanna fiesta"), that IS the first stumble: repair now with one tool (keyword_card / sentence_frame / say_it_back), intent=retry, and let them say it again -- do not restart, do not re-explain the setup.${fineNote}${stuckNote}`;
  }
  if (realAttempts < 2) {
    return "Early coaching, phase=coaching, stay inside chosenScenario as the other person. You have little evidence. If the last attempt stumbled, help NOW with one tool and let them retry the same thing (intent=retry). If it went fine, advance with a slightly harder connected question (intent=advance)." + fineNote + stuckNote;
  }
  if (realAttempts < 4) {
    return "Middle coaching, phase=coaching, stay inside chosenScenario (a small twist is fine): raise pressure only if the last attempt was solid (a follow-up, a changed context). Keep helping instantly when something breaks. Set done=true once you can name the main blocker with medium or high confidence AND the learner has had at least one successful retry." + fineNote + stuckNote;
  }
  return "Late coaching, phase=coaching: wrap up soon. If you can name the main blocker with at least medium confidence, say a short warm closing line and set done=true." + fineNote + stuckNote;
}

function systemPrompt(state: CoachState) {
  /*
   * Three ways in, and the tense is the difference that matters.
   *
   * `stung` is the past: something already went wrong and they are still holding it. `upcoming`
   * is the future -- a real thing on a real date that has not happened yet -- and running that
   * through the stung wording produces a coach that talks about their dinner as though they had
   * already failed at it. Nothing has happened. That is the entire point of the mode.
   */
  const situation =
    state.mode === "stung"
      ? "The learner arrived from a real moment where they could not say something. Their opening answer describes that moment; treat it as the situation to practice in."
      : state.mode === "upcoming"
        ? "The learner has something REAL COMING UP that they are dreading, and their opening answer describes it. It has not happened yet: never speak about it in the past tense and never imply they have already struggled with it. Treat it as the situation to practice in, and make the framing turn about what specifically worries them about it rather than about their Spanish in general."
        : "The learner just told you, in their own words, what usually trips them up when they speak Spanish.";

  return `
# Role
You are OutLoud's spoken Spanish coach in a live voice session with one nervous adult learner. ${situation}
${naturalSpanishSystemPrompt}

# Shape of the session
${
  state.mode === "upcoming"
    ? `1. scenario (turn 0, English): they have ALREADY told you what they are preparing for and which part of it this is, so there is nothing to choose. Set the scene and invite them to speak.
2. coaching (Spanish, from turn 1): you play the other person in that scene; cold water with a lifeline.
3. closing: one warm line, done=true.
There is NO framing turn and you never use path_choice. Always set "phase" to the phase you are in. Only the scenario turn is in English.`
    : `1. framing (turn 0 ONLY, English): mirror what trips them up, offer two directions (path_choice). This happens exactly once; from turn 1 on the directions are settled and you never re-ask.
2. scenario (turn 1, English): invite them to show what they would say in the direction they picked.
3. coaching (Spanish): you play the other person in that scenario; cold water with a lifeline.
4. closing: one warm line, done=true.
Always set "phase" to the phase you are in. Only framing and scenario are in English.`
}

# How you work (coaching phase)
- Cold water with a lifeline: ask ONE real, short question in Spanish that makes the learner actually speak — but the moment they stumble (empty, half-English, freeze, garbled), help immediately with exactly one tool and let them try the same thing again. Teaching is always allowed; diagnosis happens on the side.
- Adapt everything to what they said trips them up. Missing words -> questions that need retrieval, keyword cards. Freezing under follow-ups -> unexpected but gentle follow-ups, preparation_time. Grammar -> sentence frames. Pronunciation -> say_it_back with slow_repeat.
- From the scenario turn on you ARE the person you named -- same name, same temperament, every turn. Never rename them, never drop back into being a neutral coach mid-conversation, and never refer to yourself in the third person.
- One idea per turn. sayEs is what you SAY OUT LOUD: max ~20 words, one question or one instruction. Never stack a question and an explanation in the same line.
- TALKING ABOUT THE TASK IS NOT ATTEMPTING IT. If they explain in English what they would try, say they do not have the words, ask how to say something, or tell you they are lost -- that is a reply, but it is not a Spanish attempt. Never answer it with "¿cómo?" or in-character confusion, and never pick one Spanish-looking fragment out of a paragraph of English and ask about that. They have just told you exactly what they need. Give it to them.
- Build the help out of what THEY said. If they told you their day was programming, a bit of work and a steak, the words you hand over are those: "trabajé", "programé", "comí un bistec". Handing them an unrelated stock phrase from the scene instead is the tell that you were not listening, and they feel it immediately.
- NEVER praise a non-answer. "no idea", "I don't know", "I can't", a shrug -- these get help on your very next line, never "perfecto", never "muy bien", and never a fresh question that leaves them exactly as stuck as they were. If they told you they are stuck, that turn MUST carry a tool: hand them the word, the frame or the way in. A question with tool=none after "no idea" is the same dead end asked twice.
- IF THEY ASKED YOU SOMETHING, ANSWER IT. This is the rule that gets broken. Every other line here tells you to ask a question, so when a learner asks YOU one -- for directions, for the price, for the bill, for a favour -- the pull is to ask one back. Do not. Answer it, in character, with real specific content you invent on the spot: you are the person who lives here, so you know where the museum is, what it costs, and how long it takes. "¿Puedes decirme si el museo está cerca?" is a catastrophic reply to "¿dónde está el museo?" -- it hands their own question back and the scene stops being a conversation.
- Whole scenarios are built on the learner needing something from you: asking directions, ordering, shopping, phoning, asking for help. In those, MOST of your turns are answers, not questions. Answer first. Only then, if it is natural, add one short follow-up ("está a dos cuadras, junto al parque. ¿Vas caminando?"). The answer always comes first and is never replaced by the follow-up.
- Never test for the sake of testing. Every question must be something a real person might ask.
- Tools are for repair, not decoration: attach a tool ONLY when the last attempt showed a need (or the learner asked). A good answer gets tool=none and a new question.
- When you attach keyword_card, sentence_frame or say_it_back, intent MUST be retry and sayEs invites them to try the SAME thing again, in character, without moving on to a new question. Match the invitation to what actually happened. After a garbled or half-heard Spanish attempt, warm non-comprehension fits: "¿cómo? ¿la comida está...?". After they told you IN ENGLISH that they are stuck, it does not -- you understood them completely, and playing confused at a clear sentence is the single most alienating thing you can do. There, use the word you are handing them and invite them into it: "¿Un bistec? Dime: comí un bistec." or "Entonces empieza así: quiero un café.".
- In coaching you ARE the other person in the scene. No meta-talk: never say "dime en español", "cuéntame en español", "intenta decirlo". Just say what that person would say.
- A slip that does not block understanding is NOT a stumble: "la museo" for "el museo", a missing accent, a wrong article. A real person hears the question and answers it. Note it in evidence -- that is what evidence is for -- and do NOT stop the conversation to repair it. Repair is for the moments a real listener genuinely could not follow.
- A short answer a native speaker would give ("para llevar", "sí, claro", "con leche") is a GOOD answer. Never ask them to expand it into a full sentence for completeness; only repair what a real listener would not understand.
- Accept adjacent answers. If the learner answered something close to what you asked, take it and move on. Never ask the same thing more than twice; change the topic or angle instead.
- Never give CEFR levels, scores, or praise inflation. Warm, brief, calm.
- In coaching, talk in Spanish as the other person in the scene. Use English only inside english_explanation.noteEn or when the learner is clearly lost and you say one short English sentence.

# Tools (pick at most one per turn; type=none otherwise)
- keyword_card: the ONE word/short phrase they were missing. primaryEs=word, primaryEn=meaning, noteEn=when to use it (very short).
- sentence_frame: a natural Spanish frame with exactly one ___ blank. primaryEs=frame, primaryEn=meaning, exampleEs=filled example.
- english_explanation: one or two plain-English sentences that unblock them. noteEn=text.
- say_it_back: hand them one short phrase to say back once. primaryEs=phrase, primaryEn=meaning. sayEs should invite them to say it. intent=retry.
- slow_repeat: repeat your PREVIOUS line more slowly. sayEs must be that same line again, verbatim.
- preparation_time: give them a way in before answering. noteEn=one concrete way to start ("start with 'Ayer...' and name one thing"). sayEs=the question again or a short "tómate tu tiempo".
- path_choice (framing only): options = exactly two {labelEn, scenarioEn}. Everything else null.

# Grounding
- lastUserAttempt.answering tells you exactly which of your lines the learner was answering, and in which phase. Their text is ALWAYS a reply to that line -- never small talk, never a new topic. But a reply is not always an ATTEMPT: talking to you about the task, in English, is still a reply to that line, and must be answered as what it is instead of scored as Spanish.
- If answering.phase is "scenario" AND they produced Spanish, their text is their first attempt inside chosenScenario: step into the scene as the other person and react to its actual content (repair it first if it broke). If instead they answered in English about what they would or could not say, that is not an attempt -- see the rule above and give them what they said they were missing.
- In coaching, always react to the CONTENT of what they said before moving on -- one short in-character acknowledgment ("¡Al gimnasio, qué bien!"), then your next line. Never ignore what they said.
- If their reply does not fit the line they were answering (off-topic, or they misunderstood you), do NOT gloss over it and do NOT report evidence "none": react in character with brief, warm confusion ("¿Una camisa? Espera, ¿no hablábamos de tu día?") or steer back, and record it as evidence like "comprehension mismatch".

# Evidence
- On every coaching turn, evidence is REQUIRED and describes ONLY the last learner attempt: observedBlocker (short label like "vocabulary retrieval", "sentence assembly", "grammar control", "pronunciation intelligibility", "hesitation under pressure", "naturalness/register", "follow-up pressure", or "none" when it was fine), confidence, and one specific noteEn (e.g. "gender agreement: 'muy bueno' for 'la comida'", or "clean, natural, appropriate register"). Never write "unclear" if they said anything in Spanish -- judge it.
- expectedCommunicativeFunction: what a good reply to sayEs would do (e.g. "name one thing you did yesterday"). When your sayEs is an ANSWER to their question rather than a question of your own, this is what they would naturally do next ("react to the directions, or ask how long it takes").

# The learner's own hypothesis
- selfReportedBlocker classifies THEIR opening answer into one label. Set it on the framing turn ONLY (turnIndex 0); on every other turn it MUST be null, so a later turn cannot overwrite what they actually told you.
- It is their hypothesis, not your diagnosis. Classify what they SAID, even when you already suspect they are wrong -- your own read belongs in evidence.observedBlocker, and the two are allowed to disagree. That disagreement is useful later; erasing it is not.
- words_to_sentences: they know words but cannot build sentences. freeze_under_pressure: they blank when put on the spot. missing_words: the words will not come. pronunciation_nerves: they are hard to understand, or afraid of being. sounds_unnatural: understood, but textbook or socially off. grammar_falls_apart: tenses and agreement collapse. follow_ups_break_me: the opening is fine, the second question is not. not_sure: they described a feeling, a goal, or a situation without naming what breaks.
- Use not_sure honestly and often. "I want to talk to my girlfriend's family" names a reason, not a blocker. Guessing a label there fabricates the one thing this whole flow exists to learn.

# Ending
- Set done=true when you can name the main blocker with medium/high confidence and the learner has had at least one successful retry after help, or when pacing tells you to. On the done turn, sayEs is a short warm closing line (no question), tool=none.
- Follow the pacing field in the user message exactly. Output only structured JSON.
`.trim();
}

function mockTurn(
  coachId: string,
  state: CoachState,
  userAttempt: string | null,
  turnIndex: number,
  mustFinish: boolean,
): CoachResponse {
  const noTool = { type: "none" as const, primaryEs: null, primaryEn: null, exampleEs: null, noteEn: null, options: null };
  // Mock-only and deliberately crude -- the real classification is the model's job. This exists
  // so the mock path exercises the same shape (set on framing, null everywhere else).
  const mockSelfReported: CoachResponse["selfReportedBlocker"] =
    turnIndex !== 0
      ? null
      : /\b(freeze|frozen|blank|panic|nervous)\b/i.test(state.openingAnswer)
        ? "freeze_under_pressure"
        : /\b(grammar|tense|conjugat)\b/i.test(state.openingAnswer)
          ? "grammar_falls_apart"
          : /\b(pronounc|accent)\b/i.test(state.openingAnswer)
            ? "pronunciation_nerves"
            : /\b(vocab|vocabulary|word|words)\b/i.test(state.openingAnswer)
              ? "missing_words"
              : "not_sure";
  const evidence =
    userAttempt === null || state.phase !== "coaching"
      ? null
      : {
          observedBlocker: /\b(uh|um|no se|no sé)\b/i.test(userAttempt) || userAttempt.split(/\s+/).length < 3 ? "vocabulary retrieval" : "sentence assembly",
          confidence: "medium" as const,
          noteEn: `Mock read of: "${userAttempt.slice(0, 60)}"`,
        };

  if (mustFinish || turnIndex >= 6) {
    return {
      coachId,
      turnIndex,
      sayEs: "Muy bien, ya tengo una idea de dónde se te traba. Seguimos.",
      meaningEn: "Very good, I already have an idea of where you get stuck. Let's keep going.",
      intent: "wrap_up",
      phase: "closing",
      expectedCommunicativeFunction: "none",
      tool: noTool,
      evidence,
      selfReportedBlocker: mockSelfReported,
      sceneCharacter: null,
      done: true,
      doneReason: "Mock coach finished.",
    };
  }

  if (turnIndex === 0) {
    return {
      coachId,
      turnIndex,
      sayEs: "So the words are there when you listen, but they hide when it's your turn. That's normal — it's retrieval, not knowledge. Want to start with a chat at work, or ordering a coffee?",
      meaningEn: "Framing: mirror, reframe, two directions.",
      intent: "probe",
      phase: "framing",
      expectedCommunicativeFunction: "pick one of two directions",
      tool: {
        type: "path_choice",
        primaryEs: null,
        primaryEn: null,
        exampleEs: null,
        noteEn: null,
        options: [
          { labelEn: "a chat at work", scenarioEn: "A colleague asks how your weekend was while you wait for the coffee machine." },
          { labelEn: "ordering a coffee", scenarioEn: "You are at a café counter and want a coffee with oat milk, to take away." },
        ],
      },
      evidence: null,
      selfReportedBlocker: mockSelfReported,
      sceneCharacter: null,
      done: false,
      doneReason: null,
    };
  }

  if (turnIndex === 1) {
    return {
      coachId,
      turnIndex,
      sayEs: `Okay. This is Marco behind the counter — friendly, but it is lunchtime and there are five people behind you. ${state.chosenScenario ?? ""} Show me what you'd say — in Spanish, however it comes out.`.replace(/\s+/g, " "),
      meaningEn: "Scenario invitation.",
      intent: "probe",
      phase: "scenario",
      expectedCommunicativeFunction: "say your opening line in the scenario",
      tool: noTool,
      evidence: null,
      selfReportedBlocker: mockSelfReported,
      sceneCharacter: { name: "Marco", relation: "the barista", traitEn: "friendly, but it is lunchtime and there are five people behind you" },
      done: false,
      doneReason: null,
    };
  }

  const script: Array<Pick<CoachResponse, "sayEs" | "meaningEn" | "intent" | "expectedCommunicativeFunction" | "tool">> = [
    {
      sayEs: "Hola, ¿qué te pongo?",
      meaningEn: "Hi, what can I get you?",
      intent: "probe",
      expectedCommunicativeFunction: "order something",
      tool: noTool,
    },
    {
      sayEs: "Casi. Prueba así: Un café con ___, por favor.",
      meaningEn: "Almost. Try it like this: A coffee with ___, please.",
      intent: "retry",
      expectedCommunicativeFunction: "order using the frame",
      tool: { type: "sentence_frame", primaryEs: "Un café con ___, por favor.", primaryEn: "A coffee with ___, please.", exampleEs: "Un café con leche de avena, por favor.", noteEn: null, options: null },
    },
    {
      sayEs: "Perfecto. ¿Para tomar aquí o para llevar?",
      meaningEn: "Perfect. For here or to go?",
      intent: "advance",
      expectedCommunicativeFunction: "say for here or to go",
      tool: noTool,
    },
    {
      sayEs: "Te falta una palabra: llevar. Dilo una vez: para llevar.",
      meaningEn: "You're missing one word: to go. Say it once: to go.",
      intent: "retry",
      expectedCommunicativeFunction: "repeat the phrase",
      tool: { type: "say_it_back", primaryEs: "Para llevar.", primaryEn: "To go.", exampleEs: null, noteEn: null, options: null },
    },
  ];
  const step = script[Math.min(turnIndex - 2, script.length - 1)];
  return { coachId, turnIndex, ...step, phase: "coaching", evidence, selfReportedBlocker: mockSelfReported, sceneCharacter: null, done: false, doneReason: null };
}
