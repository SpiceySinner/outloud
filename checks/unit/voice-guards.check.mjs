// What counts as "nothing was said", and which language a turn was actually in.
//
// Imports the real file. A copy would share whatever the real one gets wrong, which is how three
// bugs in the stuck detector survived a green test.
//
// The case that prompted the first half, from a real session: a capture of exactly "ah..." was
// shown in the confirm box under "here's what I heard. fix anything that's wrong, then send." The
// transcription was perfect. There was nothing in it.
import { loadLib } from "../harness/load.mjs";

export const about = "filler is not an answer; saidInEnglish decides language without a word list";

const { classifyCapture, isFillerOnly, saidInEnglish } = await loadLib("lib/voice-guards.ts");

// Nothing was said. Must never reach the confirm box.
const nothing = [
  "ah...", "ah", "Ah.", "oh...", "um...", "uh", "erm...", "hmm...",
  "äh", "ähm...", "uh, um...", "ah, uh",
];

// Real answers. Every one must survive -- including the ones that START with a noise, which is
// the whole reason the rule requires EVERY word to be a filler.
const answers = [
  "ah, sí", "uh, quiero un café", "ah I don't know how to say it", "sí", "no",
  "mhm", "mm", "Me encargo de eso", "oh really", "ah bueno, entonces vamos", "no sé", "hola",
];

// `saidInEnglish` replaced a growing list of asking phrases with one question that has two
// answers and no tail. Its own rule is narrow on purpose: any Spanish at all disqualifies, and a
// word that belongs to both languages counts for neither. These are the cases that rule turns on.
const english = [
  "How do I order a water?",
  "I think I need a hint here",
  "can we do an easier one",
  "what do you think of my accent",
];
const notEnglish = [
  "quiero un agua por favor",   // plainly Spanish
  "no",                          // ambiguous in both -- must not be claimed by either side
  "me",
  "si",
  "hola",
  "uh, quiero un cafe",
  "quiero the bill",             // Spanish with English leaking in: still an attempt
];

export default async function run(t) {
  for (const said of nothing) {
    t.ok(isFillerOnly(said), `nothing was said: "${said}"`);
    t.equal(classifyCapture(said, true), "filler", `classified as filler: "${said}"`);
  }
  for (const said of answers) {
    t.ok(!isFillerOnly(said), `a real answer survives: "${said}"`, "was swallowed as filler");
  }
  for (const said of english) {
    t.ok(saidInEnglish(said), `read as English: "${said}"`);
  }
  for (const said of notEnglish) {
    t.ok(!saidInEnglish(said), `not read as English: "${said}"`, "was claimed for English");
  }
}
