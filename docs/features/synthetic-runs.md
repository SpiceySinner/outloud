# Synthetic runs — testing a coach that never says the same thing twice

## Why this document exists

Task 1.3 asks a question the app cannot answer about itself: *would this work on people who are
not us?* Judging that one screen at a time is how you end up convinced by six good sessions and
blind to the seventh, so it needs a corpus — many runs, by people who are not us, measured the
same way every time.

The obstacle is that the thing under test is a language model. It phrases every turn differently,
so the usual move — record the expected output, compare — produces a suite that goes red on a
harmless rewording and green on nonsense. That is worse than no suite, because it gets switched
off after the third false alarm and then nobody checks anything.

So this is built in **two layers**, and keeping them apart is the whole design.

| | what it checks | repeatable? | costs |
|---|---|---|---|
| **Layer 1 — unit** | the deterministic parts: the stuck regex, `phrase-recall`, `pickScenario` | exactly | nothing |
| **Layer 2 — persona runs** | the shape of what the coach does, across personas | as a rate | model calls + real database rows |

Layer 1 is a real test: same input, same answer, forever. Layer 2 is not a test and should never be
described as one. It is a measurement.

---

## 1. Where reproducibility actually comes from

Not from the learner saying identical words. From three other things:

1. **The persona is fixed**, including a fixed opening sentence. Every run of a persona starts
   from the same first answer, so anything that differs later is the app's doing.
2. **The checks are about shape, never wording.** *After somebody said they do not know how to say
   it, did Spanish arrive, or did another question?* That survives any paraphrase the coach
   invents.
3. **One run is an anecdote; the same check across twelve is a rate.** The number to compare after
   a change is the rate, and a rate that moves is a real signal in a way a single red run is not.

---

## 2. The personas

Four, along **two independent axes**.

- **level** — what they can produce (`a1`, `a2`, `b1`)
- **whenStuck** — what they do when they cannot (`admits`, `bluffs`, `quiet`, `switches`)

They have to be independent because the app fails differently along each. The bug fixed on
2026-09-10 — *"I still don't know how to say it"* answered with a new question — was invisible to
a learner who bluffs, at every level, and hit an admitter at every level. One axis would have
missed it.

### A level is not a label

Tell a model "you are A2" and it writes textbook-perfect A2, every run comes back looking like a
success, and the harness quietly stops being worth running. So a level here is a **word budget**, a
**banned-structures list**, and an **error repertoire the learner is required to draw from**. Same
lesson as the scenario turn in `/api/coach`: you do not ask a model to behave, you take away the
option.

And because that can still slip, `learnerDrifted()` checks afterwards rather than trusting: a
learner that outgrew its own level is reported as a finding **about the harness**, and it
invalidates the run's other numbers rather than sitting quietly next to them.

---

## 3. What the learner is allowed to see

The screen. Not the API response.

The learner is handed the coach's line, the English translation if the room rendered one, and the
tool card if there is one — the same things a person takes in. Handing it the JSON would let it
answer questions the UI never actually displayed, and a run that passes on invisible information
proves nothing about the app.

This is not theoretical. The first version of the scraper read the coach's line from
`.coach-line h2`, which exists on intake turns and **not** once the scene starts. From turn four
on the learner was answering blind, and it looked like a clean run. The fix is to scope to
`.room-copy h2`, which catches both shapes.

---

## 4. The invariants

Each one must hold no matter how the coach phrases itself.

**`stuck-gets-words`** — a learner who has just declared they do not know how to say it must be
handed Spanish on the next screen, not asked another question. This is the 2026-09-10 bug and the
one most likely to return, because the pressure to ask a follow-up lives in the turn's own
instruction.

**`level-respected`** — Spanish handed over has to be sayable *by this learner*. A correct sentence
four levels up is not help, it is a wall with subtitles.

Alongside them, two things that are **counted, not judged**, because the right answer is a design
decision and not a bug:

- **`helpShownDuringScene`** — how often help appears while the conversation is happening, rather
  than afterwards in the rescue.
- **`stuckTurns`** — how often each persona hit a wall at all.

---

## 5. Running it

The dev server must be up, and it talks to the **production** database — every run writes a real
row to `moments`. The anonymous save limit is keyed on `session_id` and every run gets a fresh
browser context, so runs do not eat one another's budget.

```
node run-persona.mjs marco-a2-admits <label>   # one run, prints its transcript and findings
node sweep.mjs 3 3                             # every persona, 3 runs each, 3 at a time
node stuck-unit.mjs                            # layer 1: free, instant, exact
```

Screenshots of every turn land beside each run, which is the other half of the point: the runs can
be looked at, not only asserted about.

---

## 5b. What the first sweep found (2026-09-10)

Twelve runs, four personas, three each. All twelve reached the verdict, eleven reached the closing
card, no console errors, no crashes. Then the interesting part.

**Two bugs in production code, in the detector fixed earlier the same day.** It matched only a
straight apostrophe, so nothing typed on a phone matched at all; and once widened it fired on
people merely describing their problem, which is what the opening question asks for. Both are in
the CHANGELOG.

The uncomfortable detail: **the morning's fix had been verified by a harness carrying a copy of
the same broken pattern.** Copying a regex out of a route into a test file copies its bugs too,
and a green test then means only that the two copies agree. Anything duplicated out of `app/` and
into a check here should be treated as a fixture that can rot, not as a second opinion.

**Three of the four findings the sweep reported were false positives** — the harness's own copy of
the detector over-firing on Lena's opening sentence. Worth stating plainly: on the first run, the
findings list was mostly wrong, and the value came from asking why rather than from the count.

**One measurement worth keeping.** Help appeared on screen during the conversation in **7 of 108
scene turns**; for the persona who never admits being stuck, 0 of 27. Correction is deferred
almost entirely to the rescue, which is deliberate and which the rescue does well. What the
deferral costs is open: in one run a learner said `Yo va a cuidar` nine turns running and was
corrected once, at the end.

**Two personas drifted out of level** (`sam-a1-goes-quiet` three times, `marco-a2-admits` twice),
which weakens their numbers. A1 is the hardest level to hold, because staying under six words
while still answering is exactly what a real beginner cannot do either.

---

## 6. What this cannot tell us

**Voice is never covered.** The realtime token is aborted on purpose — that is what puts the room
on the typed path. Everything measured here is the typed half of the app, and the half Timo
actually uses is the other one. Any claim about the voice experience that cites these runs is
wrong.

**A synthetic learner is not a person.** It is a model imitating a described person, and it will be
more articulate about its own confusion than a real learner having a bad evening. It is much
better than judging by our own six sessions, and much worse than watching a stranger use it.

**Nothing here measures whether anybody learned anything.** It measures what the app did in
response to what a learner said. Whether the phrase came back a week later is a question for the
recall queue and PostHog, not for this.
