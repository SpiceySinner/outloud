/**
 * "I don't know how to say it" — recognised in one place, because it was recognised in two and
 * they disagreed.
 *
 * This pattern used to live inside `app/api/coach/route.ts` and was copied into the test harness
 * that verified it. When the pattern turned out to be broken, the copy was broken in the same
 * way, so the test agreed with the bug and reported green. A check that shares its subject's
 * mistakes is not a second opinion. Hence one exported function, imported by everything that
 * needs it — the route, the room, and the tests.
 *
 * ENGLISH ONLY, deliberately. A learner asked something in Spanish who answers "no sé" has given
 * a real and correct Spanish answer; treating that as a cry for help would take a good turn away
 * from them. Declaring it in English is stepping out of the task, and that is the signal.
 */

/**
 * Apostrophes come in two shapes and only one of them used to be spelled here.
 *
 * `don'?t` matches "dont" and a straight quote. iOS and macOS substitute a curly U+2019 as the
 * learner types, so the sentence that actually arrives from a phone is "I don’t know how to say
 * it" — a different string. Every admission typed on the device this app is mainly used on was
 * sailing straight past. Normalise first, match second.
 */
function normalizeApostrophes(text: string) {
  return text.replace(/[‘’ʼ´]/g, "'");
}

const declaredStuckEn = new RegExp(
  [
    // Standalone admissions. No pronoun needed; nobody says "no idea" about anything else here.
    "\\b(?:no idea|no clue|not a clue|dunno|i'?m lost|im lost|i give up)\\b",
    /*
     * "I don't know HOW TO SAY IT" — the negation plus the thing they are reaching for.
     *
     * Two bugs have been paid for in this one alternative, in opposite directions.
     *
     * The first: it required the pronoun and the negation to be adjacent, so "I STILL don't know
     * how to say it" did not match, and a second admission — more stuck than the first — was
     * answered with a fresh, unrelated question. Hence the {0,2} gap, which covers "still",
     * "really", "honestly", "just", "kind of".
     *
     * The second: widening it to any "I don't ..." made it fire on people describing themselves.
     * "I don't like the way I sound", "I don't have much time to practice", "I can't stop
     * translating in my head" are not requests for words, and the opening question literally asks
     * people to describe their problem — so the widened pattern was aimed straight at the most
     * common answer in the app. Handing somebody a phrase card for a sentence they never asked to
     * say is the mirror image of the first bug and lands the same way: it looks like listening
     * and is not.
     *
     * So the negation now has to be reaching for SAYING something, "remember the word" included:
     * a vocabulary gap is a real ask.
     */
    "\\bi\\s+(?:\\w+\\s+){0,2}(?:don'?t|do not|dont|can'?t|cannot|cant)\\s+(?:\\w+\\s+){0,3}" +
      "(?:say|saying|said|know how|knew how|put it|put that|get it out|get that out|word it" +
      "|express|remember how|remember the word|start)\\b",
    /*
     * The bare admission, when it is the WHOLE answer. "I don't know." on its own, in a room that
     * has just asked you to say something, cannot mean anything else. Anchored, so it cannot
     * reach into a longer sentence.
     */
    "^\\s*i\\s+(?:\\w+\\s+){0,2}(?:don'?t|do not|dont)\\s+know[.!]*\\s*$",
  ].join("|"),
  "i",
);

/**
 * The other shape of the same request, and the one that was missed.
 *
 * Reported from a real session, mid-scene: *"What is the word, like, I know, thanks to the hint,
 * I know like Quiero comprarse, I want to buy, but what's, do I say if I wanna say, how, where is
 * the pizza?"* — and the app answered with "here's what I heard. fix anything that's wrong."
 *
 * Nothing in that sentence admits anything. It says "I know" twice. It is a QUESTION, and the
 * detector only knew how to recognise an ADMISSION. Somebody who half speaks the language does
 * not usually announce defeat; they ask which word to use, in the middle of a sentence they are
 * already halfway through. That is the normal case, not the edge case.
 *
 * Anchored on the asking itself. Deliberately NOT on a bare "what to say": *"I never know what to
 * say when someone asks how I am"* is a description of a problem, which is exactly what the
 * opening question invites, and the same over-firing this file has already paid for once.
 */
const asksForWordsEn = new RegExp(
  [
    "\\bhow\\s+(?:do|would|can|should|d)\\s+(?:i|you|we)\\s+(?:say|ask|tell|put)\\b",
    "\\bhow\\s+(?:do|would)\\s+(?:i|you)\\s+\\w+\\s+(?:say|ask)\\b",
    "\\bwhat(?:'?s| is)\\s+(?:the\\s+)?(?:spanish|word|phrase|term)\\s+(?:for|is)\\b",
    "\\bwhat(?:'?s| is)\\s+the\\s+word\\b",
    "\\bwhat\\s+do\\s+i\\s+say\\b",
    "\\bdo\\s+i\\s+say\\b",
  ].join("|"),
  "i",
);

/** Did they step out of the task and say, in English, that they do not have the words? */
export function declaresStuckEn(text: string) {
  return declaredStuckEn.test(normalizeApostrophes(text));
}

/** Did they ask, in English, which words to use? */
export function asksForWordsEnglish(text: string) {
  return asksForWordsEn.test(normalizeApostrophes(text));
}

/**
 * Either shape. This is what callers should use: admitting and asking are the same request
 * wearing different grammar, and answering only one of them is how the app ended up telling
 * somebody who had just asked a question that the problem was their pronunciation.
 */
export function needsWordsEn(text: string) {
  const normalized = normalizeApostrophes(text);
  return declaredStuckEn.test(normalized) || asksForWordsEn.test(normalized);
}


/**
 * Turns a question into the sentence it is asking for.
 *
 * `"how do I say I'll take care of it"` -> `"I'll take care of it"`.
 *
 * The ask phase prints "how to say: {askEn}" and sends `askEn` to the lifeline, so leaving the
 * asking on the front produces "how to say: how do I say I'll take care of it" and asks the model
 * to translate a question the learner never wanted to say out loud.
 *
 * Deliberately conservative: it only strips a leading ask and a trailing "in Spanish", and if that
 * would leave nothing it hands back what it was given. Guessing wrong here is worse than not
 * stripping, because the result is what the whole chain hangs on -- it becomes the `originalText`
 * of the rescue and then the phrase in the word bank.
 */
const leadingAsk = new RegExp(
  "^\\s*(?:" +
    "how\\s+(?:do|would|can|should|d)\\s+(?:i|you|we)\\s+(?:say|ask|tell|put)" +
    "|how\\s+to\\s+say" +
    "|what(?:'?s| is)\\s+(?:the\\s+)?(?:spanish|word|phrase|term)\\s+(?:for|is)" +
    "|what(?:'?s| is)\\s+the\\s+word\\s+for" +
    "|i\\s+(?:want|need|'?d\\s+like)\\s+to\\s+(?:be\\s+able\\s+to\\s+)?say" +
    "|i\\s+want\\s+to\\s+be\\s+able\\s+to\\s+say" +
    ")\\b[\\s,:-]*",
  "i",
);

const trailingLanguage = /[\s,]*(?:in\s+spanish|en\s+espa\u00f1ol|in\s+espa\u00f1ol)\s*[.!?]*\s*$/i;

export function strippedAsk(text: string) {
  const original = text.trim();
  let out = normalizeApostrophes(original).replace(leadingAsk, "");
  out = out.replace(trailingLanguage, "");
  // Quotes and stray punctuation left behind by the strip, never letters or digits.
  out = out.replace(/^["'\u201c\u2018\s]+|["'\u201d\u2019\s]+$/g, "").trim();
  return out.length >= 2 ? out : original;
}
