# `talk` — the router's last intent, and the phrase that comes back

## Why this document exists

`/dash` routes what a learner says into one of a few things the app can do. Three of them are
built. `talk` is the last one, and it is the only one that has never had an engine — it takes the
honest refusal in `VOICE_ENTRY.md` §7 and says so out loud.

This is the design for building it. It is written before the build because the interesting half is
not the wiring: it is what happens **after** somebody is told how to say something, and that half
is easy to get subtly wrong in a way that still ships and still feels fine and quietly teaches
nothing.

**Built on 2026-09-07.** This document was written before the build and is left as it was written,
because the reasoning is what it is for. Where the build changed a decision or learned something
the design did not know, it is marked **[built]** in place. `CHANGELOG.md` has the narrative and
`VOICE_ENTRY.md` section 12 has what shipped.

---

## What the learner does

```
"how do I say I'll take care of it"

  →  one to three real options, with when to use each          /api/lifeline
  →  "say it"                                                  ← the beat that matters
  →  they produce it out loud                                  ← this IS the attempt
  →  a real rescue: what landed, what did not                  /api/rescue
  →  the phrase is kept, against their account                 word_bank
  →  a scene where they have to use it                         /api/converse

...and then, days later, in a scenario built for something else entirely,
they need that phrase again — and reach for it themselves.
```

That last line is the feature. Everything above it is the setup.

---

## 1. `talk` is three things wearing one label

The router returns one `talk` today, and the three things underneath it want three different
answers. So the intent splits:

| what they say | what it is | what runs |
|---|---|---|
| *"how do I say I'll take care of it"*, *"what's the word for landlord"*, *"cómo se dice…"* | a **question**: there is something they want to say | **`ask_phrase`** → the chain in §2 |
| *"I froze at the pharmacy today and switched to english"* | a **real moment** where it did not come out | **`stung`** → the room's existing `stung` intake, seeded with their sentence |
| *"can we just talk for a bit"* | open-ended conversation | **`talk`** → §7 refusal, **permanently**. See §4. |

`unclear` is unchanged and is not a home for any of these. *"can we just talk"* is perfectly clear
— we understood it and we are not going to do it, which is a different sentence than "I did not
catch that" and deserves its own.

### The precedence rule

*"I couldn't say I'll take care of it at the pharmacy today"* is both. **The moment wins.** A named
situation carries more than a named phrase: it has a person, a place and a reason in it, and the
phrase can be reached from inside it. The reverse is not true.

The router already has this rule in the shape it needs — *"If they name a situation AND ask a
question about it, the situation wins"* — and this extends it rather than adding a new idea.

### No keyword guard

The obvious implementation is a list: *"how do I say"*, *"what's the word for"*, *"cómo se dice"*.
Do not build it.

It misses *"I never know what to say when someone asks how I am"*, which is a phrase question with
none of those words in it, and it fires on *"I don't know how to say it went badly at the
pharmacy"*, which is a moment. The date guard in `/api/event-plan` learned this the expensive way:
a word list scanning a whole sentence is wrong in both directions at once.

What works here is what worked for the read-back compression and the beat titles: **worked
examples in the prompt, not rules beside them.** And the safety net is already built — the
read-back shows what was understood *before anything happens*, so a misread costs one sentence
rather than a session.

---

## 2. `ask_phrase`: the chain, and why the middle of it is not optional

### The wall

`/api/converse` refuses to start without a **rescue**, and a rescue needs an **attempt**
(`app/api/converse/route.ts:133`). This is the same wall the event engine (#30) had to get over,
and it is the reason a phrase question cannot simply become a scene.

Here it is cheap to cross, because the thing normally missing is already present:
`originalText` — *what they wanted to say* — is literally the question. *"I'll take care of it."*
No intake needed. One turn.

### The say-it-back is the point, not a flourish

The temptation is to answer the question and stop. Do not.

**The entire product thesis is that knowing the phrase and producing it under pressure are
different things.** Handing somebody a phrase and letting them scroll away is a dictionary, and
dictionaries already exist and are free. The beat that makes this OutLoud rather than a lookup is
the two seconds where they have to say it.

It is also load-bearing mechanically: what they produce is the `attempt` that `/api/rescue` needs.
Without it there is no rescue, and without a rescue there is no scene, no saved pattern, and
nothing to bring back later. Skipping the say-it-back does not shorten the feature — it removes
everything after it.

**The exception, kept deliberately:** `/api/rescue` already supports `skippedAttempt`. Somebody who
wants the phrase and nothing else gets it, and gets a thinner rescue. That path stays open, because
refusing to answer a question until somebody performs for us is the wrong trade.

---

## 3. The phrase that comes back — the aha

*This is the half the feature is for.*

### What it is

The learner asks for a phrase. Days later, in a scenario built for something else, they land in a
spot where exactly that phrase is what is needed — and they reach for it themselves.

The feeling is **"I know this one."** Not "the app is quizzing me". The goal is that the learner
feels *smart*, and that only happens if the retrieval is theirs.

This is spaced retrieval, with one difference that is the whole reason to expect it to work:
**the unit is a phrase they asked for, not a phrase we handed them.** They were curious enough to
ask unprompted. That is a far stronger cue than anything we chose for them.

### What it requires

**A gap.** Never in the same session. The point is that it comes back once they have stopped
thinking about it. Same-session resurfacing is a quiz and reads as one.

**The scene must NEED it, not SAY it.** If the character utters the phrase, we handed it over
again and the aha is gone — the learner recognises, they do not retrieve. The situation has to
create the need and leave the phrase to them.

> This machinery exists. `/api/variation` takes `targetChunkPatternEs` and builds a nearby
> situation that requires that pattern without stating it (`lib/practice-schema.ts`,
> `lib/practice-prompts.ts`). It is used today to vary a saved moment; resurfacing a phrase is
> the same job with a different input.

**Unaided or it did not happen.** If the help ladder offers the phrase first, we destroyed the
thing we were building. This is one of the few places where withholding help is correct, and it
has to be deliberate, because everywhere else in this app the rule is the opposite.

The measurement already exists too: the evaluator returns `usedTargetChunk`, and `assistanceUsed`
says whether they got there alone. **`usedTargetChunk && assistanceUsed === "none"` is the aha,
recorded.** Anything less is a phrase that has not landed yet.

**It must not always fire.** A scenario built around a saved phrase every single time is a
vocabulary quiz wearing a costume, and learners find the pattern fast. Frequency is undecided
(§6); the instinct is at most one per scene, and not in every scene.

**Never name the machinery before or during.** The moment the screen says *"you asked about this
two days ago"* on the way in, the learner is looking at a system instead of feeling a memory.

Afterwards is the opposite: once they have produced it unaided, saying *"you asked me that on
tuesday"* is the payoff, and it is the single line in this whole feature most likely to be the
thing somebody tells a friend about. Before: silence. After: name it.

### What decides which phrase comes back

Priority, so the scenario generator has something to build toward. Roughly, in order:

1. **Has it ever landed unaided?** If yes it stops competing — it is theirs now.
2. **How long since it was asked for**, on the spacing curve the app already uses
   (`reviewSpacingDaysAfterReview`, `lib/learning-loop.ts`).
3. **How many times it has come back without being produced.** Something that keeps failing to
   surface is either too hard or wrong for them, and after a couple of goes it should drop rather
   than nag.

This priority is an **input to scenario generation**, not a filter after it. The scene is built to
need the phrase; the phrase is not bolted onto a scene that was already written.

### What would kill it

Listed plainly so we can check ourselves against it:

- resurfacing in the same session
- the character saying the phrase
- the help ladder offering it before they have tried
- it firing every time
- announcing it on the way in
- keeping a phrase in rotation long after it is clearly not sticking

---

## 4. What is banned, and stays banned

`more-xavier-stuff.md` §6 lists **"open-ended free-chat mode"** among the hard bans.

So `talk` — the genuinely open one — is not "not built yet". It is **not going to be built**, and
its §7 copy should eventually say something truer than *"it's the first thing when I can"*, which
promises something we have decided not to do. Everything in this document is the alternative:
a question gets answered and turned into practice; a moment gets practised; open-ended chat
does not happen.

---

## 5. What exists, and what does not

**Exists and works:**

| | |
|---|---|
| `/api/lifeline` | answers one phrase question. `currentLine` and `rescue` are both **optional**, so it already runs with no scene. Returns 1–3 options with `useWhenEn`, a fallback frame, and a note. Keeps no history — "a dictionary, not a conversation" |
| `/api/rescue` | `originalText` + `attempt` → a real rescue with a `transferableChunk`. Supports `skippedAttempt` |
| `/api/converse` | the scene, given a rescue |
| `/api/variation` | builds a situation that **needs** a given pattern — the resurfacing engine |
| `/api/evaluate` | returns `usedTargetChunk` and `assistanceUsed` — the aha, measurable |
| `word_bank` | per-user phrases, with `times_practiced` and `last_practiced_at` |
| the room's `stung` mode | seeded from a sentence via `handleOpeningAttempt` |

**Did not exist. All of it does now [built]:**

- ~~the split intents~~ — `entryIntents` is
  `["resume", "new_scenario", "ask_phrase", "stung", "talk", "unclear"]`, with `askEn` as the field
  the chain hangs on
- ~~a surface for a lifeline answer outside a scene~~ — `FlowPhase` gained `"ask"`. A room phase,
  not a sheet, for the reason §2 gives
- ~~the say-it-back turn~~ — it produces the attempt `/api/rescue` needs
- ~~the resurfacing store and its priority~~ — `lib/phrase-recall.ts`, pure and AI-free
- ~~a new `word_bank.source` value~~ — `supabase/202609070002_phrase_recall.sql`, which also adds
  `due_at`, `resurfaced_count` and `landed_at`

**What the build added that this document did not anticipate [built]:**

- **`/api/variation` builds the "use it for real" scene**, not just the resurfaced one. §3 spotted
  that it was the right engine for resurfacing; it turned out to be the right engine for the
  immediate offer too, because it returns `situationEn` and `roleEs` — exactly what a scene start
  needs, and it builds a situation that requires a pattern without stating it.
- **`recallEligible` is passed explicitly by every scene start.** §6 left the scope of resurfacing
  open. It is settled as: ordinary scenes yes, event goes no, and the scene straight after a phrase
  question no. Explicit at every call site with no default, because a default is how "it fires
  every time" arrives six weeks later without anybody deciding it.
- **A pattern whose stem is under two words is declined, not scored.** `"quiero ___"` reduces to
  the single word *"quiero"*, which appears in a huge share of everything anybody says in Spanish.
  A phrase wrongly marked as landed never comes back, so the learner silently loses it.
- **The framing turn had the same bug as #30 did**, in the shipped `stung` path, and the fix for
  #30 had keyed on the mode rather than on the thing the mode stood for. See `CHANGELOG.md`.

---

## 6. Open decisions

**One table or two.** ~~To settle before building.~~ **Settled [built]: one.** Everything is on
`word_bank` — `due_at`, `resurfaced_count`, `landed_at` on the phrase's own row. The separate
scheduling table this recommended was dropped: the unique index already guarantees one row per
phrase per learner, and a second table pointing at it buys nothing that a column does not, while
adding a join and a second place for the truth to live.

**How often it fires.** ~~A judgment nobody has evidence for yet.~~ **Picked [built]: one scene in
three**, `sceneChance` in `lib/phrase-recall.ts`, and still a judgment nobody has evidence for —
it is one constant in a pure module, deliberately, so it is the easiest thing here to change once
there is any.

**Signed out.** `word_bank.user_id` is `not null` against `auth.users`, so saving needs an account,
and `/dash` deliberately works signed out. **Decided (Timo, 2026-09-07): an account is required.**
This sat against master-plan **#32** ("stop gating memory behind the email box"); the co-founder's
objection was **withdrawn the same day**, so the decision stands unopposed. What #32 was actually
asking — show somebody the value before asking for the address — is a live question about where the
sign-up sits, not about whether it may exist: `docs/TODO.md` section 1.1.

**Scope of resurfacing.** **Settled [built]: ordinary scenes only.** Event goes are excluded, and
so is the scene straight after a phrase question. Dropping an unrelated phrase into a run-up to a
real dated evening is the same failure as offering somebody a rotation topic next to their own
dreaded landlord call — which the coach's framing turn was fixed for on the same day. Every scene
start says yes or no explicitly rather than inheriting a default.

---

## 7. The one sentence to hold onto

If we build all of this and the learner never has the moment where they think *"wait, I know
this one"* — we built a lookup tool with extra steps.
