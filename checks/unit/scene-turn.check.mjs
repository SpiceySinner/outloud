// What happens to a turn in a Spanish scene? The scenario, not a list of sentences.
//
// Timo, 2026-09-14: "wir optimieren hier nicht fuer einzelne Saetze, wir optimieren fuer das
// Szenario." Two fixes before this one widened a regex over asking phrases, and a list like that
// has no end -- each fixed the sentences in front of it and left the next to be found by a person
// in a live session, who got "here's what I heard, fix anything that's wrong" about a transcript
// that was perfect.
//
// A turn in a scene has two cases and no tail:
//
//   Spanish, however broken   -> an attempt. Judge it. The confirm box is honest here.
//   English, whatever it says -> not an attempt. The learner is talking TO us.
//
// This mirrors `routeCapturedTranscript` in the room for a Spanish turn, in the same order,
// calling the same functions the room calls. Nothing is reimplemented: a copy of the rule is how
// this exact detector twice reported green while broken.
//
// If you are here because you want to add a phrasing to a word list: read AGENTS.md first.
import { loadLib } from "../harness/load.mjs";

export const about = "English mid-scene reaches the coach; Spanish, however broken, stays an attempt";

const { needsWordsEn } = await loadLib("lib/stuck-signal.ts");
const { looksBrokenAttempt, saidInEnglish } = await loadLib("lib/voice-guards.ts");

const decide = (text, lowConfidence = false) => {
  if (needsWordsEn(text) || saidInEnglish(text)) return "coach";
  if (lowConfidence || looksBrokenAttempt(text) || text.trim().length < 3) return "confirm";
  return "scored";
};

// Said in English, mid-scene. Every one must reach the coach, whatever it is about: asking for a
// word, asking about a word, choosing between forms, complaining, apologising, giving up, or
// simply saying something to us. The verbs are deliberately spread -- the 2026-09-12 check was
// built around the four verbs the pattern already knew and therefore could not see its own gap.
const english = [
  "How do I order a water?",            // Timo's screenshot, 2026-09-14
  "how do I pay",
  "how do I book a table for two",
  "how do I greet her properly",
  "how do I apologise for being late",
  "how do I complain about the food",
  "how do I explain that I'm vegetarian",
  "how do I invite him to come with us",
  "how do you decline politely",
  "how can we ask for the wifi password",
  "how do I say I'll take care of it",
  "what's the word for bill",
  "what does cuenta mean",
  "is it la cuenta or el cuenta",
  "which one do I use, ser or estar",
  "I want to say I'll be there at eight",
  "can you tell me how to say I'm just looking",
  "sorry, what was that word again",
  "wait, I have no idea what you just said",
  "I don't like the way I sound",
  "I understand a lot but the words disappear",
  "this is going too fast for me",
  "can we do an easier one",
  "hold on, let me think about that",
  "I think I need a hint here",
];

// Spanish, including the broken and the mixed. None of these may be taken for English: a learner
// reaching for the scene has earned the evaluator, or the confirm box when it really did break.
const spanish = [
  "quiero un agua por favor",
  "Quiero un cafe con leche",
  "la cuenta por favor",
  "me gustaria reservar una mesa",
  "no se como se dice",
  "yo va a cuidar",                      // broken, and must still be judged as an attempt
  "quiero the bill",                     // English leaked in: this IS the confirm box's job
  "uh, quiero un cafe",
  "buenos dias senora",
  "si, gracias",
  "perdon, no entiendo",
  "creo que si pero es dificil",
  "hoy trabaje y comi un bistec",
  "me encargo de eso",
];

export default async function run(t) {
  t.note(`${english.length} English turns must reach the coach; ${spanish.length} Spanish turns must not`);
  for (const said of english) {
    t.equal(decide(said), "coach", `English reaches the coach: "${said}"`);
  }
  for (const said of spanish) {
    t.ok(decide(said) !== "coach", `Spanish stays an attempt: "${said}"`, `was routed to the coach`);
  }
}
