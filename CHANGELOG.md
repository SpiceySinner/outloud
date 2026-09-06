# Changelog

## 2026-09-04 — A home to come back to, in preview

`/dashboard` was a list of words and a list of sessions. It answered "what did I collect" and
nothing else, which is not a reason to come back and definitely not a reason to pay. This replaces
it with a home that answers three questions in order: **what do I do right now, what did I already
do, and where is this going.**

Reachable as `/dashboard?preview=1` with an invented account, so the design can be looked at
without living through fourteen sessions first.

### The constraint that shaped it

"One screen, no navigation" is section A of the build plan, and it is there because reviewers of
every competitor complain about being in and out of lesson menus. A home screen is the exact place
that principle gets quietly abandoned. So: **one primary action**, always the same one, and
everything else on the page is either evidence of something that happened or a door back into the
same room. No streaks. Nothing configurable — the focus comes from the evidence, never from the
learner picking a topic off a list.

### What is on it

**Today.** The focus line — the dimension that actually shows up most — with whether it is moving,
then `start talking`. That is the whole hero.

**Another go.** The retrieval loop, visible for the first time. Every moment has *always* been
saved with a `retrieval_due_at`; the only thing ever built to act on it emails a link to `/m/<id>`,
a route that does not exist. The due queue reads columns that have been sitting in the database
this whole time. Each item shows where it is on the ledger — built it together → got there with a
nudge → said it unaided → reused it somewhere new → used it for real.

**Talk it through.** English, outside the roleplay. This is the one section with no backend, and it
says so on screen instead of faking it. It is in because it is the way #30 — build backward from
one real dreaded event, the highest-upside bet in the plan — actually reaches a learner: they say
"dinner at her parents on friday", and that becomes friday's session. Every coach turn in the
preview either teaches something or ends in a door back into the room. A chatbot that only chats
would not be worth building.

**Where this goes.** #51–54. Nine conversations you could survive, not nine topics. Position comes
from the ledger (#53) — unaided moments only, which is #27's definition of success — so it cannot
be gamed and cannot lie. Tapping a stage explains it and launches nothing. The point of seeing it
is that it is visibly long, which makes one bad session a step instead of a verdict.

**Your words**, now with a new / used-again split, and **everything so far** with each session's
ledger state rather than a bare date.

### Honest about what is invented

The stage thresholds in `journeyStages` are made up. Nothing here has been calibrated against a
real learner and the curve will not mean anything until sessions from strangers exist. It has the
right shape, not a measurement.

The preview is walled off deliberately: `?preview=1` only, a dashed ribbon at the top saying the
sessions and words are invented, and actions that would navigate say "preview" instead of doing it.
A screen that quietly invents a learner's history is the same class of bug as a coach praising a
sentence nobody said. `lib/dashboard-mock.ts` builds a `DashboardData` and nothing else, so wiring
it to reality is deleting a file, not rewriting a page — and every mocked field is one
`/api/library` already returns.

### One duplication removed on the way

The profile page computed "this is what trips you up, and it is moving" with its own inline copy of
the two-window trend. The home needed the same claim. Two copies of a claim about the learner is
how an app ends up telling someone two different things about themselves, so both now call
`focusFromMoments`. That also fixes a small real bug: profile counted blockers by **raw string**
and only normalized afterwards, so two spellings of the same blocker were counted as two different
ones and could hide the actual top dimension.

### Not done

Nothing is wired to the paywall, the chat has no engine (`/api/aside` is the closest template but
it is shaped for stepping out of a roleplay, not for open conversation), and signed-in learners
still land on `/` rather than here — that routing change affects everyone and is a product
decision, not a cleanup.

---

## 2026-09-06 — /dash: one screen, no scroll, the orb in the middle

From `UI.Idee.md`: see everything that matters as fast as possible without scrolling, with the orb
in the centre so you can just start talking, and the dashboard animating away when you do.

Three bands in a fixed `100dvh` column:

- **the bar** — exactly **one** thing to pick up, never a list. A list here would be the lesson
  menu the whole product refuses to be. Overdue beats recent, because an overdue item is the app
  keeping a promise it already made and is the only thing on this screen with a deadline.
- **the orb** — the act. Everything above and below it is context for it.
- **the foot** — where this is going, in one line: the stage you stand on, a hairline rail, and
  three quiet counts. The long version stays at `/dashboard`, behind "everything".

**The no-scroll rule is the design.** It is what forces every candidate for this screen to beat
something already on it. `.dash-shell` is exactly `100dvh` with `overflow: hidden`, the bar and
foot size to content, the stage takes the remainder, and `min-height: 0` on the stage is
load-bearing -- without it a flex child refuses to shrink below its content and the foot slides off
a short phone. The orb is bounded by `dvh` as well as `vw`, so a small screen shrinks the orb
instead of losing the foot. The pick-up line is a single clamped line for the same reason.

Measured on four viewports (375x667, 390x844, 430x932, and a squat 412x600): `scrollY` stays 0
after a wheel event, document height equals viewport height, the bar starts at y=54 and the foot
ends inside the screen on all four. The orb scales 264px -> 360px across them.

### The collapse, and what it hands off

Tapping fades the bar up and out, the foot down and out, and switches the orb to its `listening`
configuration while the cue becomes "listening…". Then the room takes over.

**The orb on /dash cannot actually listen, and that is deliberate.** The mic, the WebRTC session
and the whole voice state machine live in the room. A second microphone on this page would either
duplicate that machinery or fight the room for the device, and it would prompt for permission
twice. So the hand-off goes through `sessionStorage` -- a new `autoStartKey`, the same pattern the
dashboard's "continue" already uses -- and the room opens **already in a session** rather than on
the landing panel. One tap, then talk.

Verified end to end: the key is written before navigation, `/` opens with room chrome and no
landing panel, the key is consumed, and visiting `/` directly still shows the landing panel, so the
hand-off leaves nothing behind.

### Invented data by default, while it is being built

`/dash` renders the preview account without being asked, so the layout can be judged without an
account and a month of practice behind it. `?preview=0` shows the real one, and the dashed badge in
the corner is the link to it.

One switch, `previewByDefault`, is the only line to change when the page is done -- a constant
rather than a check scattered through the component, so turning it off cannot be half-done.

**The split that matters:** the orb stays **real**. Starting a fresh conversation carries nothing
invented across, so gating it would kill the one interaction worth testing here for no honesty
gain. The pick-up bar is the opposite and stays inert: it hands a saved rescue to the room, and an
invented one would write practice that never happened into a real account. It plays the collapse
and comes back.

Verified: bare `/dash` shows the invented account with the badge, the bar writes no resume key and
stays put, the orb writes the hand-off key and opens the room with no landing panel, and
`?preview=0` reaches the real account with no badge.

### What is not built

Speech-triggered entry -- "as soon as you start speaking" -- is still a tap. Doing it properly
means the mic living above both screens rather than inside the room, which is a real refactor and a
decision worth making on purpose rather than in passing.

---

## 2026-09-06 — The closing card and the home screen are one thing

The wedge is memory **proven** rather than claimed, and until today the surface that proves it was
behind a login. A stranger who tries OutLoud once and never comes back is the only user we actually
have, and they could not see it. From the handoff doc: *"items 27, 28 and 46 must land in session
one. A Reddit tester will never see day three."*

### What was actually there

Five surfaces saying "here is what OutLoud gives back", four of them in the room and mostly opening
each other:

| surface | state |
|---|---|
| `after` (closing card) | today's line, changed today / almost there / return hook, an email box, an account nudge |
| `profile` | "what OutLoud knows about you" |
| `evidence` | the evidence behind one row |
| `journey` | a **five-row session checklist** calling itself "your speaking journey" |
| `/dashboard` | the real thing, behind an account |

Two of those deserve naming. The room's "speaking journey" was not the journey — it was
*"answer the coach's first question"*, *"retry after a hint"*, *"start a real conversation"* — of
which **three rows were always already ticked** by the time anyone could open it. So there were two
lists with one name, and the one that told you where you were going was the one nobody could reach.

And the email box promises a link to `/m/<id>`, a route that does not exist. That part is left in
place deliberately for now, but it is sending 404s.

### Now

One `HomePanel`, one `DashboardData`, two variants. At the end of a session the room builds the
data from what it already holds — `coachLoot` plus the two rescue phrases for the words,
`derivePracticeLedgerState` for the ladder, `nextReviewAt` for the real return date. **No request,
no account, no waiting until day three.**

**Ordering is the load-bearing part.** A dashboard is a summary by nature, and a summary at the end
of a session reads as *done* — which would quietly kill the one retention mechanic this product has
("endings, never conclusions"). So the first thing on screen is always what is still unfinished and
when it comes back; what was achieved sits underneath it.

Session one deliberately does **not** render: the trend line (no evidence yet), the review queue
(the one thing just practised is not due — it is a promise with a date, not a to-do item), the
session list (a list with one row in it is not a history, it is the claim that there is one), or
the word filter (three chips do not need filtering). Those appear when they become true.

The five-row checklist is gone and the nine-stage path took the name, in both the panel and the
`journey` sheet.

### Two things the first real run-through exposed

**"almost there: insufficient evidence."** `formatBlockerLabel` only stripped underscores, so the
enum name was being printed at the learner. `blockerFocusLabels` is the plain-language version of
the same taxonomy and covers all eight. Then the fix needed a fix: `normalizeObservedBlocker` falls
through to `sentence_assembly` for anything it cannot place, `undefined` included — so mapping it
unguarded would have printed a confident diagnosis ("putting the sentence together") at a learner
we had observed nothing about. Guarded: with nothing to go on, the next session's job is to find
out, and that is what it now says.

**`tomorrowLabel()` hardcoded +24h.** The return date now comes from the same `nextReviewAt` the
server writes to `retrieval_due_at`, so the weekday on the card is the weekday the moment is really
scheduled for. Pinned in a handler rather than read during render — `Date.now()` in a render body
is impure, and a return date that drifts on re-render is exactly the kind of small lie this app
cannot afford.

### The account ask changed with it

It used to be a claim about an invisible future — *"OutLoud won't know you next time without an
account."* The panel now shows the thing itself, so the ask points at it: everything visible is
what an account keeps. That is #32, and it is the sequencing correction the handoff doc asks for —
the dashboard stops being a page for people who already signed up and becomes what session one ends
with.

The words on the card come from the same `sessionWordList()` that `saveWordBank` posts, so the card
cannot show a set different from the one that gets saved.

### The account pages could not scroll, and never could

`overflow: hidden` sat on `body`, which is every route. It is there so the room -- a fixed
one-screen app -- never rubber-bands, but it also meant `/dashboard` and `/profile` clipped
everything past the first viewport. Nothing below the fold was reachable by any means.

Pre-existing, and invisible until the home screen got long enough to run past the fold. Now scoped
with `body:has(.app-shell)`, and `.app-shell` is rendered by `app/page.tsx` and nothing else. A
browser without `:has()` falls back to a scrollable body on the room, which changes nothing there:
`.room` is exactly `100dvh` and clips its own content anyway.

Measured after the fix: the dashboard scrolls its full 3772px and reaches the bottom, the room
still computes `overflow-y: hidden` and does not move on a wheel event.

### Verified

A full typed run-through against the live routes to the closing card: sections in the order
`after-stack → speaking journey → your words`, nine stages, current stage "introduce yourself" with
an honest *"0 sentences said with nothing on the screen so far"*, the return date rendering as the
real weekday, both rescue phrases present, and zero review-queue / session-list / word-filter nodes.
`/dashboard?preview=1` unchanged after the extraction. tsc and eslint clean.

---

## 2026-08-31 — A way into the account pages from the room

A `debug` pill in the room header, between `feedback` and the profile icon, linking straight to
`/profile` (which links on to `/dashboard`).

The gap it fills: the profile icon opens the **sign-in dialog** when signed out, deliberately —
signed out, the profile page is nothing but an empty state. But that also means the account pages
cannot be reached from the room at all without an account, which makes them awkward to look at
while working on them.

**On in development.** On a deployed build it takes one visit to `?debug=1`, which persists in
`localStorage`; `?debug=0` clears it. That opt-in exists because the room is really tested on a
phone, where there is no console to type a flag into. Dashed border, so it can never be mistaken
for something a learner is meant to see.

Leaving mid-session is safe: the room's unmount cleanup already stops the media stream and
disconnects the realtime session.

---

## 2026-08-31 — A decoder loop was quoted back as the learner's own words

Reported from a live session: server VAD cut the learner off mid-sentence, and the transcript came
back as **"Oh god"** repeated about twenty times. Whisper-family models do this when handed a
truncated or content-poor clip — they repeat one short phrase until the token budget runs out. It
is a decoder in a loop, not speech.

It then went through **every** existing gate untouched:

- not empty, and VAD had reported speech, so the dud gate passed it
- not hesitation, so the filler guard passed it
- it contains none of the words `looksBrokenAttempt` looks for, so it was not even suspicious —
  **no confirm box**, straight to `submitAttempt`
- scored by `/api/evaluate`, stored in `sessionTurns`

And then the worst part. `momentBefore` deliberately hunts for the first **broken** attempt to show
on the closing card as *"here is how it sounded before"*. So the loop was selected and displayed as
what the learner had said. They were quoted saying something they never said, on the one screen
meant to show them their own progress.

### Fixed

`looksLikeDecodeLoop`, applied in two places on purpose:

**At capture**, before anything can score or store it — discarded, and the next capture gets the
`patient` VAD window, because a clipped recording is what produces the loop in the first place and
cutting them off again would just reproduce it. The room says *"that came back garbled — say it
once more, I'll wait longer."*

**At the card**, filtering `placementAttempts` before `momentBefore` picks from them. Belt and
braces on purpose: a loop stored before this guard existed would otherwise still be on someone's
card, and it is our microphone failing rather than them.

Non-overlapping windows of one to four words: a unit has to repeat at least four times **and**
cover 60% or more of the transcript. Below eight words nothing is flagged at all, because short
repetition is human.

Checked against 14 cases. Every loop shape caught; every real utterance survived — including the
learner's own stuttering transcript from an earlier session (*"but I I I wouldn't know because like
usually my entire day..."*), `"sí, sí, sí"`, `"yo yo yo quiero un café"`, `"no, no, no gracias"`,
and a repetitive but legitimate list (*"quiero pan, quiero café, quiero agua..."*).

### Still true

The premature cut-off that started it is not fixed, only softened. `silence_duration_ms` is 1200ms
on a normal capture, and a learner mid-sentence can still be clipped; the patient profile only
comes into play after something has already gone wrong. Endpointing that adapts to how this
particular learner speaks is a separate piece of work.

---

## 2026-08-31 — Explaining yourself is not a failed attempt

From a session where the learner did the most human thing available: asked to order in Spanish,
they explained in English what they would try and why they could not. *"I would start with saying
like yo for me, but I wouldn't know, because usually my entire day was just programming and a bit
of work and eating some steak, which was very tasty, but I know none of these words for it, so I
don't know where the problem lies."*

Replayed against the live route, the coach answered: **"¿Cómo? ¿Quieres decir 'para mí' para
ordenar?"** — feigned confusion at a paragraph of clear English, having picked out the one
Spanish-looking fragment and ignored the programming, the work, the steak, and the explicit "I know
none of these words".

Then, to **"no idea honestly"**: **"Perfecto, ¿qué te gustaría beber hoy?"** Praise for a
non-answer, followed by a new question that left them exactly as stuck.

### Three separate causes, all of them ours

**1. The prompt told it to read English as a Spanish attempt.** *"If answering.phase is 'scenario',
their text IS their first Spanish attempt"* — no exception for a learner explaining themselves.
Now: talking about the task is not attempting it, it is never answered with confusion, and the help
is built from what they actually described ("programé", "trabajé", "comí un bistec"), not a stock
phrase from the scene.

**2. The prompt handed it "¿Cómo?" as the model answer.** The retry rule carried a literal example
— *e.g. "¿Cómo? ¿La comida está...?"* — and the model reproduced it verbatim, including after
perfectly clear English. A concrete example outweighs any rule sitting beside it. The example now
carries the distinction: warm non-comprehension after a garbled *Spanish* attempt, and after an
English "I'm stuck" the invitation uses the word being handed over instead.

**3. The server classified "no idea honestly" as a good attempt.** `attemptLooksFine` asks for
three or more words and no English function words from a fixed list. "no idea honestly" is three
words and matches none of them, so the server sent *"the last attempt looks fine on the surface:
tool MUST be none and you ask a NEW question"*. The "¡Qué rico!" was not the model going rogue; it
was doing what it was told.

New `attemptDeclaresStuck`, which takes priority over both existing surface reads and forces a tool
onto that turn. **English only, deliberately:** a learner who answers a Spanish question with "no
sé" has given a real and correct Spanish answer, and treating that as a cry for help would take a
good turn away from them. Declaring it in English is stepping out of the task — that is the signal.
Checked against 17 cases; every Spanish "no sé" variant passes through untouched.

Also added, because it is the sharper version of the same failure: **never react to what you wish
they had said.** "¡Qué rico!" only makes sense if the steak sentence had been produced. It had not.

### After

| | before | after |
|---|---|---|
| the long English explanation | *"¿Cómo? ¿Quieres decir 'para mí'?"* | *"¿Quieres probar con estas palabras? Dime: programé, trabajé, comí un bistec."* |
| "no idea honestly" | *"Perfecto, ¿qué te gustaría beber hoy?"* (tool: none) | *"Aquí tienes: 'comí' significa 'I ate'. Dime: comí un bistec."* (keyword_card) |

Two runs each, both clean. `/api/converse` got the compact version of the same two rules.

### The limit worth stating

The ask behind this was *"I'd like it to be like talking to Claude normally, and it helps when I
need help."* The second half now works. The first half does not, and not by accident: the intake is
a four-phase machine driven by turn index (`phaseForTurn`), and that rigidity is load-bearing — it
was put there because a mislabelled turn could drag a session back into framing forever. It will
never be open-ended conversation.

The place free conversation lives is the aside. What this change buys is that the structured part
stops actively fighting someone who is being honest inside it.

---

## 2026-08-31 — "Um..." is not an answer

Server VAD ends a turn on silence. A learner who says *"um..."* and then thinks has produced a
complete turn by the microphone's definition, containing no answer — and the room put a confirm box
in front of them: **"here's what I heard. fix anything that's wrong, then send."** The transcript
was perfectly accurate. They were being asked to correct their own hesitation.

Now a capture that contains nothing but hesitation reopens the mic with a `patient` VAD profile
(`silence_duration_ms` 1200 → 2600, and double the idle window) and a quiet *"take your time."*
Two of those per turn; after that the room hands the turn back with a note and stays open.

Deliberately **not** routed through `registerDudCapture`: the room is not noisy and hold-to-talk
would not help, so the "noisy room?" offer must not fire here. Different problem, different answer.

### What the detector must never swallow

`mm`, `mmm` and `mhm` are excluded, and the reason is not fussiness: as a whole utterance they
usually mean **yes**. A learner answering a yes/no question with one has answered it, and treating
that as hesitation would silently discard a correct reply — the exact failure the short-answer rule
(2.1) exists to prevent. `ah` is a reaction, not a stall. `eh` and `este` are real Spanish words;
`well` and `like` are real English ones. Only the unambiguous vocal stalls are in the set.

Checked against 25 cases including every one of those — `"Um..."`, `"uh, um..."` and `"Ähm..."`
detected; `"sí"`, `"mhm"`, `"para llevar"`, `"um, el museo"` and `"uh I think it's the vocabulary"`
all passed through untouched.

### Found while doing this, not fixed

**`lastVoiceFreeze` is never set on the realtime path.** It is assigned in exactly one place — the
MediaRecorder fallback that calls `/api/transcribe` — and the realtime capture path calls
`routeCapturedTranscript` directly with no freeze signals at all.

So every session that uses voice normally sends `secondsToFirstWord: null`, `hesitations: 0`,
`englishWords: 0` to `/api/converse`. The character's reaction to *how* a reply came out, the
aside's English-words trigger, and any diagnosis of `hesitation_pressure` from timing are all
running on zeroes. The data exists on the client (`realtimeSpeakingStartedAtRef` and friends) — it
is simply never assembled on this path.

That is its own piece of work, and it is worth doing before trusting anything the app says about
hesitation.

---

## 2026-08-31 (later still) — The character was answering the wrong half of the conversation

Reported twice from real sessions and misdiagnosed the first time. Asked *"¿dónde está la
biblioteca?"*, the character asked the learner how to get to the library. Asked *"¿dónde está el
museo?"*, it replied *"¿puedes decirme si el museo está cerca o lejos de aquí?"* — handing the
question straight back.

The first time this was blamed on transcription: the learner's Spanish had been coming back as
Danish, so garbage input was a sufficient explanation. It was not the explanation. This time the
transcript was clean — `"Hola Carlos, donde está la museo?"` — and the same thing happened.

### Cause

Both engines are written as if the character always asks and the learner always answers.

`/api/coach`: *"ask ONE real, short question in Spanish"*, *"a good answer gets tool=none and a new
question"*, *"never ask the same thing more than twice"*, *"expectedCommunicativeFunction: what a
good reply to sayEs would do"*. `/api/converse`: *"one realistic follow-up at a time"*, and every
per-turn instruction says to ask something.

Nowhere does either say what to do when the **learner** asks the character a question. And a large
share of real scenarios are exactly that: directions, ordering, prices, shopping, phone calls,
asking a favour. Told five times to ask a question, the model asked one. That it was semantically
absurd was not something the prompt gave it any way to know.

### The deeper one, in the opening line

`conversationDifficultyGuidance(0)` read: *"stay close to the practiced pattern and the original
situation. **Prompt the user to use the phrase they just practiced.**"*

The model read that as an instruction to *say* the phrase. So a learner practising "¿dónde está el
museo?" was greeted by a passer-by asking THEM where the museum was — the role reversal, on turn
zero, before anyone had said anything. This is the better explanation for both original reports.

Now: the character creates the opening, the learner walks through it. Never say the learner's
practised phrase, never ask them the question they are learning to ask. In a scene where the
learner wants something, opening as someone who has just been approached is usually right
("¿sí, dime?") — and then wait.

### Fixed

- Both engines: if the learner asked you something, **answer it**, with real invented detail. You
  are the person who is there. A follow-up may come after the answer, never instead of it.
- Scoped to `lastUserAttempt` only — a first pass at this had the character reading the rescue
  card's practised sentence as a question it had been asked, and opening the scene by volunteering
  directions to someone who had not spoken yet.
- `/api/coach`: a slip that does not block understanding ("la museo" for "el museo") is **not** a
  stumble. It goes in `evidence`, where diagnosis belongs; it does not stop the conversation for a
  repair drill.

### Verified

Three runs each, against the live routes.

| | before | after |
|---|---|---|
| coach, learner asks | *"¿Puedes decirme si el museo está cerca o lejos de aquí?"* | *"El museo está a dos cuadras, junto al parque. ¿Vas caminando o en carro?"* |
| converse, turn 0 | *"¿Me puedes decir dónde está el museo?"* | *"¡Hola! ¿En qué te puedo ayudar?"* |
| converse, learner asks | *"Sí, y abre de nueve a cinco"* (answering a question nobody asked) | *"Claro, está a dos cuadras, a la derecha. ¿Quieres que te acompañe un tramo?"* |

The coach run also now reports `tool: none, intent: advance` with `evidence: "minor article
mistake, fully understandable"` — the conversation moves on and the slip is recorded rather than
drilled.

Regression check on the opposite shape: a scene where the character legitimately leads still opens
*"¡Hola! Cuéntame, ¿qué hiciste el fin de semana?"*, and does not say the learner's practised
sentence at them.

---

## 2026-08-31 (later) — Stepping out of the intake too

Found by the first real voice test, in the first two minutes. The learner said, out loud, mid
intake: *"I can't remember any vocabulary. The truth is I barely even learned Spanish. Like I'm
completely new."*

That is the sentence this whole feature was built for, and it arrived in the one place the feature
did not exist. `showStepOut` required `flowPhase === "session"`, so the entire getting-to-know-you
— exactly where someone discovers this is the wrong level for them — had no way out. Every
following turn asked them for more Spanish.

Worse, what the app said back was: **"here's what I heard. fix anything that's wrong, then send."**
The transcript was perfect. The suspicion router had done its job (English words on a Spanish turn)
and the product then asked a person who had just admitted they cannot do this to correct their
own confession.

### What changed

The aside now covers both conversational phases, and knows which one it is in (`stage`). That
matters because the offers are not the same:

| | intake | session |
|---|---|---|
| `resume` | yes | yes |
| `change_focus` | yes | yes |
| `change_scenario` | — no scene exists yet | yes |
| `start_over` | yes | — the intake is finished |

`start_over` is new and is the answer to the case above: it throws the getting-to-know-you away and
restarts it from `newOpeningEn` — what the learner said about themselves, in their words ("I have
basically no Spanish yet, I want to start from nothing"). A conversation built on a wrong premise
gets worse every turn, not better.

`offerKindsForStage` is enforced server-side, not just described in the prompt: an offer the stage
cannot act on is downgraded to `resume` rather than rendered as a button that does nothing.

### Two more ways out, both from the same test

The confirm box now carries **"that's not the problem — can we talk?"**. Without it the offer was
unreachable from the screen where it is most needed: `typedFallbackOpen` renders instead of the
whole room, so the chip and the nudge were both behind it.

And the room offers the aside during the intake too, off the only signal that exists there — the
suspicion router firing twice in a row on a turn where Spanish was expected. There is no evaluator
before the verdict, so `noteAsideSignal`'s real verdicts are not available; `noteIntakeAsideSignal`
is deliberately gated to the intake so the two counters never both feed the same offer.

### A no-op button, caught by testing

Asked "anything you want different?" and told *"no, it's fine, let's keep going"*, the coach
offered to change the focus **to the one already set**. A button promising a change and delivering
none. The prompt forbade it and the model did it anyway, twice, so the server now decides:
`newFocus === focus.current` is downgraded to `resume`. It is a fact the server holds, not a
judgment call.

All five outcomes verified against the live route, and the whole intake path driven in a headless
browser: chip visible during intake, no offer on turn 0, `stage: "intake"` on every request, and
`/api/coach` restarted with the new opening answer — both openings visible in the request log.

### What this does NOT fix

The app still has **no concept of level**. Zero matches for "beginner" anywhere in the codebase.
The aside now gets the truth into the intake; the intake still does not know what to do with it.
In the verified run, the restarted coach answered "I have basically no Spanish yet" with *"let's
pick a real situation — ordering food at a cafe, or telling someone about your job in two
sentences?"* — to someone who had just said they cannot make a sentence at all.

That is the next real problem, and it is bigger than an escape hatch.

**Also untested:** the "that's not the problem" link inside the confirm box. That box only appears
on a suspicious *spoken* transcript, so no typed harness can reach it.

---

## 2026-08-31 — Step out of the scene

Not from the build plan. It came from using the app: mid-roleplay you realise the problem you
actually have is a different one, and there is nowhere to say so. The `ask` chip looks like the
place, but it calls `/api/lifeline`, answers exactly one vocabulary question and keeps no
history — a dictionary, not a conversation.

So: a third conversational mode next to intake and roleplay. A `hold on — can we talk?` chip
pauses the scene and puts you in an English conversation with the coach, who listens, narrows it
down once, and then offers one concrete move. Taking the offer can **change the scene** (new
situation, new named person) or **re-point the focus** (`asideFocusOverride`, which outranks both
the observed and the stated blocker for the rest of the session, and reorders the help ladder
through `assistanceOrderFor`). The honest default is `resume`: nothing changes, you were heard.

**New:** `app/api/aside/route.ts`, `lib/aside-schema.ts`.

### Why it is a room mode and not a sheet

`deriveMicWindow` closes the mic whenever `overlayRef` is set. An aside built as an overlay would
have been silent, and a silent "let's talk about it" is the one shape this cannot have. It renders
in the room instead, on the same `turnState` machine and the same mic, with the scene header and
the whole tool row hidden — help / fix / pronounce all act on a Spanish turn that is not currently
happening.

The scene is frozen, never torn down: `conversationId`, `turnIndex` and `currentConversationTurn`
are untouched, so an aside costs no practice turns and coming back re-speaks the exact line you
walked out of.

### Two ways out, and why voice is not one of them

The chip is always visible — it survives progressive disclosure and it survives the coach
speaking, because "actually, hang on" usually arrives mid-sentence. On top of that the room offers
it after two replies that were **heard but did not land**, or one with four or more English words
in it.

That counter is deliberately separate from `registerDudCapture`'s. "I keep missing you, noisy
room?" and "that isn't working, what's going on?" answer different problems, and offering the
wrong one is worse than offering neither. A missing `/api/evaluate` verdict counts as neither a
strike nor a reset: an outage of ours is not the learner failing, and stepping out cannot fix it.

Speaking "wait, stop" is not a trigger and should not become one. Transcription is pinned to
Spanish during practice — the fix for the Danish transcripts — so English spoken into a practice
turn comes back as mush. The chip is what flips the pin to English.

### The engine is stateless, unlike the other two

`/api/coach` and `/api/converse` keep server-side sessions because their state holds judgments the
server derived and must not re-derive. This engine derives nothing it needs to remember, so the
whole aside travels on every call. That removes an entire session lifecycle — no id to lose, no
TTL, no "that aside has already closed" mid-sentence — and, as it turned out, a migration: the
shared `engine_sessions.kind` column has a `check (kind in ('coach','converse'))` that rejected
the first version outright.

### Three bugs found by running it, not by reading it

**The new scene inherited the old one.** A learner who said "ordering food is not my problem, it
is my girlfriend's family at dinner" was moved to the family dinner and asked whether they wanted
something to drink while they looked at the menu. Two causes, both in `/api/converse`: turn-0
guidance said "stay close to the original situation", and the base prompt demoted `scenarioContext`
to "background only". Fixed with a `sceneIsNew` flag that inverts which of the two describes the
scene.

That was not enough on its own, and the reason is worth keeping: `buildPlacementText` packs the
**entire transcript** of the first coached conversation into `originalText`. No instruction
outweighs a page of restaurant lines. On a scene change the client now sends a scene-neutral
stand-in — the pattern being practised and what breaks — and nothing about where they were.

**The coach would not use `change_focus` and would not use `resume`.** Told flatly "it's panic,
not vocabulary" it offered a new scene; told "it's fine, let's keep going" it invented one. Both
because `change_scenario` was described first and most richly, and because the focus values were
bare enum names the model had no way to match against. Now a three-question decision procedure
with plain-English glosses for every blocker, an explicit tie-break when someone names both a new
situation and a new difficulty, and a rule that a new scene is a *different* one and never an
easier one — the model kept "helping" by making the next person patient and kind, which is exactly
what the app exists to not do.

**Turn-2 guidance defaulted to another question.** "If you cannot name what they want different,
ask your last question" — so someone who had already said they were fine got interrogated. The
honest reading is the opposite: if nothing needs changing, the answer is `resume`, not another
question. All four outcomes now behave, verified over repeated runs.

### Verified

Every outcome driven against the live route (`change_focus`, `change_scenario`, `resume`, no offer
on turn 0, mid-thought not cut off), and the whole path driven in a headless browser from the
landing screen through a real session, out into the aside, and back into a replaced scene. The
voice half is untested as always — the harness aborts `/api/realtime-token`.

**Known weak:** the realtime bridge instructions were Spanish-only (`speak the exact Spanish
text`); they now say to speak each line in the language it is written in, but no English line has
yet been spoken through a real connection. And a scene about *three people talking over each other*
is still played by one voice — the app cannot simulate a crowded table, so a learner who asks for
that gets the right people in the right room and one of them at a time.

---

## 2026-08-29 — Phases 0–3 of the master build plan

One working session. 22 files changed (+2107 / −298), three new library modules, five manual test
documents. Verified against the live dev server with a headless browser and direct API probes —
**which turned out to cover far less than it appeared to**; see "The one that shipped broken" below
before trusting any voice-related claim here.

Ordering follows `outloud-master-build-plan.md`. Its own closing advice applies from here: **ship
Phases 0–2, then put the link in front of strangers.** Phases 4–6 should be ordered by what real
users complain about, not by that document.

---

## The theme: most of this was already "built"

The largest finding is not in any phase. Across all four, feature after feature turned out to be
present, wired to nothing, and quietly asserting something false. A regex that could only produce
two of eight possible answers. A stored field hardcoded to `null` for every record ever written. A
whole card that no button in the app could open. A prompt that had never once run.

None of these throw errors. They degrade into plausible-looking output, which is why they survived.
The per-phase work below was frequently smaller than the work of making the thing underneath it
true first.

---

## Phase 0 — Trust

| Item | |
|---|---|
| **#7** | Pressure Mode wired to real behaviour instead of a dead toggle |
| **#12** | Low-confidence audio is no longer scored |
| **#11** | Silence is never praised |
| **#13** | "That's not what I said" transcript repair, shown only on suspicion |
| **#15** | Meaning, grammar, pronunciation and transcription confidence judged separately |
| **#10** | Hold-to-speak label fixed |

**New:** `lib/transcription-confidence.ts`, classifying Whisper segments into
reliable / borderline / unreliable. Thresholds mirror Whisper's own reference fallback heuristic.

**Found while building:** `app/api/transcribe/route.ts` already requested `avg_logprob`,
`no_speech_prob` and `compression_ratio` via `verbose_json` — and threw all three away. The data
needed to refuse scoring bad audio had been arriving and being discarded.

**Also fixed:** `/api/realtime-token` allowed 5 mints per client per 24h in every environment, which
is five page loads per day and made iterating on the voice layer impossible. Now environment-aware;
production keeps the strict number.

---

## Phase 1 — The interaction model

Full-duplex shipped **split in two**, on purpose.

- **Half A — the mic stays open while it is the learner's turn.** Default. No tap needed to start
  speaking; server VAD decides when the turn ends.
- **Half B — cutting the coach off by talking over it.** *Not built.* Interrupting still needs a
  tap. It is the only part of full-duplex exposed to acoustic echo, and its failure mode — the
  coach interrupting *itself* and then telling the learner "nothing came through" — is worse than
  the tap it replaces.

| Item | |
|---|---|
| **#43** | Shared mic constraints, noise adaptation, one-tap fall back to hold-to-talk |
| **#41 / #39** | Session one shows the orb and `help`; everything else appears when first relevant |
| **#40** | The orb looks unpressable when it is |
| **#9** | English behind a tap — translations only, never instructions |

**Defects found, not on the roadmap:**

- The `${turnState}` class on the orb **matched no CSS rule at all**, and `OrbCanvas`'s `quiet`
  configuration — desaturated, still, clearly designed for exactly this — was unreachable.
- The MediaRecorder fallback called `getUserMedia({ audio: true })` with **no constraints**, while
  the realtime path set echo cancellation, noise suppression and auto gain. Now one shared
  constant, so they cannot drift again.
- `OrbCanvas`'s animation clock was keyed on `[state]` and reset `startedAt` on every transition.
- The "🔊 hear again" and "🐢 slower" buttons had **no `onClick`**, despite `speakCoachText` fully
  supporting slow playback.
- The help sheet rendered a **hardcoded list with invented sample text** and rung 2 hardcoded as
  "current" — zero session data. After progressive disclosure this became the only help affordance
  in session one, so fabricated content there was a trust bug, not a cosmetic one.
- The `eyes off` overlay — a mode explicitly for people *not looking at the screen* — had three
  buttons that did nothing.
- **A real race:** `speakCoachText`'s fallback timer set the room to "ready" while
  `finishPlacement`'s `/api/rescue` call was still in flight, inviting the learner to answer a
  conversation that had already ended.
- **Pressure Mode never reached the VAD.** `silence_duration_ms` was frozen into the realtime token
  at mint time, so the toggle wired in Phase 0 changed nothing mid-session. Fixed by moving it to
  `session.update`.

**Untested:** every one of the voice behaviours. See `PHASE1_MANUAL_TESTS.md`; **section 4 first** —
if `micMode: "push"` does not reproduce the old behaviour exactly, that is the most important bug,
because it is the rollback for all of it.

---

## Phase 2 — The stated problem drives everything

The complaint this section exists for — *"what was the point of telling it my problem?"* — had a
mechanical cause, and it was upstream of every item in it.

**The upstream bug.** All six items read one value, `selfReportedBlocker`. It was produced by a
client-side regex with **two** possible outcomes (`missing_words` or `not_sure`) against a taxonomy
of **eight**. Six blockers were unreachable, so a learner who said "I freeze when someone asks me
something unexpected" was filed as `not_sure` — which maps to `insufficient_evidence`, which maps
to the generic teaching policy. For most people the problem was never recorded at all.

The coach now classifies the opening answer as structured output on the framing turn, pinned there
by the route so no later turn can overwrite what the learner said about themselves. It is
instructed to answer `not_sure` honestly and often: *"I want to talk to my girlfriend's family"* is
a reason, not a blocker, and guessing a label there fabricates the one thing the flow exists to
learn.

| Item | |
|---|---|
| **#45** | Already in the framing prompt; now backed by a real classification |
| **#46** | Verdict says confirm / correct / both / not-enough, from evidence |
| **#47** | A focus line at the top of every session |
| **#48** | Help order comes from the diagnosed blocker |
| **#49** | One spoken callout when the learner beats their own blocker |
| **#50** | The profile shows that dimension, with movement |

**Four dead or false things this phase had to make real first:**

1. `chooseTeachingPolicy` already mapped every blocker to its own assistance order — and was
   imported by nothing. The ladder now reads it. Observed orders differ correctly per blocker:
   `WAIT → KEYWORD → FRAME → MODEL` for missing words, `WAIT → AGAIN → KEYWORD → FRAME → MODEL` for
   follow-up pressure, `WAIT → FRAME → NUDGE → KEYWORD → MODEL` for register.
2. `teachingPolicy: null` was hardcoded in the client, so `teaching_policy_json` was empty for every
   moment ever saved.
3. `assistanceUsed: "none"` was hardcoded on every session evaluation, so every stored intervention
   outcome claimed the learner needed no help — poisoning the teaching model, and making an honest
   #49 impossible until it was fixed.
4. **The "what OutLoud knows about you" card was unreachable.** It opened the evidence card; the
   evidence card opened it; nothing else opened either. A closed loop with no door — and the surface
   #50 is supposed to live on. The end-of-session card is now its entry point.

**The verdict headline** had been a single hardcoded sentence shown to every learner — *"you have
enough Spanish. the gap is getting it out fast enough."* — sitting where a diagnosis belongs. It is
now written from what they said against what happened, with the supporting evidence rendered
underneath whenever the verdict contradicts or complicates them. All four branches were probed
against the real model. The prompt is explicit that a manufactured contradiction is unrecoverable:
when weighing `correct` against `both`, choose `both`; against `confirm`, choose `confirm`.

**The callout's wording claims exactly what is measured** and no more. The roadmap suggested "you
found the word without me"; that would be false, because the guidance line is on screen the whole
time. It says *"twice in a row now — and you didn't reach for help once."* Opening the English
subtitle blocks it — tracked separately from `assistanceUsed` so comprehension help never
contaminates the production-help data the teaching model learns from.

---

## Phase 3 — The coach

**#8 was already built.** The adaptive coach replaced the three hardcoded placement questions some
time ago; nothing in the codebase still asks "what did you do yesterday after work?".

| Item | |
|---|---|
| **#29** | The coach names a person on the scenario turn, and the session is with them |
| **#14** | The coach's session lines capped at one idea, under ~20 words |
| **#38** | The two-try cap removed |
| **#44** | Reframed — see below |

**#29** returns structured data (`{ name, relation, traitEn }`), pinned to the scenario turn, and
becomes the `who` reaching the conversation, the rescue and the evaluation — where it drives
register and tone judgments that previously ran against `"an OutLoud Spanish coach"`. A learner who
said they freeze at unexpected questions was given *"Ana, close friend, very chatty and curious,
always asking unexpected questions"* — a character built to press on the thing they named.

**#14** was half-done: the coach route capped its lines at ~20 words, and `/api/converse` — where
most turns actually happen — had **no limit at all**.

**#38** was alive in the pronunciation retry, which stopped the learner after two attempts and said
so: *"two tries max."* In an app whose premise is that people give up on speaking too early. The
count survives but now changes what is *offered*, never what is allowed: after a couple of tries
the way out becomes visible instead of being taken for them.

### #44 was two different problems

The roadmap filed it as one prompt fix. It was not.

**Cross-session — the actual complaint.** Someone came back and the app did not know them. The cause
was mechanical: every run **is** saved, with the learner's email and `user_id: null`, but reading
any of it back goes through authentication. Without an account the practice sits in the database,
unreachable, while OutLoud greets them as a stranger. The after-card made it worse by asking *"want
me to bring this back tomorrow?"* next to an email box — a promise an email alone cannot keep; it
buys a private link to one session and nothing else.

The cards now say what an account does, why the line is drawn at a login rather than a typed-in
address (otherwise anyone who guessed the email could read the practice), and that signing up on
the same address brings across what was already saved — which `/api/library` really does. **That
last one is a factual claim and needs a manual check**; see `PHASE3_MANUAL_TESTS.md` section 4.

**In-session — reacting to how it is going.** The route received only the raw attempt text and a
boolean, so the character answered in the same pleasant register whether the learner nailed it or
dodged. It now gets two separate things, and the split is load-bearing:

- `recentEvidence` — the **settled** evaluations of earlier turns. Safe to speak about as fact.
- `thisTurn` — **measurement only**: pause before speaking, hesitations, English leakage, what they
  reached for. The evaluation of the current reply has not landed when the line is generated, so
  the character may react to delivery but is explicitly forbidden from asserting the Spanish was
  correct. Praising unchecked work is the exact failure Phase 0 spent itself removing.

Neither costs latency; both were already in hand.

### The repair loop, switched on

The character can now admit it did not understand. `/api/converse` had a complete
`repairSystemPrompt` and turn-index pinning so a misunderstanding does not consume the session
budget — and the client sent `repairRequested: false` unconditionally. Both the route and
`lib/types.ts` named `lib/repair-loop.ts` as the source of that decision. **That file did not
exist.** It does now.

Two things the wiring had to get right:

- The first version never fired at all. `insufficient_evidence` — not just `unclear` — is what an
  evaluator returns for a reply with nothing judgeable in it, which is exactly the English word
  salad a real listener answers with "¿cómo?".
- **A low-confidence transcript must not trigger a repair.** The evaluator is instructed to return
  `insufficient_evidence` precisely when the capture is suspect, so repairing on it would hand the
  learner the blame for our microphone.

The model also broke its own prompt on first testing, writing *"using the polite request pattern
'Quisiera ___, por favor.'"* into the guidance — handing over the phrasing the learner was supposed
to find. The rule was hardened; it now says only that it did not catch it and to try another way.

**Measured cost.** Turning this on required the evaluation to finish *before* the coach line is
generated, where the two ran in parallel. Four session turns each, same scenario:

| | parallel (before) | serialized (now) |
|---|---|---|
| turn, send → learner's turn again | 6.1 s | **8.2 s** |
| `/api/evaluate` | 2.4 s | 2.4 s |
| `/api/converse` | 3.7 s | 3.3 s |

Roughly **+2.1 s per turn, about a third slower**. The endpoints are unchanged; the wait is the lost
overlap. Reverting is one small change if 8 seconds reads as dead air on a real device.

---

## The one that shipped broken — voice input never worked at all

Found on the first real device test, after Phases 0–3 were all reported green.

Phase 1 added a guard so an armed mic could not leak room noise into the next turn:

```ts
if (micWindowRef.current === "closed" && type.includes("input_audio_transcription")) return;
```

The reasoning was inverted. A transcript for a turn **always** arrives after the mic window has
closed — `finishRealtimeListening` closes it and only then waits for the text. So the guard never
caught room noise (which arrives while the window is `armed`, not `closed`) and instead discarded
**every real transcript on the realtime path**. Voice input had a 100% failure rate from the moment
it was written. The trace makes it plain:

```
[rt] input_audio_buffer.speech_started          ← speech IS detected
[voice:finish] closing capture | speechSeen: true
[voice:mic] window capturing -> closed
[rt] ...transcription.completed "Honestly, I guess it would be just the vocabulary…"
[voice:transcript] IGNORED (mic window closed)  ← and we throw it away
[voice:finish] DISCARDED as dud — transcript came back empty
```

Fixed with an explicit `awaitingTranscriptRef`, marking the window in which a closed mic is still
expecting its own result.

### Why none of the automated testing caught it

The Playwright harness aborts `/api/realtime-token`, because a successful mint makes
`ensureRealtime` hang in `getUserMedia` on a machine with no microphone:

```js
await page.route("**/api/realtime-token", (route) => route.abort());
```

**Every green result across Phases 0–3 therefore exercised only the typed path.** This was recorded
at the time as "Half A is not tested on real hardware", which undersold it: the realtime path was
not tested *at all*, logically or otherwise. Anything touching it is unverified until a person
speaks into a device.

### Voice-path tracing, kept

The bug was invisible from outside because the realtime channel is a WebRTC data channel — nothing
in the network tab — and `ensureRealtime` ended in a bare `catch {}` that turned every failure into
an identical silent drop to the MediaRecorder fallback. Both are fixed, and the path is now traced
end to end behind a flag:

```js
__outloudVoiceDebug(true)   // toggle, no reload
__outloudVoiceDump()        // the buffered log, immune to console filters
```

Free when off. It found this in one run after two wrong guesses from reading the code.

## Bugs introduced during this work and caught before shipping

Listed because the pattern is useful: every one was found by looking at a screenshot or a test
result, not by reasoning about the code.

- Reusing `.coach-line-toggle` for the English fold hid the translation with **no discoverable way
  back**, defeating #9 entirely.
- The session focus line **drifted**: keyed to the latest turn evaluation, it read "today: the words
  that go missing" and three turns later "today: sounding like a person", while the profile card
  disagreed with the line above the orb in the same room. Now pinned to the placement verdict.
- `insufficient_evidence` rendered as an observed dimension — the absence of a finding presenting
  itself as a finding.
- `observed_blocker.evidence` was written in the third person ("The learner responded…"); harmless
  while unrendered, wrong the moment it appeared under the verdict.
- `lastVoiceFreeze` outlives the turn it was measured on, so a **typed** reply would have sent the
  pause from an earlier spoken one, making the character react to hesitation that never happened.
- The callout claimed "you didn't reach for help once" after the learner had opened the English
  subtitle — **caught by the product owner, not by me.**

---

## Known off, and known untested

- **Voice barge-in (Phase 1, Half B).** Deliberately staged behind a real-iPhone echo test.
- **All Phase 1 voice behaviour is unvalidated on hardware.** Headless Chromium has no microphone;
  the automated runs only prove the typed path is intact.
- **The positive callout fired once** across the test runs; the blocking side is confirmed
  repeatedly, the triggering side is not.
- **The account claim** — same email, earlier sessions come across — is asserted in user-facing copy
  and can only be checked manually.
- **+2.1 s per turn** from the repair loop is accepted but has not been felt on a device.
- **Phases 4–6** are entirely unbuilt.

## Housekeeping

- `MAX_OPENAI_REQUESTS_PER_SESSION` was raised to 400 in `.env` for testing. Production is
  unaffected (the strict default applies unless `NODE_ENV=development`).
- Four manual test checklists: `PHASE0_MANUAL_TESTS.md` … `PHASE3_MANUAL_TESTS.md`.
- Four pre-existing TypeScript errors remain untouched: `sessionId` in
  `app/api/retrieval/route.ts`, `playsInline` on `HTMLAudioElement`, and two Cloudflare types in
  `worker/index.ts`.
