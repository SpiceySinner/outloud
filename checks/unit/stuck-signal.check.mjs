// Does the app notice somebody reaching for words -- and stay off everything else?
//
// Imports the real file. An earlier version of this check copied the pattern out of the route, so
// when the pattern turned out to be broken the copy was broken identically and the check reported
// green. A check that shares its subject's mistakes is not a second opinion.
//
// Four bugs are pinned here and they pull in different directions:
//
//   1. the pronoun and the negation had to be adjacent, so a SECOND admission fell through
//   2. widening that made it fire on people merely describing themselves
//   3. only the straight apostrophe was spelled, so nothing typed on a phone matched
//   4. it only knew ADMITTING ("I don't know how to say it") and not ASKING ("how do I say it")
//
// The detector's job has since narrowed: `saidInEnglish` in lib/voice-guards.ts decides whether a
// scene turn is an attempt at all (see scene-turn.check.mjs). This one still has to be right,
// because it is what tells "reaching for words" apart from "describing my problem" -- and the
// opening question asks for exactly the second.
import { loadLib } from "../harness/load.mjs";

export const about = "needsWordsEn catches reaching for words, and stays off people describing themselves";

const { needsWordsEn, strippedAsk } = await loadLib("lib/stuck-signal.ts");

const mustFire = [
  // -- admitting
  "I don't know",
  "I don't know.",
  "i dont know how to say it",
  "I still don't know how to say it",
  "I really don't know",
  "I honestly have no idea",
  "no clue",
  "dunno",
  "I just can't get it out",
  "I cannot say that",
  "I'm lost",
  "i give up",
  "I kind of don't know where to start",
  "I don't remember the word for spoon",
  // -- admitting, as a phone actually sends it
  "I don’t know",
  "I don’t know how to say it",
  "I still don’t know how to say it",
  "I can’t get it out",
  "I’m lost",
  // -- asking. Timo's real sentence first: it admits nothing and says "I know" twice.
  "What is the word, like, I know, thanks to the hint, I know like Quiero comprarse, I want to buy, but what's, do I say if I wanna say, how, where is the pizza?",
  "how do I say I'll take care of it",
  "how do you say where is the pizza",
  "what's the word for spoon",
  "what is the spanish for I'll handle it",
  "what do I say here",
  "how would I ask for the bill",
  "how can I tell her I'm sorry",
];

// Must stay quiet, for two different reasons.
//
// The Spanish half is the important one: a learner who answers "no se" has given a real and
// correct answer, and treating it as a cry for help takes a good turn away from them.
//
// The English half is people DESCRIBING their problem -- which is what the opening question asks
// them to do. Handing them a phrase card there answers something nobody asked.
const mustStayQuiet = [
  "no se",
  "no se como se dice",
  "Me encargo de eso",
  "Quiero un cafe por favor",
  "Hoy trabaje y comi un bistec",
  "yes",
  "ok sure",
  "I went to the shop yesterday",
  "she asked me about my job",
  "no",
  "I liked the song",
  "I don't know why they go quiet",
  "People at work go quiet after I say things and I don’t know why, my Spanish is decent I think.",
  "I don't like the way I sound",
  "I don't have much time to practice",
  "I can't stop translating in my head",
  "I don't get nervous in writing, only speaking",
  "I don’t like how slow I am",
  "I never know what to say when someone asks how I am",
  "I say it wrong every time",
];

// `strippedAsk` takes the asking off the front. It matters more than it looks: what survives
// becomes the lifeline's query, then the rescue's originalText, then the phrase in the word bank.
// Stripping the wrong thing is worse than stripping nothing.
const stripping = [
  ["how do I say I'll take care of it", "I'll take care of it"],
  ["how do you say where is the pizza", "where is the pizza"],
  ["how do I say I'll take care of it in Spanish", "I'll take care of it"],
  ["what's the word for spoon", "spoon"],
  ["what is the spanish for I'll handle it", "I'll handle it"],
  ["How to say: nice to meet you", "nice to meet you"],
  ["I want to say that I'm sorry I'm late", "that I'm sorry I'm late"],
  ["I want to be able to say I'll take care of it", "I'll take care of it"],
  ["how do I say I’ll take care of it", "I'll take care of it"],
  ['how do I say "I\'ll take care of it"', "I'll take care of it"],
  // answered plainly -- must come back untouched
  ["I'll take care of it", "I'll take care of it"],
  ["where is the pizza", "where is the pizza"],
  ["nice to meet you", "nice to meet you"],
  ["that I can pick her up at eight", "that I can pick her up at eight"],
  // only LOOK like asks
  ["I say it wrong every time", "I say it wrong every time"],
  ["how do I sound less rude", "how do I sound less rude"],
  ["what do you think of my accent", "what do you think of my accent"],
  // stripping to nothing hands back the original rather than an empty query
  ["how do I say", "how do I say"],
];

export default async function run(t) {
  for (const said of mustFire) {
    t.ok(needsWordsEn(said), `reaching for words: "${said.slice(0, 60)}"`, "the detector stayed quiet");
  }
  for (const said of mustStayQuiet) {
    t.ok(!needsWordsEn(said), `not reaching for words: "${said.slice(0, 60)}"`, "the detector fired");
  }
  for (const [input, want] of stripping) {
    t.equal(strippedAsk(input), want, `stripped: "${input.slice(0, 50)}"`);
  }
}
