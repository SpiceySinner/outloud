# Changelog

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
