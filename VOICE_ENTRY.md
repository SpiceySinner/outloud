# OutLoud — Speaking your way in

**What this is:** the design for how a learner says what they want on `/dash` and actually gets it.
Layout, the copy, and the router behind it.

**Who it's for:** Timo, and any agent picking this up later. Decisions are recorded with the
reasoning so they don't get quietly undone — the same job section 5 of `more-xavier-stuff.md` does
for the product as a whole.

**Status:** agreed 2026-09-06. Steps 1 and 2 are shipped: the router exists and the microphone
is on the screen. Steps 3 and 4 — the two engines behind `new_scenario` and `talk` — are not.

---

## 1. The problem

A text field has a placeholder. A menu has items. **A microphone offers nothing.** The learner has
to guess what the system understands, and voice products die exactly there: someone says the one
sentence the system can't handle and concludes it doesn't work.

Two halves, and they are not equally hard:

**Discovery** — *"I didn't know I could say that."* Solved by the header (§4).

**Trust** — *"I said it and something else happened."* Solved by the read-back (§5), and this is
the expensive one. A misunderstanding here does not cost a second, it costs a whole session.

Both halves ship together or neither does. A header that invites something the room then ignores
rebuilds the exact failure Section I of the master plan is about: *"what was the point of telling
it my problem?"*

---

## 2. Decisions — do not undo these

| Decision | Reasoning |
|---|---|
| **The header lives above the orb** | It is the text closest to the act, and it reads as the system speaking first — which is already the product's rule ("the AI speaks first"). The header **is** that, in writing. |
| **Header copy is written as the words the learner would say** | *"tell me about Friday"* teaches a sentence. *"you can describe an upcoming situation"* teaches a category and helps nobody. This is the single cheapest decision here. |
| **The sentence shape stays stable; only the content changes** | A header that is different every visit is a slot machine — nobody learns a vocabulary from it. Two lines, always the same two roles: what is true now, and what else you could say. |
| **Two lines, not one** | Two options get learned at once, with no rotation, no motion, and no extra control on a screen designed to have almost none. |
| **The pick-up stays a full card, at the bottom** | Timo's call, and it is right: the pick-up **is** the retrieval loop — the memory proof, the thing no competitor has. A quiet line would bury the differentiator. At the top it was decorative; at the bottom it is in thumb reach and actually usable. **The one thing to watch:** it must never out-shout the orb. If testing shows people tap the card before they ever try speaking, that is the signal to turn it down — not before. |
| **Account button bottom-left, small** | Admin. It belongs out of the way. |
| **The focus line stays, below the orb** | #47 — the session's focus, named every time. Header above says what to say; focus below says what we are working on. They are different jobs and must not be merged. |
| **`unclear` never falls through to the funnel** | Silently starting the default intake after someone told you what they wanted is the trust-killer. It says it did not understand, and names what it can do. |
| **The router classifies and reads back. It does not teach.** | Same rule as the realtime layer being a voice bridge only. One brain per job. |

---

## 3. The layout of `/dash`

Still one screen, still no scroll. What changes is the order of the bands.

```
┌──────────────────────────────────┐
│                          [avatar]│   chrome, minimal
│                                  │
│   what steht an, wovor dir       │   THE HEADER — changes by state
│   graut?                         │   line 1: serif, larger
│   or say "just talk to me".      │   line 2: small, muted, speakable
│                                  │
│            ( ORB )               │   the act
│                                  │
│   today: the words that go       │   the focus line (#47), quiet
│   missing                        │
│                                  │
│  ┌────────────────────────────┐  │
│  │ WAITING 4 DAYS             │  │   THE PICK-UP CARD
│  │ me he perdido           →  │  │   full card, thumb reach
│  │ I've lost the thread       │  │
│  └────────────────────────────┘  │
│  [account]                       │   small, bottom-left
└──────────────────────────────────┘
```

The height chain from the current build carries over unchanged: shell is exactly `100dvh`, header
and card size to content, the orb band takes the remainder with `min-height: 0`, and the orb is
bounded by `dvh` as well as `vw` so a short phone shrinks the orb rather than losing the card.

**Settled:** the journey line and the three counts are gone from `/dash`. They live on
`/dashboard`, and this screen's discipline is that every element has to beat something already on
it. They did not.

**Learned while building it:** the header must not narrate the card. The first version read
*"'me he perdido' has been waiting 4 days"* directly above a card saying *"WAITING 4 DAYS / me he
perdido"* — one message, two elements, on the screen least able to afford it. The header names the
phrase (a bare "that one" needs a referent) and then spends the rest of the line on the half the
card cannot do: opening the door to saying something else entirely.

---

## 4. The header, state by state

Seven states. Line 1 is the claim or the invitation; line 2 is always something you could say out
loud.

### 4.1 Something is due

```
"me he perdido" has been waiting since Tuesday.
say "let's do that one" — or tell me what's on your mind.
```

The due item is named, because a vague "you have something waiting" is a chore and a specific
phrase is a memory.

### 4.2 Nothing due, but there is history

```
what's coming up that you're dreading?
or say "just talk to me" and we'll go from there.
```

This is the #30 question — the calendar question, not the skill question. It belongs here and
nowhere else: the funnel asks what is hard, this asks what is *happening*.

### 4.3 Brand new, no history

```
tell me about a time the words didn't come.
or just say hello and we'll start there.
```

Line 1 is the existing funnel entry, so this state is honest today with no router at all.

### 4.4 Listening

```
listening…
```

Line 2 empty. Nothing to teach mid-sentence.

There is a state before this one that the design did not have: **`connecting`** —
*"one moment — waking the mic."* The first tap mints a token, asks for the microphone and does
the handshake, which takes a second or three. Saying "listening…" through that is a small lie
that gets found out immediately, so it says what is actually happening instead. Every capture
after the first is instant and goes straight to 4.4.

**Why there is a tap at all.** The microphone cannot arm before permission, permission needs a
gesture, and minting a realtime session on page load would spend the daily budget on every visit
where nobody speaks. So "just start talking" here means "tap once, then just talk" — one tap
fewer than before, not zero.

### 4.5 Read-back — understood, about to act

```
friday. her parents. her mum talks fast.
starting that now.
```

See §5. This is the most important state on the screen.

### 4.6 Unclear

```
I didn't catch what you want to do.
say "pick up where I left off", or describe a situation.
```

Names the vocabulary at the exact moment it is needed. Never proceeds on a guess.

**The microphone reopens under it.** They have just been told what to say, and asking them to
find the orb again is the wrong moment to add a tap. So this copy sits on the header *while the
window is live* — which also means "listening…" is not what they read at the moment it
matters. The orb says that, and the sentence they need is worth more than the word.

The same shape covers the capture verdicts, which never reach the router at all: *"take your
time."* for a hesitation-only capture, *"that came back garbled. / say it once more — I'll wait
longer."* for a decoder loop. Both widen the silence window and reopen.

### 4.7 Understood, but not built yet

```
friday, at her parents. I can't build that one yet.
I've kept it — it's the first thing when I can.
```

See §7. As of 2026-09-07 nothing routes here: every intent that classifies also runs. The state
stays because the next intent that does not have an engine will need it, and because deleting the
honest refusal is how an app ends up quietly starting the default intake instead.

### 4.8 Understood, and not being built

```
just talking for a bit. open chat isn't a thing I do.
give me a real situation, or something you couldn't say.
```

Its own state, not a flavour of 4.7, because the two say opposite things to the same person. 4.7
is a promise; this is a no. Open-ended chat is a hard ban in `more-xavier-stuff.md`, so *"it's the
first thing when I can"* would be a promise we have decided never to keep — and somebody who comes
back in a month to collect on it finds out they were being managed.

The no still names what we DO take, because the header's whole job on this screen is to teach what
to say, and a refusal that leaves somebody staring at an orb has taught them nothing.

---

## 5. The read-back is the contract

The most important beat in a voice interface is the moment **after** the learner stops talking and
**before** anything happens, where the system shows it understood.

- It is **mandatory** on every confident result. Not optional copy.
- It is in **their** words, not a category. *"friday. her parents. her mum talks fast."* — not
  *"starting a new scenario."*
- It is short and it holds for roughly **1.5s**, then the room takes over.
- If the router is not confident, there is no read-back — it goes to 4.6 instead.
- **It is spoken as well as written** (added 2026-09-07, Timo's call). You talk to it and it
  answered in silence, which is asymmetric and quietly says the microphone is a form field.

This is what turns the header from a hint into a contract, and it is the half that buys trust
rather than discovery.

### What speaks, and what does not

**The screen speaks when it is responding to something you said, and stays quiet about its own
plumbing.** So: the read-back, the section 7 refusal and its promise, the 4.6 vocabulary, and
the capture answers (*"take your time."*, *"that came back garbled."*) are all spoken. The idle
timeout is not — nobody said anything to answer, and a voice from a phone somebody has put
down is startling rather than helpful.

**Two things this could have got wrong.**

*Echo.* Wherever the microphone reopens afterwards — 4.6 and both retries — the line is
awaited first. `voice.speak` resolves on **playback drained**, not on generation finished, so
the microphone cannot open while the coach is still audible and take his voice for an answer.
That is the whole reason the resolve is wired to `output_audio_buffer.stopped`.

*Latency.* On `resume` the line is **not** awaited. The room does not speak on arrival from a
resume (it shows the verdict card and waits for a tap), and the session survives the
navigation — so the read-back plays across the transition instead of adding two seconds of
waiting to every entry. This is the first thing the module singleton bought that was not just
hygiene.

A tap always cuts the line. Talking over a voice interface is the most natural thing a person
does to one, and a screen that ignores the tap while it reads a refusal out teaches them it is
not really listening.

---

## 6. The intents, and what is actually built

There were three. `talk` turned out to be **three things wearing one label**, and the three wanted
three different answers — so it split on 2026-09-07 rather than growing a mode.

| Intent | What the learner says | State |
|---|---|---|
| **resume** | *"let's do that one"*, *"pick up where I left off"* | **built** — `resumeMomentKey` into the room |
| **new_scenario** | *"dinner at my girlfriend's parents on friday"* | **built — 2026-09-07.** Dated, broken into the goes there is time for, run one at a time. This is #30 |
| **ask_phrase** | *"how do I say I'll take care of it"*, *"what's the word for landlord"*, *"I never know what to say when someone asks how I am"* | **built — 2026-09-07.** The lifeline answers it, then they have to **say it**, and that is the attempt everything downstream has always needed. `docs/features/router-talk-feat.md` |
| **stung** | *"I froze at the pharmacy today and switched to english"* | **built — 2026-09-07.** No new engine at all: the room's `stung` intake has existed since before this screen did and only needed a door |
| **talk** | *"can we just talk for a bit"* | **section 4.8, permanently.** Open-ended free chat is a hard ban. This is the one place in the app where "not built" and "never being built" are different sentences |

`unclear` is the last outcome and needs no engine.

`runnableIntents` in `lib/intent-schema.ts` is the record of what has an engine. It now says
`["resume", "new_scenario", "stung", "ask_phrase"]`. `/dash` branches on the intent itself rather
than reading that list, so the two can drift — adding an intent there without a branch here leaves
a learner being told their thing is not built when it is. Both change in the same commit.

### Telling the three apart

By worked example in the prompt, never by a keyword list. A list of *"how do I say"* misses
*"I never know what to say when someone asks how I am"*, which is a phrase question with none of
those words in it, and it fires on *"the woman at the bakery asked me something and I couldn't
work out how to say I was just looking"*, which is a moment. The date guard in `/api/event-plan`
already paid for that lesson: a word list scanning a whole sentence is wrong in both directions at
once.

**The precedence rule.** *"I couldn't say I'll take care of it at the pharmacy today"* is both.
**The moment wins.** A situation carries a person, a place and a reason, and the phrase can be
reached from inside it; a phrase on its own has nowhere to put somebody.

**`askEn` is the field the whole chain hangs on.** It is what they want to be able to say, in
English, with the asking stripped off — *"how do I say I'll take care of it"* → *"I'll take care of
it."* It becomes `originalText` in the rescue, which is the thing normally missing when there is no
scene. The first live run got the intent right on all five ask cases and put the QUESTION in
`askEn` for the grammar one (*"why is it me duele and not yo duelo"* → *"why is it me hurts and not
I hurt"*), which would have taught somebody how to say their own grammar question. The prompt now
carries that exact case as a worked example, and the test asserts `askEn` is never a question.

---

## 7. What we show for what isn't built

The honest failure state, and it is worth more than it looks.

**As of 2026-09-07 nothing routes here.** `new_scenario` came off it when #30 got an engine
(section 11); `stung` and `ask_phrase` came off it the same day; and `talk` moved to §4.8, which is
a different sentence — not a promise but a no. The path stays because the next intent without an
engine will need it, and because the corpus this collected is what said the event engine was worth
building at all.

`talk` is still **kept** on the way past, even though there is no promise attached to it. How many
people ask for open-ended chat is worth knowing precisely *because* we are refusing them.

When the router is confident the learner wants a new scenario and there is no engine for it, we do
**not** apologise vaguely and drop them in the funnel. We:

1. **Read back what they said**, so they know they were heard.
2. **Say plainly that it can't be built yet.**
3. **Keep it.** Store the sentence, show it on the screen, and say it is first in line.
4. **Offer the two that do work**, in speakable words.

Keeping it does two jobs at once. For the learner it turns a dead end into a promise. For us it
collects exactly the corpus #30 needs — real situations that real people asked for, in their own
words — which is the thing the master plan's self-audit says we do not have. The failure state
becomes the research.

---

## 8. Build order

1. ~~**The router**~~ — **shipped 2026-09-06** as `/api/intent` (shorter than the planned
   `/api/route-intent`, and the file is already `route.ts`). Stateless, following the `/api/aside`
   precedent. Takes the learner's sentence plus what is open and what the focus is; returns the
   intent, the compressed read-back, and a target. 22 sentences checked against the live route.

   Two things the first run taught it. The read-back came back as a **parrot** — *"how do i say
   i'll take care of it"* echoed word for word, which proves transcription rather than
   comprehension and reads as though nobody was listening; the prompt now carries three worked
   examples of the compression, and a concrete example outweighs a rule beside it. And *"hmm okay
   so"* was routed as `resume`, i.e. throat-clearing started a session nobody asked for; there is
   now a deterministic server guard that refuses an utterance made **entirely** of hesitation,
   agreement and discourse glue, so `"that one"` and `"yeah let's do that one"` both survive it.
2. ~~**The header + layout on `/dash`**~~ — **shipped 2026-09-06.** The orb is a microphone:
   tap once, speak, server VAD ends the turn, the read-back holds for 1.5s, then it acts.
   `resume` runs; `talk` and `new_scenario` take the §7 path; `unclear` reopens the microphone
   with the 4.6 copy already on the header.

   **The microphone could not move alone.** Around it in the room sat ~600 lines of guards, each
   paid for by a real failure, so they moved into modules that both screens use rather than
   being copied: `lib/voice-guards.ts` (what an utterance is — filler, decoder loop, dud) and
   `lib/voice-session.ts` (the connection, the microphone, one capture). The session is a
   **module singleton**, which is what lets it survive the `/dash` → `/` navigation: the room
   adopts the live connection instead of minting a second token and asking for the microphone a
   second time.

   The boundary is "get me a transcript" and "say this line, and tell me when the sound has
   actually stopped". **Policy** stays with the screens: which lines may be interrupted, what
   happens when one is, whether the microphone reopens afterwards. The room has closing lines
   nobody may talk over; the entry screen has nothing of the kind.

   The playback half moved on **2026-09-07**, when the read-back started being spoken (section
   5). Five more refs left `app/page.tsx`; `realtimeInterruptible` and `realtimeInterrupted`
   stayed, because they are policy.
3. ~~**`new_scenario`**~~ — **shipped 2026-09-07.** The engine behind #30: an event is
   named at the orb, dated, broken into three or four goes at the specific evening, and worked
   through one at a time. See section 11 for the decisions inside it.
4. ~~**`talk`**~~ — **shipped 2026-09-07, and not as planned.** The plan here said "a proper home
   chat, bounded the way the aside is". Looking at it closely, `talk` was three things wearing one
   label, and only one of them was chat — which is banned outright. So the intent split (section
   6) and the other two got engines: `stung` needed none at all, and `ask_phrase` got the chain in
   section 12. Open-ended chat is now a permanent no with copy that says so (§4.8) rather than a
   promise nobody was going to keep.

Steps 1 and 2 ship together. Shipping 2 without 1 is the Section I bug again.

---

## 9. Rules the router must follow

- **Never invent a target.** If it cannot name a real moment or a real situation, the answer is
  `unclear`.
- **Never reach for the funnel as a fallback.** `unclear` is a first-class outcome with its own
  copy.
- **English and Spanish both.** The learner may say this in either; the routing is about intent,
  not language.
- **A read-back on every confident result**, produced by the model, in the learner's own words.
- **It does not teach, correct, or converse.** One turn, one classification, one line back.
- **It never asserts the Spanish was good or bad.** That is the evaluator's job and it has not run.

---

## 10. What is unproven

Stated plainly, so nobody mistakes agreement for evidence.

- **That anyone will speak their wish at all.** People are trained by every other app to tap. The
  header may simply be read and ignored, and the card at the bottom tapped instead. That is the
  first thing to watch in testing, and the signal that would send us back to §2's caveat about the
  card.
- **That the read-back is worth its 1.5s.** It is a real cost on every entry. The argument for it
  is strong and the evidence is zero.
- **#30 itself.** The master plan calls it the biggest untested bet in the document, and building
  it does not change that. It is now testable rather than hypothetical, which is the only thing
  shipping it bought.
- **That three or four goes is the right number, and that an evening is the right unit.** Both are
  judgment. The arc — arriving, the middle, the bit you dread, leaving — is what a dinner looks like
  to us, and nobody has told us it is what preparing for one feels like to them.
- **Whether anyone answers "how did it go?"** It is the only evidence in the whole app about
  whether any of this reaches real life, and it is also the easiest thing in the world to ignore.
- **The header copy.** Written to be spoken, never tested on anyone who is not us.
- **The capture on this screen.** The automated harness aborts the realtime token, so what it
  proves is the layout, the resting copy and the honest no-microphone path. Tap — speak —
  read-back has only ever run on a real phone, by hand.

---

## 11. The event engine (#30)

Shipped 2026-09-07. What a learner sees: they say *"dinner at my girlfriend's parents on
friday"*, and the screen lays out four goes at that specific evening between now and friday,
runs them one at a time, and afterwards asks how it went.

### The wall it had to get over

Everything downstream of the room hangs on a **rescue**, and a rescue needs an **attempt**:
`/api/converse` refuses to start without one, and `moments` has `first_attempt` and
`rescue_json` as not-null columns. A named event has neither — nobody tried to say anything,
somebody named a date.

**The answer is that the first go IS the intake.** Seeded with what they said and which part of
the evening it is, it produces the rescue, and every go after it starts its scene from that
same rescue — exactly the shape `restartSceneFromAside` already used to move somebody to a new
situation. That is what makes a four-session run-up possible without four placements, and it is
why `startSceneFor` is now shared between the aside and the event.

### The rules inside it

**Never invent a date.** `/api/event-plan` must quote the words it read the date from, the
server checks that the quote actually appears in what the learner said, and that the quote
names a time. Anything else is `null`, and an undated event still gets a plan. The first
version of that guard checked the whole sentence for time words and was wrong in both
directions: it would have refused *"christmas with her family"* a perfectly real date, and then
asked *"when is it?"* — to which the only answer is "christmas" again.

**The model writes content; `lib/event-plan.ts` owns counts and dates.** The same split as
Pressure Mode and the VAD profiles. A model left to schedule produces seven daily sessions for
a dinner three weeks out, which is a promise the app then breaks. Three or four goes, the first
one today because that is when they mean it, the last the day before, and a run-up that closes
in rather than nagging for a month.

**The beat they dread survives the thinning.** The model marks it, because position cannot:
*"I have to call the landlord tomorrow about the heating"* thinned by position came back as the
hello and the goodbye, with the complaint the whole call is about dropped out of the middle.

**One person per scene.** The room plays a single character and its prompt forbids it to switch
or rename, so `"Elena and Carlos"` in `characterName` leaves it with nobody to be. The prompt
says so and the server enforces it, because the prompt lost twice.

**The tense is a mode.** `stung` and `upcoming` both mean "a real situation of theirs", and
five prompts downstream describe where the learner came from. Running an event through the
stung wording tells every one of them that the learner already failed at a dinner they have not
been to.

**There is no framing turn.** The intake normally opens by offering two situations to practise in
— the learner's own, and a rotation topic. For an event that question is already answered twice
over: they named the thing, and the app named which part of it this go is. Asking anyway put
*"calling your landlord, or telling a friend about your job?"* on screen half a second after
somebody said they had to call their landlord, which is the *"what was the point of telling it my
problem?"* failure rebuilt one screen later. `phaseForTurn` returns `scenario` for turn 0 and
`chosenScenario` is settled before the first turn, so the choice cannot be offered rather than
merely being discouraged.

**And the rule is not about the mode.** Walking through the door built for `stung` on 2026-09-07
produced the same screen: somebody who had just said *"I froze at the pharmacy today"* was asked
whether they would rather practise a pharmacy or telling someone about their job. `mode` was only
ever standing in for "we already know what they are practising", and it stood in badly. The test
is now the settled scenario itself — `skipsFraming`, fixed at start and never recomputed, because
`chosenScenario` becomes non-null for *every* session the moment framing is answered and so cannot
double as the signal. Somebody whose whole answer is *"I just froze, I don't know"* still gets the
framing turn, which is right: for them the two concrete options are the help, not the insult.

### After it happens

The screen asks *"how did it go?"* once, and stores the answer **verbatim and unclassified**.
The sentence is the research; a label would be what we analysed instead of it.

One closed question follows, answered with a tap: *"did you get to say any of it?"* Only a yes
moves the linked moments to `confirmed_real_life`. That rung of the mastery ladder is labelled
*"you used it for real"* and until now nothing could honestly put anyone on it — it was inferred
from a perfect transfer evaluation, which is practice. Turning up and freezing is not mastery,
which is exactly why the question is asked separately instead of being read out of the sentence.

### What it needs that nothing else did

`supabase/202609070001_events.sql`. Until it is applied, creating an event ends honestly at
*"I couldn't save that one"* rather than in a promise the app cannot keep. Saving a normal
moment is deliberately unaffected: `event_id` is only sent when there is one, so a schema
change for a new feature cannot break saving for everybody else.

---

## 12. `ask_phrase`, and the phrase that comes back

The full design, including every rule and the reasoning behind it, is
`docs/features/router-talk-feat.md`. This is what shipped on 2026-09-07.

### The chain

```
"how do I say I'll take care of it"        /dash, spoken
  → read-back, then straight into the room
  → 1-3 real options, each with when to use it        /api/lifeline
  → "now say it."  →  they produce it out loud        ← this IS the attempt
  → a real rescue: what landed, what did not          /api/rescue
  → the phrase is kept, with a date to come back      word_bank
  → "use it for real"  →  a scene                     /api/variation → /api/converse
```

**The wall.** `/api/converse` refuses to start without a rescue, and a rescue needs an attempt —
the same wall #30 had to get over. Here it is cheap, because the thing normally missing is already
present: `originalText` is literally what they asked for. One turn, no intake.

**The say-it-back is load-bearing, not a flourish.** What they produce is the attempt. Without it
there is no rescue, no scene, and nothing to bring back later — skipping it does not shorten the
feature, it deletes everything after it. It is also the entire product thesis in two seconds:
knowing the phrase and producing it under pressure are different things, and a screen that stops
at the answer is a dictionary, which already exists and is free.

**A room phase, not a sheet.** `FlowPhase` gained `"ask"`. The existing ask chip renders a lifeline
answer in an overlay, and **overlays close the microphone** — the same fact that made the aside a
room mode. A say-it-back inside a sheet would be a screen that asks somebody to speak and cannot
hear them.

**All the options, with when to use each.** The in-scene sheet shows `options[0]` and throws the
rest away, because it is interrupting a conversation. Here, choosing between them *is* the lesson:
"which of these would you actually say" is most of what knowing a phrase means.

**No moment is saved for the ask itself.** Only playing the scene saves one, through the normal
path. A thirty-second lookup is not a session and must not sit in the list next to one. (Timo's
call, over the alternative of counting it if they play the scene.)

### The half the feature is for

Days later, in a scene built for something else entirely, the learner lands in a spot where exactly
that phrase is what is needed — and reaches for it themselves. The feeling is **"I know this one"**.
The goal is that they feel smart, and that only happens if the retrieval is theirs.

`lib/phrase-recall.ts` is pure and AI-free, the twin of `lib/event-plan.ts`: the model writes
content, deterministic code owns counts and dates. Every rule in it exists to stop one of the six
ways this dies, all of which ship fine and quietly teach nothing:

| what kills it | what stops it |
|---|---|
| resurfacing in the same session | `minimumGapHours` — never inside 20 hours of being asked for, whatever `due_at` says |
| it firing every time | `pickForScene` returns at most one, and nothing about two scenes in three |
| steering everything | `recallEligible` is passed explicitly by every caller; **event goes are out**, and so is the scene straight after a phrase question |
| the character saying the phrase | the injected instruction creates the NEED and forbids producing it |
| help offered before they try | the aha requires `assistanceUsed === "none"`, so a handed-over phrase is not recorded as landed |
| nagging forever | `maxResurfaces` — after three fruitless returns it stops being scheduled |
| announcing it beforehand | nothing is said on the way in. **Afterwards is the opposite** |

**Never name the machinery on the way in.** The moment the screen says *"you asked about this two
days ago"* before they try, they are looking at a system instead of feeling a memory. Once they
have produced it unaided, the callout says so — and that line is the one most likely to be the
thing somebody tells a friend about.

**The measurement is deterministic.** The evaluator's `usedTargetChunk` judges the rescue's chunk,
which in a resurfacing scene is a different string entirely, so it cannot be used. Instead:
accent- and punctuation-blind containment (the same flattening as `appearsIn` in
`/api/event-plan`) **plus** `assistanceUsed === "none"`. Both, or it has not landed.

The unit tests found the one real trap here: a pattern is stored with its blank in it, and
`"quiero ___"` reduces to the single word *"quiero"*, which appears in a huge share of everything
anybody says in Spanish. A pattern whose stem is under two words is now declined rather than
guessed at — a phrase wrongly marked as landed never comes back, so the learner silently loses it.

### What it needs that nothing else did

`supabase/202609070002_phrase_recall.sql` — `'asked'` joins the `source` CHECK, and `word_bank`
gains `due_at`, `resurfaced_count` and `landed_at`. Until it is applied, a phrase question still
answers and still becomes a scene; what does not happen is the keeping, and therefore the coming
back. `/api/library`, which the dashboard reads, does not touch the new columns either way, so it
cannot break whether the migration has run or not.

**Signed out, this half is simply off.** `word_bank.user_id` is not null against `auth.users`.
That is a real hole rather than an oversight, and it sits against master-plan **#32** ("stop gating
memory behind the email box").

**Settled 2026-09-07: requiring an account is allowed.** The co-founder's objection was withdrawn,
so the constraint above is a choice rather than a blocker. What #32 was really asking — show the
value before asking for the address — is still open, and is now `docs/TODO.md` section 1.1.
