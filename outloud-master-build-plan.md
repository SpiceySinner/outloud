# OutLoud — Master Build Plan

**Sources and how much each is worth:**
- **75 App Store reviews** across Pingo, Speak, italki, Praktika, and Parrot — **real users, real evidence.** Anything cited to "the review analysis" comes from here.
- **The OutLoud codebase** (`page.tsx`, `OrbCanvas.tsx`, `globals.css`) — **verifiable fact.** Anything cited to a line number is confirmed, not opinion.
- **Feedback on the current build** — observations about the shipped experience. Included here only where the code independently confirms them, so every item below is either a verified defect or grounded in real user evidence.

---

## SECTION A — KEEP. These are already right.

1. **The orb reads without explanation.** `OrbCanvas` gives each state genuinely different physics — listening funnels downward (`funnel: 0.86`), thinking spins ~4x faster (`spin: 0.46`), speaking pulses with ripple rings (`beat: true`). The review analysis lists "expose orb/agent state clearly" as a P0 because competitors fail at it.
2. **No cartoon avatar.** Praktika reviewers complain their avatars are creepy and childish, with mouths that don't match the words. An abstract orb sidesteps the uncanny valley entirely.
3. **One screen, no navigation.** Reviewers of Speak and Praktika complain about being in and out of lesson menus. OutLoud never navigates.
4. **Intelligibility over accent.** The review analysis found complaints about pronunciation scoring that "appears to use only transcription" and apps that ignore accents. OutLoud refuses to grade accent — keep that absolutely.
5. **Attempt before answer.** A top failure mode in the analysis: reading a visible answer and being treated as if it proves mastery. OutLoud makes them try first.
6. **The post-session transcript with corrected versions.** Cheap to maintain, and it's the artifact people actually study.

---

## SECTION B — FIX. Confirmed in the code. Not opinions.

7. **Pressure Mode is a dead control.** `pressureMode: false` is hardcoded at three call sites (`page.tsx` lines 666, 1170, 1890). The dial opens a sheet and changes nothing downstream. **Either wire it or hide it** — a visible control that does nothing is worse than no control.
8. **The placement is three hardcoded questions** (lines 149–159: "tell me a little about yourself," "what did you do yesterday after work?"). For a heritage speaker who understands everything, that's the kids' table. The review analysis lists **"respect prior knowledge — prevent beginner repetition"** as a P1, with reviewers complaining about beginner material that can't be skipped.
9. **English renders by default.** `characterMeaningEn` displays alongside the Spanish. If subtitles are always on they're a crutch, not a choice — and the entire product thesis is that real life doesn't hand out subtitles. **Put English behind a tap.**
10. **Two labels compete: "your turn" (line 430) and "hold the orb to speak" (line 437).** Ensure the *hold* instruction is what a first-timer sees. "Your turn" says whose turn it is, not what to do with your hands.

---

## SECTION C — FIX. What real users hate about competitors.
*(All from the 75-review analysis.)*

11. **Never praise silence.** Reviewers report praise delivered after saying nothing at all. One occurrence destroys trust in every other judgment the app makes.
12. **Refuse to score low-confidence audio.** Silence, noise, or clipped syllables should trigger "try that again," never a score. (P0.)
13. **Add "that's not what I said."** Let users repair a bad transcript without being marked wrong. (P0.)
14. **Don't let the AI dominate the talking.** Reviewers dislike tutors that ramble or hold most of the speaking time. The learner should produce more language than the coach.
15. **Separate the four judgments:** meaning, grammar, pronunciation, transcription confidence. Collapsing them is why users can't tell whether the mistake was theirs or the app's.
16. **Test real audio conditions before launch:** car mics, AirPods, background noise, Southern US accents, code-switching. This is a P0 in the analysis and it is the fastest way to lose a voice-app user.
17. **Make billing boring and obvious:** trial end date, exact amount, cancellation path. Unclear renewal is a repeated complaint across all five competitors.
18. **Give one complete win before any paywall** — enter a moment, attempt, learn a pattern, repair, transfer — *then* ask for money. (P1.)

---

## SECTION D — COPY. What fans of all five apps love.

19. Real situations tied to family, partners, travel, and work.
20. Speaking full sentences instead of selecting words.
21. Reusable chunks deployable tomorrow.
22. Gentle pressure that still feels fair.
23. Short sessions that fit a real day.
24. The ability to interrupt, ask, or slow the AI down.
25. Authentic voices and dialect.

---

## SECTION E — DIFFERENTIATE. The actual moat.

26. **Stop leading with "AI conversation practice."** The review analysis is blunt: competitors already own that claim. Lead with **"You understand Spanish. Now practice answering."**
27. **Success = unaided production.** (P0 #1.) A session isn't mastered until the learner produces it with no model, frame, transcript, or translation. Almost no competitor measures this. It is the whole product.
28. **Prove memory instead of claiming it.** (P1 #12.) The AI should naturally reference the earlier situation and visibly give less help — not announce that it's "personalized."
29. **Name who's in the room.** One sentence before a session: *"this is Carmen, your boyfriend's aunt — warm, but she talks fast and won't slow down for you."* Costs nothing, creates the exact social pressure the ICP freezes under. Praktika needs an avatar for this; OutLoud needs a line of text.
30. **Build backward from one real event.** Ask *"what's the night you're dreading?"* and generate sessions toward it. Speak's scenarios are canned (coffee, airport). Yours can be their specific Christmas Eve. **Strongest available idea** — and no curriculum-based competitor can follow.
31. **Give in-session signal, once.** Not streaks — one spoken callout when they do something they couldn't do before: *"you just handled a follow-up without stopping."* The opposite of a streak isn't silence.
32. **Don't gate memory behind an email box.** If remembering is the point, show what they'd get before asking for the address.

---

## SECTION F — HANDS-OFF MODE. The best untapped angle.

33. **Busy is the #1 reason apps die.** The analysis found reviewers across every app value short sessions that fit daily life.
34. **The ICP is most willing to speak Spanish when nobody is watching.** Alone in a car is exactly that condition.
35. **Duolingo needs eyes and thumbs. OutLoud doesn't.** *"Practice Spanish on your drive home"* is a sharper pitch than anything else currently written.
36. **It must be genuinely hands-free.** If eyes-off mode opens a menu of buttons, it isn't eyes-off. Every control becomes voice: *"say 'again' to repeat, 'slower' to slow down."*
37. **It must survive car audio.** Road noise plus a phone mic is the hardest case, and mic failure is the fastest way to lose a voice user.

---

## SECTION G — ADDITIONAL FIXES

38. **Cut the two-retry cap.** Deciding someone is done before they do is a small betrayal in an app about persistence.
39. **Progressive disclosure of tools.** Don't show "fix" and "pronounce" before the user has made a mistake or hit a pronunciation issue. Reveal each the first time it's relevant.
40. **Make the orb look unpressable when it is.** It currently does three jobs — push-to-talk button, status indicator, and the person. That's why people press it during the AI's turn. Drop the scale, kill the glow, remove the shadow when it can't be pressed. Better: name the character in text so the orb only has two jobs.

---

## SECTION H — SIMPLICITY AND THE VOICE LAYER

### 41. Make it as simple-looking as the competition — by hiding controls, not removing capability.
Speak feels simple because it shows *few controls*, not because it does less. OutLoud's session screen shows help, fix, pronounce, ask, eyes-off, speaker, and turtle simultaneously. **Session one should show the mic and one help affordance. Everything else appears the first time it's relevant.** Same power, a fraction of the noise. This single change closes most of the perceived-complexity gap.

### 42. Go full-duplex with barge-in. This is the walkie-talkie fix.
Current state is **half-duplex**: hold to speak, release, wait. That's what makes it feel like a radio instead of a conversation. **Full-duplex** = the mic stays open, voice activity detection (VAD) decides when the user starts and stops, and the user can cut the AI off mid-sentence and it stops immediately.

**Critically: OpenAI Realtime already supports VAD and interruption natively.** Push-to-talk was a design choice, not a platform limitation. This is a change in how the API is used, not a rebuild.

**Status (2026-08-29) — this item shipped split in two.**
- **Half A — the mic stays open while it is the learner’s turn.** Built and default. No tap needed to start speaking; server VAD decides when the turn ends. Not yet validated on real hardware.
- **Half B — cutting the coach off mid-sentence by talking over it.** *Not built.* Interrupting still requires tapping the orb.

Half B is the only part of full-duplex exposed to acoustic echo, and its failure mode is the coach interrupting *itself* and then blaming the learner (“nothing came through”) — worse than the tap it replaces. It is gated on section 5 of `PHASE1_MANUAL_TESTS.md` passing on a real iPhone, on speakerphone, at real volume, in a real room. When built it ships behind a flag with a self-interrupt circuit breaker. Rollback for all of Phase 1’s voice work is one value: `localStorage["outloud-mic-mode"] = "push"`.

### 43. Handle background noise deliberately — an open mic makes this a real risk.
- **Enable browser audio constraints:** `echoCancellation`, `noiseSuppression`, `autoGainControl`. Non-negotiable — without echo cancellation an open mic hears the AI's own voice through the speaker and interrupts itself.
- **Tune the VAD threshold** so a cough, a passing truck, or a third party's voice doesn't register as a turn. Require *sustained* speech before treating it as an interruption.
- **Detect trouble and adapt:** if the mic repeatedly captures nothing usable or false-triggers, offer one tap — *"noisy place? switch to hold-to-talk."* Don't make the user diagnose it.
- **Prompt for headphones in eyes-off/driving mode.** AirPods solve echo and noise simultaneously.
- **Low audio confidence → "try that again."** Never score garbage input (ties to #12).

### 44. "Acts like a coach who knows you" is a prompt problem, not a voice problem.
A model can sound perfectly natural and still feel like a stranger. Currently the AI responds in the same pleasant register whether the user nailed it or butchered it. Fix in the system prompt:
- **React to what actually happened.** Warmer when they nail it, pressing when they dodge, genuine surprise when they beat something they used to fail.
- **Reference their history out loud, unprompted** — this surfaces the memory moat inside the conversation instead of burying it in a card (ties to #28 and #31).
- **Vary pacing and energy by context and character** rather than delivering every line at identical energy.
- **Let the learner talk more than the coach** (ties to #14).

---

## SECTION I — THE STATED PROBLEM MUST VISIBLY DRIVE THE TEACHING
*(The highest-priority gap in the current build.)*

**The problem:** the app asks what trips the user up. They say "vocabulary." Then the conversation proceeds and nothing visibly happens about vocabulary. From the feedback: *"I said I had a problem with vocabulary and we just kept talking in Spanish — nothing telling me 'hey let's work on your vocabulary.'"* The user's internal reaction is fatal: **"what was the point of telling it my problem?"**

That single moment breaks the core promise. Personalization the user can't *see* doesn't exist to them. Fixes:

45. **Acknowledge it out loud, immediately.** The moment they name their blocker, the coach responds to it by name — *"okay, vocabulary. the words going missing. let's see if that's really what's happening."* Costs one line. Closes the loop instantly.
46. **The verdict must explicitly address what they said.** Evidence-driven, three possible outcomes:
    - **Confirm** when the evidence agrees: *"you called it — the words are the thing. that's where we start."*
    - **Correct** only when the evidence clearly contradicts: *"you said vocabulary, but your words are fine. it's the order they come out in."*
    - **Both**, which is often the honest answer: *"you're right that words go missing — and when they all showed up, the order still scrambled. we'll work both."*
    **Never manufacture a contradiction to look clever.** A wrong "actually it's X" destroys trust at the exact moment trust is being built.
47. **Name the focus at the top of every session.** A quiet goal line — *"today: the words that go missing"* — set by the plan, never configured by the user. They should be able to glance at any session and see it's about their thing.
48. **Match the form of help to the diagnosed gap.** Same correction moment, different medicine:
    - *vocabulary* → the missing word plus one natural alternative, and a lifeline that's easy to reach
    - *sentence structure* → the reusable pattern, not just the fixed sentence
    - *pronunciation* → syllable-by-syllable slow playback
    - *freezing/retrieval* → more wait time before the nudge, shorter prompts, prep time
    The user should feel the app teaching *their* thing, not running a generic loop.
49. **Call it out when they beat it, in the moment.** *"that's the second time tonight you found the word without me."* One line, spoken, unprompted. This is the payoff for having told the app anything (ties to #31).
50. **The profile must show that specific dimension moving.** If they said vocabulary, "finding words" must be visible in the profile with real evidence and a visible trajectory. If the thing they told you about isn't tracked and shown, the conversation that collected it was theater.

---

## SECTION J — THE SPEAKING JOURNEY

**Purpose:** answer "where am I going?" without a curriculum. Testers consistently feel directionless without one, and the honest answer to "where are the lessons?" is a visible path made of *capabilities*, not topics.

51. **The path is real conversations you can survive, not lessons.** In order:
    introduce yourself → ask simple questions → tell short stories → handle follow-up questions → speak under pressure → hold a ten-minute conversation → tell a detailed story → understand slang → argue your opinion naturally.
52. **Vertical path, not a progress bar.**
    - **Behind you:** filled in the success color, with the date you crossed it
    - **Where you are:** the accent color, with the specific current work — *"handling follow-ups: you froze on two this week"*
    - **Ahead:** muted, visible but not clickable
    Tapping any stage explains what it means. **It never launches a lesson.**
53. **Position derives from the ledger, never from a self-report or a level.** It moves because weaknesses got beaten, which means it can't be gamed and it can't lie.
54. **It lives in the profile card, not in the room.** The room stays one stage. The value of the journey is that you can see it's *long* — which reframes a bad session as one step on a real path instead of failure.

---

## SELF-AUDIT

**What's solid:**
- Every item in Sections A–D traces to either a code line or the 75 real reviews. Nothing in those sections is invented.
- Section B is the highest-confidence work in this document — verified defects, not preferences.
- Section I is the highest-*value* work. It's a systemic gap, not a bug: the app collects a self-report and then doesn't visibly use it. Every item in it is cheap (mostly copy and prompt work) and it directly protects the core promise.

**Where I'm less certain, stated plainly:**
- **Items 29 and 30 (name the character, build backward from a real event) are my judgment, not user data.** Extrapolated from the ICP research, not requested by anyone. Strong reasoning, unproven demand.
- **Item 30 is the biggest untested bet in this document** — and simultaneously the most differentiated idea available. Treat it as a hypothesis to test, not a certainty.
- **Section F (hands-off) rests on inference.** Reviews confirm people value short sessions that fit daily life; they do *not* say "I want to practice in the car." The car use case is reasoning, not evidence.
- **Item 42's difficulty is unverified.** Realtime supports VAD and barge-in, but iOS Safari behavior with an open mic hasn't been tested on a real device. Budget for it being harder than it reads.
- **Section J assumes the journey reduces the directionless feeling.** Reasonable, unproven.

**What this document does NOT establish:**
- That anyone wants OutLoud. Zero strangers have used it. Every item here improves a product whose demand is still unproven.
- That these fixes change retention. They're grounded in why users abandon *competitors* — a strong proxy, not proof.

**Sequencing risk:** items 41–44 change the core interaction model. If implemented after visual polish, the polish gets redone. **Interaction changes first.**

---

## THE BUILD ORDER

### Phase 0 — Trust (nothing else matters if these are broken)
- **#7** Wire or hide Pressure Mode
- **#12** Refuse to score low-confidence audio
- **#11** Never praise silence
- **#13** "That's not what I said" transcript repair
- **#15** Separate the four judgments
- **#10** Fix the hold-to-speak label

### Phase 1 — The interaction model (before any visual polish)
- **#42** Full-duplex with barge-in *(split: Half A shipped, Half B deferred — see #42 above)*
- **#43** Noise handling, echo cancellation, adaptive fallback
- **#41** Progressive disclosure of controls
- **#39** Reveal tools only when relevant
- **#40** Orb looks unpressable when it is
- **#9** English behind a tap

### Phase 2 — The stated problem drives everything *(highest value)*
- **#45** Acknowledge the blocker out loud — *was already in the framing-turn prompt; now backed by a real classification*
- **#46** Verdict addresses it: confirm / correct / both — **shipped 2026-08-29**
- **#47** Session goal line naming their focus — **shipped 2026-08-29**
- **#48** Help form matches the diagnosed gap — **shipped 2026-08-29**
- **#49** In-the-moment callout when they beat it — **shipped 2026-08-29**
- **#50** Profile shows that dimension moving — **shipped 2026-08-29**

**The upstream bug this phase actually fixed.** All six items read one value,
`selfReportedBlocker`, and it was produced by a client-side regex with two possible outcomes
(`missing_words` or `not_sure`). Six of the eight blockers in the taxonomy were unreachable, so
most learners were filed as `not_sure`, which maps to `insufficient_evidence` and therefore to
the generic teaching policy. The complaint this whole section is built on — *"what was the point
of telling it my problem?"* — had a mechanical cause: for most people the problem was never
recorded. The coach now classifies the opening answer on the framing turn (pinned there
structurally, so no later turn can overwrite it).

**Four dead or false things this phase turned real.** `chooseTeachingPolicy` in
`lib/teaching-policy.ts` already mapped every blocker to its own assistance order and was imported
by nothing; the ladder now reads it, and the snapshot it produces is stored instead of the
hardcoded `teachingPolicy: null`. `assistanceUsed` was hardcoded `"none"` on every session turn, so
every stored intervention outcome claimed the learner needed no help — which both poisoned the
teaching model and made an honest #49 impossible until it was fixed. And the whole "what OutLoud
knows about you" surface, where #50 lives, was **unreachable**: it and the evidence card opened
only each other, with no entry point from anywhere in the app. The end-of-session card is now its
door.

See `PHASE2_MANUAL_TESTS.md`.

### Phase 3 — The coach
- **#44** System prompt: react, reference history, vary energy — **reframed and shipped 2026-08-29**, see below
- **#14** Learner talks more than the coach — **shipped 2026-08-29**
- **#29** Name who's in the room — **shipped 2026-08-29**
- **#8** Adaptive placement (kill the three hardcoded questions) — *was already built*
- **#38** Remove the two-retry cap — **shipped 2026-08-29**

**#44 was not a prompt problem.** The feedback behind it — someone came back and the app did not
know them — had a mechanical cause: every run **is** saved, with the learner's email and
`user_id: null`, but reading any of it back goes through `getAuthedUser`. Without an account the
practice sits in the database unreachable, and OutLoud greets a returning learner as a stranger.
The after-card made it worse by asking *"want me to bring this back tomorrow?"* next to an email
box, which buys a private link to one session and nothing else. No amount of "reference their
history out loud" in a system prompt fixes that. The cards now say what an account does, why the
line is drawn at a login rather than a typed-in address, and that signing up on the same email
claims what was already saved — which `/api/library` really does.

**The in-session half of #44 shipped too.** `/api/converse` now receives the settled evaluations of
earlier turns (safe to speak about as fact) and measurements of how the current reply came out —
pause before speaking, hesitations, English leakage, what the learner reached for. The split is
load-bearing: the current reply's evaluation is still in flight when the coach line is generated,
so the character may react to *delivery* but is explicitly forbidden from asserting the Spanish was
correct. Neither costs latency; both were already in hand.

**The repair loop is on.** The route had a complete `repairSystemPrompt` and turn-index pinning so a
misunderstanding does not consume the session budget, but the client sent `repairRequested: false`
unconditionally and the `lib/repair-loop.ts` both it and `lib/types.ts` named as the decision's
source did not exist. It does now, and the character admits when it did not catch something.

Two things the wiring had to get right. `insufficient_evidence` — not just `unclear` — is what an
evaluator returns for a reply with nothing judgeable in it, so the first version never fired at
all. And a low-confidence transcript must NOT trigger a repair: the evaluator is instructed to
answer `insufficient_evidence` exactly when the capture is suspect, so repairing on it would hand
the learner the blame for our microphone.

**Measured cost:** the evaluation now has to finish before the coach line is generated, where the
two ran in parallel. Over four session turns each: **6.1s → 8.2s per turn, about a third slower**.
The endpoints are unchanged; the wait is the lost overlap. Reversing it is one small change.

See `PHASE3_MANUAL_TESTS.md`.

### Phase 4 — The moat, made visible
- **#27** Unaided production as the success definition
- **#28** Prove memory in-conversation
- **#32** Stop gating memory behind the email box
- **#51–54** The Speaking Journey
- **#30** Build backward from one real dreaded event *(highest-upside bet)*

### Phase 5 — Hands-off
- **#36** True voice-only control
- **#37** Car-audio survival
- **#16** Real audio-condition testing (car, AirPods, noise, accents, code-switching)

### Phase 6 — Money and launch
- **#17** Boring, obvious billing
- **#18** One complete win before any paywall
- **#26** Reposition: "You understand Spanish. Now practice answering."

---

## THE ONE THING THIS PLAN CANNOT DO

Every item above makes the product better for users who don't exist yet. The plan is well-grounded, and it is not the bottleneck.

**Ship Phases 0–2, then put the link in front of strangers.** Phases 3–6 should be prioritized by what real users actually complain about, not by this document.
