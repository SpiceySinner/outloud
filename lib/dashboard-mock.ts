import type { ChatMessage, DashboardData, MasteryState, MomentCard, WordCard } from "@/lib/dashboard-data";

/**
 * A preview account for the home screen, so the design can be looked at without first living
 * through fourteen sessions.
 *
 * Two rules this file follows, because a screen that quietly invents a learner's history is the
 * same class of bug as a coach praising a sentence nobody said:
 *
 * 1. It is only ever reachable behind `?preview=1`, and the page shows a ribbon saying so.
 * 2. Every field here is one the real `/api/library` already returns, or one derived from those.
 *    Nothing is mocked that could not be true. The single exception is `chat`, which has no
 *    backend at all yet -- that is called out on the screen rather than hidden.
 *
 * Deleting this file and the two `preview` branches in the dashboard is the whole cleanup.
 */

const day = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();
const due = (daysFromNow: number) => new Date(Date.now() + daysFromNow * day).toISOString();

type Seed = {
  summary: string;
  naturalVersion: string;
  keyPhrase: string;
  keyPhraseMeaning: string;
  pattern: string | null;
  blocker: string;
  ledgerState: MasteryState;
  daysAgo: number;
  dueIn: number;
};

const seeds: Seed[] = [
  {
    summary: "asking where the museum is, on the street",
    naturalVersion: "¿El museo queda lejos de aquí?",
    keyPhrase: "queda lejos",
    keyPhraseMeaning: "is it far",
    pattern: "¿… queda cerca o lejos?",
    blocker: "vocabulary_retrieval",
    ledgerState: "needed_hint",
    daysAgo: 1,
    dueIn: -1,
  },
  {
    summary: "ordering at the counter when they ask what you want to drink",
    naturalVersion: "Para mí un café con leche, por favor.",
    keyPhrase: "para mí",
    keyPhraseMeaning: "for me / I'll have",
    pattern: "para mí + …",
    blocker: "vocabulary_retrieval",
    ledgerState: "answered_on_own",
    daysAgo: 2,
    dueIn: -2,
  },
  {
    summary: "telling your girlfriend's sister what you did at the weekend",
    naturalVersion: "Fui a la montaña con mi hermano y comimos fuera.",
    keyPhrase: "fui a",
    keyPhraseMeaning: "I went to",
    pattern: "fui a + place",
    blocker: "sentence_assembly",
    ledgerState: "used_new_situation",
    daysAgo: 4,
    dueIn: 3,
  },
  {
    summary: "she asks a second question before you have finished the first",
    naturalVersion: "Espera, déjame terminar — y luego te cuento.",
    keyPhrase: "déjame terminar",
    keyPhraseMeaning: "let me finish",
    pattern: null,
    blocker: "follow_up_pressure",
    ledgerState: "needed_full_help",
    daysAgo: 5,
    dueIn: -3,
  },
  {
    summary: "the pharmacy, explaining what hurts",
    naturalVersion: "Me duele la garganta desde el viernes.",
    keyPhrase: "me duele",
    keyPhraseMeaning: "it hurts / my … hurts",
    pattern: "me duele + body part + desde …",
    blocker: "vocabulary_retrieval",
    ledgerState: "answered_on_own",
    daysAgo: 7,
    dueIn: 2,
  },
  {
    summary: "saying no to a second helping without sounding rude",
    naturalVersion: "Está riquísimo, de verdad — pero ya no puedo más.",
    keyPhrase: "ya no puedo más",
    keyPhraseMeaning: "I can't manage any more",
    pattern: null,
    blocker: "naturalness_register",
    ledgerState: "answered_on_own",
    daysAgo: 9,
    dueIn: -1,
  },
  {
    summary: "explaining what you do for work when nobody knows what it means",
    naturalVersion: "Programo — hago páginas web y aplicaciones.",
    keyPhrase: "programo",
    keyPhraseMeaning: "I program",
    pattern: null,
    blocker: "vocabulary_retrieval",
    ledgerState: "used_new_situation",
    daysAgo: 11,
    dueIn: 6,
  },
  {
    summary: "asking a waiter to bring the bill",
    naturalVersion: "¿Nos trae la cuenta cuando pueda?",
    keyPhrase: "la cuenta",
    keyPhraseMeaning: "the bill",
    pattern: "¿nos trae … cuando pueda?",
    blocker: "hesitation_pressure",
    ledgerState: "confirmed_real_life",
    daysAgo: 14,
    dueIn: 30,
  },
  {
    summary: "she talks fast about a family thing you have not followed",
    naturalVersion: "Perdona, me he perdido — ¿quién es Marta?",
    keyPhrase: "me he perdido",
    keyPhraseMeaning: "I've lost the thread",
    pattern: "perdona, … — ¿quién es …?",
    blocker: "follow_up_pressure",
    ledgerState: "needed_hint",
    daysAgo: 16,
    dueIn: -4,
  },
  {
    summary: "introducing yourself to her parents for the first time",
    naturalVersion: "Soy Timo, encantado — llevo dos años con ella.",
    keyPhrase: "encantado",
    keyPhraseMeaning: "pleased to meet you",
    pattern: "llevo + time + con …",
    blocker: "hesitation_pressure",
    ledgerState: "answered_on_own",
    daysAgo: 19,
    dueIn: 9,
  },
  {
    summary: "asking how much something costs at a market stall",
    naturalVersion: "¿Cuánto vale el kilo?",
    keyPhrase: "cuánto vale",
    keyPhraseMeaning: "how much is it",
    pattern: "¿cuánto vale …?",
    blocker: "vocabulary_retrieval",
    ledgerState: "answered_on_own",
    daysAgo: 23,
    dueIn: 12,
  },
  {
    summary: "saying you did not understand without switching to English",
    naturalVersion: "No te he entendido — ¿me lo repites más despacio?",
    keyPhrase: "más despacio",
    keyPhraseMeaning: "more slowly",
    pattern: "¿me lo repites …?",
    blocker: "hesitation_pressure",
    ledgerState: "answered_on_own",
    daysAgo: 27,
    dueIn: 16,
  },
];

const moments: MomentCard[] = seeds.map((seed, index) => ({
  id: `preview-${index}`,
  createdAt: at(seed.daysAgo),
  summary: seed.summary,
  naturalVersion: seed.naturalVersion,
  keyPhrase: seed.keyPhrase,
  keyPhraseMeaning: seed.keyPhraseMeaning,
  pattern: seed.pattern,
  blocker: seed.blocker,
  ledgerState: seed.ledgerState,
  dueAt: due(seed.dueIn),
  rescue: null,
}));

const wordSeeds: Array<[string, string, string, number, number]> = [
  ["queda lejos", "is it far", "rescue_phrase", 0, 1],
  ["para mí", "for me / I'll have", "rescue_phrase", 2, 2],
  ["déjame terminar", "let me finish", "coach_tool", 0, 5],
  ["me duele", "my … hurts", "rescue_phrase", 1, 7],
  ["ya no puedo más", "I can't manage any more", "rescue_phrase", 0, 9],
  ["programo", "I program", "coach_tool", 3, 11],
  ["la cuenta", "the bill", "rescue_phrase", 4, 14],
  ["me he perdido", "I've lost the thread", "coach_tool", 0, 16],
  ["encantado", "pleased to meet you", "rescue_phrase", 1, 19],
  ["cuánto vale", "how much is it", "rescue_pattern", 2, 23],
  ["más despacio", "more slowly", "rescue_phrase", 3, 27],
  ["fui a", "I went to", "rescue_pattern", 2, 4],
];

const words: WordCard[] = wordSeeds.map(([spanish, meaning, source, practiced, daysAgo], index) => ({
  id: `preview-word-${index}`,
  spanish,
  meaning_en: meaning,
  source,
  times_practiced: practiced,
  created_at: at(daysAgo),
}));

/**
 * The thread is the argument for the whole feature: it is not a chatbot, it is the way a real
 * event in the learner's week becomes the next session (#30). Every coach turn either teaches
 * something or ends in a door back into the room.
 */
const chat: ChatMessage[] = [
  {
    id: "c1",
    from: "coach",
    text: "you have got four things sitting in review, but let's do this first — what is coming up that you are actually dreading?",
  },
  {
    id: "c2",
    from: "you",
    text: "dinner at my girlfriend's parents on friday. her mum talks really fast and I just nod.",
  },
  {
    id: "c3",
    from: "coach",
    text: "then that is friday's session. three things will happen at that table. she will ask what you do — you have got that one, you said \"programo, hago páginas web\" unaided last week. she will ask how you two met, which you have never said out loud in Spanish. and she will offer you food twice, and the second no is the one people freeze on, because refusing twice in Spanish sounds rude unless you know the shape of it.",
    offer: { label: "run friday's table", detail: "her mum, fast, three questions you cannot dodge" },
  },
  {
    id: "c4",
    from: "you",
    text: "how do I even say we met through friends",
  },
  {
    id: "c5",
    from: "coach",
    text: "\"nos conocimos por amigos\" — literally \"we met each other through friends\". the useful part is \"nos conocimos\", because it covers met at work, met travelling, met online. want it in your words, or do you want to try building the rest of the sentence yourself first?",
    offer: { label: "try it out loud", detail: "no model on screen — say it, then we compare" },
  },
];

export const mockDashboard: DashboardData = {
  user: { email: "you@preview.outloud" },
  moments,
  words,
  chat,
};

/** Canned replies for the preview's suggestion chips, so tapping one does something. */
export const mockChatReplies: Record<string, ChatMessage[]> = {
  "I froze today": [
    { id: "r1", from: "you", text: "I froze today" },
    {
      id: "r2",
      from: "coach",
      text: "where, and what were you trying to say? give me the English — I will work out what you were missing, and we will put it back where it happened rather than in a vocabulary list.",
    },
  ],
  "how do I say…": [
    { id: "r3", from: "you", text: "how do I say \"I'll take care of it\"" },
    {
      id: "r4",
      from: "coach",
      text: "\"yo me encargo\". it is short, and it is the one people actually use — \"me encargo yo\" if you want to insist it is you and not them. the reason it is worth having is that it buys you the whole rest of the conversation without another sentence.",
      offer: { label: "keep it", detail: "goes into your words, comes back friday" },
    },
  ],
  "why is it like that?": [
    { id: "r5", from: "you", text: "why is it \"me duele\" and not \"yo duelo\"" },
    {
      id: "r6",
      from: "coach",
      text: "because in Spanish the throat does the hurting, not you. \"me duele la garganta\" is \"the throat hurts me\". same shape as \"me gusta\" — the thing is the subject and you are on the receiving end. once you see that, gustar stops being a special case.",
    },
  ],
};
