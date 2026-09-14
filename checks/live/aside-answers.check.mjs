// When a learner asks what a word means, does the coach answer -- or analyse them?
//
// Timo, 2026-09-14: "versuch es mal bei dir selber: frag wie du ein wasser bestellst und dann frag
// was agua bedeutet." He got "is it the grammar or the vocabulary that feels tricky to you?"
//
// `/api/aside` is two jobs in one engine. The diagnostic one interviews; the word-asking one
// should just say the word. Only the first had a voice, so the prompt banned Spanish outright and
// treated `stuck` as a single-turn exception on top of an interview script.
//
// FOUR turns, not one. A single sample proves nothing here: the analysing question only appears
// once the offer machinery starts looking for something to offer, which is turn two at the
// earliest. The 2026-09-14 fix was found by driving the conversation, not by sampling it.
//
// This one needs the real model. A mock run of a prompt fault proves nothing at all, which is why
// `realModelRequired` stops the check rather than letting it go green against a fixture.
import { postJson, realModelRequired } from "../harness/server.mjs";

export const about = "the word-asking aside answers the question, in English, and stops when told";
export const needs = "dev-server";

const scene = {
  characterEn: "Marta, a waiter who is busy and does not slow down",
  scenarioEn: "You are at a cafe and want to order something to drink.",
  characterLineEs: "Buenas, que le pongo?",
  characterMeaningEn: "Hi, what can I get you?",
};

const learnerTurns = [
  "what does agua mean?",
  "and por favor, what is that?",
  "okay and can I say quiero un agua instead?",
  "got it, thanks",
];

// The shapes of "let me interview you about your problem" that showed up in the real transcripts.
const analysing = /\b(are you asking|do you want to|you want to know|is it the|because you|would you like me to)\b/i;

export default async function run(t) {
  if (!realModelRequired(t)) return;

  const exchange = [];
  const replies = [];

  for (let step = 0; step <= learnerTurns.length; step += 1) {
    const { ok, status, json } = await postJson("/api/aside", {
      scene,
      focus: { current: "vocabulary_retrieval", stated: null, observed: null },
      trigger: "stuck",
      stuckSaid: "How do I order a water?",
      stage: "session",
      exchange,
    });
    if (!ok) {
      t.fail(`turn ${step}: /api/aside answered ${status}`, JSON.stringify(json).slice(0, 200));
      return;
    }
    const said = String(json.sayEn ?? "");
    replies.push({ said, done: Boolean(json.done), offer: json.offer ?? null });
    exchange.push({ who: "coach", text: said });
    if (json.done || step >= learnerTurns.length) break;
    exchange.push({ who: "you", text: learnerTurns[step] });
  }

  t.note(`${replies.length} coach turns driven`);
  for (const [i, r] of replies.entries()) t.note(`  ${i}: ${r.said.slice(0, 110)}`);

  // 1. It answers. "agua" means water, and the answer has to contain it.
  t.match(replies[0]?.said, /\bwater\b/i, "the opening turn answers what the word means");

  // 2. It never turns the question back on them. This is the fault Timo reported.
  for (const [i, r] of replies.entries()) {
    t.ok(!analysing.test(r.said), `turn ${i} answers instead of interviewing`, `analysing: "${r.said.slice(0, 120)}"`);
  }

  // 3. English is what it explains IN. Only the line being taught may be Spanish -- an earlier
  //    version of the fix taught the phrase and then said goodbye in Spanish too.
  const closing = replies.at(-1)?.said ?? "";
  t.ok(closing.length > 0 && closing.length < 160, "the closing turn is one short line", `${closing.length} chars: "${closing}"`);
  t.ok(!/[¿¡áéíóúñ]/i.test(closing.replace(/"[^"]*"/g, "")), "nothing outside a quoted phrase is in Spanish", `"${closing}"`);
}
