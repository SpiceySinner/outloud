# Changelog

## 2026-09-14 — a fresh clone can now be started by somebody who was not here

The repo had no README, no `.env.example` and no setup of any kind. `.env` is gitignored, so a new
person could clone this and had **no way to learn that 29 environment variables exist**, let alone
which four have to be real before anything runs. The rules and the task split were written and the
thing still could not be started.

- **`.env.example`**, generated from the real `.env`: every name, every comment that explains why a
  value is what it is, and **no values**. `.gitignore`'s `.env*` line would have swallowed it, so
  `!.env.example` sits underneath with the reason written next to it.
- **`README.md`** — install, the four variables that are not optional, the commands, and where to
  read next. Plus the two things nobody should discover by accident: the dev server writes to the
  production database, and `.env` is the only place a credential lives.
- **`docs/Tests/TEST_RUN.md` is linked from somewhere people look**, which it never was. It belongs
  next to rule 6: voice has no automated cover and cannot get any, so the manual run is not extra
  credit, it is the only coverage half this app has.

### The command in the README was broken when I wrote it down

`npm run lint` reported **6748 errors, none of them ours** — all from `.vercel/output`, a known
TODO item that had been sitting there as noise nobody looked at. It stops being noise the moment a
README tells a newcomer to run it: a fresh clone would have opened with seven thousand errors and
no way to tell they were pre-existing.

`.vercel`, `.output` and the vinext-generated `types/routes.d.ts` are ignored now. `npm run lint`
exits 0 and means something again.

### One Supabase, shared

Timo's call: the second seat uses the same production database, not a second project. So
`docs/TASKS.md` gained four non-negotiable rules for working in there, and the two tasks that touch
rows were rewritten around it. The retention job in particular now ships in two halves — a dry run
that only reports what it *would* remove, and, after Timo has read that list, the half that
actually removes. It is the one task on the list that can destroy data, and there is no local
database to make a mistake in.

## 2026-09-14 — the checks get a home, and a way to prove themselves

Every check that has ever found something here lived in a scratchpad that is wiped between
sessions. Twice this week the whole thing had to be rebuilt to answer one question. And a second
person is about to start work on this repo with their own agent, which turns "the checks are
somewhere else" from an annoyance into the thing that decides whether their changes are safe.

`checks/` now holds them. **No new dependency:** node 22 strips TypeScript itself, so the runner is
70 lines and the only thing missing was the `@/` alias, which is a 20-line resolve hook.

```
npm test          unit + structure - no server, no model, no credits, about a second
npm run test:live prompt behaviour against the real model
```

### What moved in

| | cases | |
|---|---|---|
| `unit/scene-turn` | 39 | English mid-scene reaches the coach; Spanish, however broken, stays an attempt |
| `unit/stuck-signal` | 65 | reaching for words vs describing your problem, and what `strippedAsk` leaves behind |
| `unit/voice-guards` | 47 | filler is not an answer; `saidInEnglish` without a word list |
| `unit/phrase-recall` | 11 | every saved phrase is scheduled, `asked` still sorts first |
| `unit/voice-dump` | 5 | the session's own trace reaches `__outloudVoiceDump()` |
| `structure/dead-exports` | ratchet | 91 exports nothing imports. It may go down; it may not go up. |
| `live/aside-answers` | 8 | four turns against the real model: does the coach answer, or interview you |

Each imports the real module rather than restating it. That is the whole point: two checks in this
repo have reported green while broken because they carried a copy of the pattern they were
checking, and the copy was wrong in exactly the same way.

### The part that is new rather than moved

`baselineComparison()` runs the same probe against your working tree **and** against git, and says
whether it can tell them apart.

A green run proves your change works, or proves your check cannot fail. Those are indistinguishable
in a log, and this repo has shipped the second one twice. So the rule is now a function rather than
a note in a document:

| | what it says |
|---|---|
| file unchanged from the ref | "nothing for this check to prove today" |
| file changed, probe differs | the green run above means something |
| file changed, probe identical | **fails** — your check is not measuring your change |

Proven on the voice-session change: against `HEAD` (which now contains it) 4 lines both ways and
nothing to prove; against `9a784eb` 4 lines against 0, so the check can tell them apart.

It found a real fault in its own first probe within a minute. `setTranscriptionLanguage` returns
early when nothing changed, so the probe silently recorded zero lines whenever anything earlier in
the process had already left the singleton in Spanish — a probe that passes by not running. Pinned
to `en` first.

### Refusing to be reassuring

- **`realModelRequired(t)`** reads `OUTLOUD_MOCK_AI` from `.env` and stops a live check rather than
  letting it go green against fixtures. `OUTLOUD_MOCK_AI=true` short-circuits the model completely,
  so a prompt check against it is reading a canned string.
- **A missing dev server is a SKIP**, never a pass.
- **There is no voice group and there cannot be.** Headless has no microphone. `checks/README.md`
  says so in as many words, because the failure mode is an agent reporting "voice tested".

### The harness itself was proved the same way

A deliberately failing check was added, run, and removed: `FAIL unit/zz-proof 0/1`, exit code 1;
exit code 0 once removed. A runner nobody has watched fail is not a runner.

### AGENTS.md

The repo had no guidance file of any kind — no `AGENTS.md`, no `CLAUDE.md`, no README. A fresh
agent started from nothing and rediscovered the same six lessons by causing them again. It now
carries: fix the scenario not the sentence; deterministic code owns facts and the model owns
meaning; a check carrying its own copy proves nothing; prove it against unchanged code; a mock run
of a prompt fault proves nothing; nothing automated ever covers voice. Plus the four that are
dangerous rather than merely expensive — production Supabase behind the dev server, the realtime
model as a voice bridge only, no free text to PostHog, no credential in a migration.

## 2026-09-14 — the trace can finally say which language it was listening in

Timo's first full voice run came back with one Spanish turn transcribed as **German** — *"äh C und
äh bei Stack auch so, bitte."* for *Sí, un bistec también, por favor*. The transcriber is pinned to
`en` or `es` and never `de`, so for that turn the hint either never landed or was ignored. Which of
the two, the log he sent could not say — and it is the question the 2026-09-14 language fix was
shipped without an answer to.

**Two loggers, one buffer, and only one of them was in it.** The room's `vlog` writes to the console
*and* to `window.__outloudVoiceLog`, which is what `__outloudVoiceDump()` prints. `VoiceSession`'s
own `log()` wrote to the console only. So a trace pasted back after a session went wrong showed the
microphone opening and closing and nothing about the connection underneath it: not the language
switches, not a dropped `session.update`, not a data channel that failed to open. Every one of those
looks identical from the outside — "the mic does nothing" — which is the reason this file logs at
all.

`log()` now pushes the same line into the same array, with the same timestamp format, so both
sources interleave in the order they happened. It sits behind the existing `if (!this.debug) return`
and formats values the way `vlog` does, since a joined string cannot render an object the way
`console.log` can. **With tracing off, nothing in this runs.**

### Verified

`dump-buffer-check.mjs` bundles `lib/voice-session.ts` with esbuild and drives the real singleton
through a real public method. Run against **both** versions, because a check that only passes is not
a check:

| | buffer lines | console lines | language switch recorded |
|---|---|---|---|
| `HEAD` | **0** | 4 | no |
| now | **4** | 4 | yes |

Same console output on both sides — nothing moved out of the console, the buffer gained a copy.
Every buffered line carries the room's `HH:MM:SS.mmm` prefix.

**Known limit:** `__outloudVoiceDump()` is defined by the room. Opening `/dash` directly in a fresh
tab gives you the buffer but no way to print it; coming from `/` in the same tab has both.

## 2026-09-14 — the scenario you name is the scenario you get

Timo's rule, and it is the whole fix: *wenn ich sage, welches Szenario ich möchte, dann nehmen wir
das, egal ob es vorgeschlagen war.* He was offered a cafe and a friend, said he wanted a restaurant,
and the session put him in the cafe.

**Why it ignored him.** `pickScenario` tried to MAP his answer onto one of the two offered
directions by counting the words longer than three characters it shared with each. An option's own
text carries words like *want*, *order*, *about*, *talk* — so a sentence containing any one of them
scored above zero. Below that sat an escape hatch for answers matching neither option, and it only
opened at six words or more. "in a restaurant" is three words and a completely different place, so
it never opened, and the fallback was option A.

The same shape as the two before it this week: a word list standing in for a judgment. So the
matching is gone. What is left is the part that is genuinely closed and cannot grow:

| they said | it resolves to |
|---|---|
| an ordinal — "the first one", "die zweite" | that option |
| bare agreement — "yes", "egal", "you choose" | option A, their own context |
| anything else | **their words, exactly as they said them** |

The model still gets the raw answer and both options, so a pointer this cannot read — "the cafe
one" — is resolved where that judgment belongs. The scenario prompt now says the rest out loud:
what they said outranks anything you put in front of them, and never steer them back to an option
they turned down.

### Verified against the real model, end to end

`my-scenario-wins.mjs` walks the room on the dev server, answers the opening question, waits for
the framing turn to offer two directions, and then names a third.

| | |
|---|---|
| offered | "Explaining your day to a friend" · "Returning something to a shop" |
| he said | "I want to do it in a restaurant" |
| the scene it built | *"This is Luis, the restaurant manager — he's busy and a bit impatient. Show me what you would say to return a dish and explain what's wrong, in Spanish."* |

His place won. Worth noticing, and left alone: it kept the TASK from the option it had offered —
returning something — and moved it into his restaurant. He named a place and no task, so something
had to fill that in, and reusing the one already on the table is a defensible way to do it. If it
should instead ask what he wants to do there, that is a separate call.

`scenario-pick-check.mjs` covers the resolver over fourteen realistic answers, including four in
German. It reads the real function out of the route and refuses to run if it no longer looks like
what it mirrors — a check that quietly drifts from its subject has reported green here twice.

## 2026-09-14 — the first Spanish of the session was transcribed as English

Timo, from a real voice session: *"warum macht das direkt englisch, ich hab spanisch gesprochen"*.

`expectsEnglishAnswerNow()` was answering two different questions with one boolean, and the
scenario turn is where they come apart.

The coach speaks that turn in English — it names the person, sets the scene. Its own instruction
ends: *"Then invite them: show me what you would say -- in Spanish, however it comes out"*, and
spells it out, *the learner speaks Spanish next, you do not.* So the answer to it is the learner's
**first Spanish of the whole session**, and the transcriber was pinned to English for exactly that
turn. Spanish audio, decoded into English words.

| | what language will they answer in? | is English a known, handled reply? |
|---|---|---|
| opening | English | yes |
| coach framing | English | yes |
| **coach scenario** | **Spanish** | **yes** |
| scene turn | Spanish | no |

One function, two questions, and the wrong answer won. `transcriptionLanguageNow()` now answers
the first; `expectsEnglishAnswerNow` keeps the second and keeps the scenario turn, because
`/api/coach` has a branch for somebody who says in English that they cannot say it, and stepping
out to the aside there would replace working help with a detour.

**Not verified end to end, and it cannot be here.** This only bites on real audio, and the harness
aborts the realtime token — the automated path has never connected a microphone and never will. The
reasoning is on the page above; the proof is a voice session on `/dash`.

His log stops one turn short of the moment, which fits: the last transcript in it is "Ordering
something", an answer to the framing turn's *"ordering at a cafe, or telling a friend about your
weekend?"* The scenario turn is the next one.

### Also in that log, and it matters more

Every line he pasted carried **`posthog-recorder.js`** as its source. The replay recorder patches
`console`, and the voice trace prints the learner's transcript verbatim:

```
transcript: "I would say it's the vocabulary."
```

The replay masking covers rendered DOM text and typed input. `maskTextFn` never sees a console
call. So with console capture on, free text walks out to PostHog through the one door the masking
does not cover — against the rule this app has had since the tracking went in.

It is off by default in posthog-js. It is also a **project setting**, switchable from the PostHog
UI by anybody, at which point the app would start leaking with no deploy. `enable_recording_console_log: false`
is now stated in `initTracking`, so it cannot be. Confirmed in the built bundle. The existing mask
check still reports nothing readable.

## 2026-09-14 — the offer stopped being a lens

Timo sent four turns of a real conversation. The coach had taught him *quisiera un bistec, por
favor*:

| | |
|---|---|
| **you** | Ah, quisiera un bistec, por favor. Is that correct? |
| **coach** | You want to focus on vocabulary, especially words for food and ordering. What part of ordering food feels hardest to you? |
| **you** | Wait, wait, wait, before we talk about that, what does Casiera actually mean? |
| **coach** | Casiera means cashier... You want to know vocabulary meanings like that. Let's focus on vocabulary retrieval. |
| **you** | No, I mean quisiera. |
| **coach** | You want to focus on the word "quisiera." Is that right? |

Three restatements of a focus he never asked about, a confident meaning invented for a word the
microphone mis-heard, and the word he actually asked about never explained. *"desto länger ich mit
dem Coach rede, desto komischer wird es"* — and the longer it ran, the truer that got.

### Three causes, and the first one was mine, from this morning

**The pending offer was written as an early return.** It replaced the turn guidance entirely, so
once an offer was on screen every message was read as an answer to it. A question became a thing to
restate as a focus. That is where "you want to focus on the word quisiera, is that right?" comes
from: the instruction said that when you cannot tell whether they accepted, ask one yes-or-no
question about the offer. It is a prefix now, and it defers — **their question outranks our offer**,
answered without the offer being mentioned at all. The acceptance half stays.

**The mission statement was the diagnostic one for both asides.** *"Find out what is actually in
their way"* is right for somebody who walked out without saying why. Pointed at somebody asking what
a word means, it is a standing order to find a difficulty in the question.

**The offer menu was the diagnostic ladder for both asides.** Name a different situation, name a
different difficulty, otherwise resume — handed to a coach whose learner asked about one word. A
word-asking aside now has exactly one offer: go back and use it. No focus change, no scene change,
no starting over.

Plus the mis-hearing: if they ask about a word that appears in nothing either of you said, the
microphone mis-heard a word you did say. Answer about the real one; never invent a meaning for a
word that was never in the conversation.

### The same four turns, replayed against the real route

| | |
|---|---|
| Ah, quisiera un bistec, por favor. Is that correct? | Yes, your sentence works perfectly. "Quisiera" is a polite way to say "I would like." |
| ...what does Casiera actually mean? | Casiera is not a Spanish word here. The microphone heard "casiera" but the right word is "quisiera," which means "I would like." |
| No, I mean quisiera. | "Quisiera" means "I would like." It is polite and common for ordering food. |
| Yes, what does that word mean? | "Quisiera" means "I would like." |

Four turns, no diagnosis, and it names the mis-hearing itself. `aside-timo-transcript.mjs` keeps his
lines verbatim and fails on the shape rather than the wording. Voice acceptance, the four-turn
drive and the diagnostic aside all still pass — that last one matters most here, because three of
these four changes narrow what the coach may do and the aside for somebody who walked out without
saying why has to keep every bit of it.

## 2026-09-14 — saying yes is how you take an offer

Timo, and he named why it matters: *viele User haben Wert darauf gelegt, das via Stimme zu
bestätigen.* The coach offered to change the focus. He said **"Yeah, I would like that."** It
offered the same thing again, with a fresh button.

Taking an offer had exactly one way in, and it was a tap. The room's own comment said so:

> *They kept talking instead of taking the offer, so the offer is no longer the live question.*

Talking instead of tapping is not declining. It is how a person says yes to a voice interface. The
offer was cleared before the sentence was sent, so the yes arrived as a fresh remark with nothing
to attach to, and the coach did the only thing left: offer again.

### What changed

- The offer stays on screen until we know what they said about it, and goes to `/api/aside` as
  `pendingOffer` — its kind and its label, nothing more. Sending the whole offer back would give
  the model a second chance to change its mind about something already in front of somebody.
- `acceptsPendingOffer` on the response. **The model judges it**, deliberately: whether a sentence
  accepts an offer is a judgment about meaning, in whatever language it was said in. Timo answers
  in German as often as English, and a list of yes-words is the shape of fix that has already
  failed twice in this repo this week.
- An offer on screen outranks the turn index, in the real guidance and in the mock both. Accepted:
  confirm in one line, `done=true`, and never re-offer. Declined or changed the subject: carry on
  with what they actually said. Genuinely unclear: one yes-or-no question about that offer alone.
- `acceptAsideOffer(taken?)` takes the offer as an argument, so the spoken route hands over the one
  it asked about. **One path, two ways into it** — a spoken yes does exactly what the button does.

### Two more the full drive caught

Neither was visible in a single turn, which is the argument for driving the whole thing.

**The closing line came out in Spanish** — *"vamos a volver y usar quiero un agua para pedir."* The
teaching voice says Spanish is the point, and the model applied it to a sentence about going back.
Now: the only Spanish is the line they need and the word being explained; everything said *about*
it is English, because a Spanish closing line is one more exercise on the way out.

**It taught one more thing after "got it, thanks."** The closing turn is now one short English
sentence about going back and nothing else.

### Verified

Against the real model, because the mock cannot test a prompt:

| said to a pending offer | accepted |
|---|---|
| "Yeah, I would like that." | yes |
| "ja, gerne" | yes |
| "yes please" | yes |
| "no, that's not it" | no |
| "hmm, what does pedir mean?" | no — and it answered the question |

And in a browser against the mock build, which is the half the model cannot prove:
`say-yes-to-the-offer.mjs` walks the funnel into a scene, steps out by asking in English, talks
until the coach lands an offer, then **types "yes please" instead of pressing it** — the aside
closes and the scene is back. Three further full drives end in one English line and the button.

## 2026-09-14 — the coach answers the question

Timo, on the aside this time. The coach gave him *agua, por favor*. He asked whether *sí, un agua,
por favor* also worked. It replied:

> *You seem unsure about adding words like "sí" or "un" in your sentence. Is it the grammar or the
> vocabulary that feels tricky to you?*

A question about a sentence, answered with a question about the person who asked it.

### It was not the model wandering off

`/api/aside` is two jobs in one engine, and only one of them had a voice.

| trigger | why they are here | what the coach should do |
|---|---|---|
| `learner`, `offered` | walked out, reason unknown | find out what is in the way, offer a change |
| `stuck` | asked for words | give the words, then answer what they ask about them |

The prompt was written for the first. **"ENGLISH ONLY. Not one Spanish word, not even a quoted
phrase"**, and under what-you-must-not-do, *"do not translate anything, do not give them a Spanish
word or pattern"*. `stuck` was added later as a single-turn exception: turn 0 teaches. Turn 1 fell
straight back into the interview script — *"ask ONE question that narrows it"* — an instrument
built to narrow a complaint, pointed at somebody who had just asked about a sentence.

So every follow-up question in a word-asking aside was going to land that way. The reply Timo got
was the prompt working exactly as written.

### The trigger now rewrites the whole aside, not its opening line

- `asideVoice(trigger)` replaces the "how you talk" block. Under `stuck`: teaching, Spanish is the
  point, **answering comes first**, and never answer a question about the language with a question
  about them — not how they feel, not whether it is the grammar or the vocabulary. Being told what
  your question reveals about you is what they stepped out of the scene to escape.
- `asideMustNot(trigger)` replaces the line that flatly contradicted a `stuck` aside. The `stuck`
  version guards the other failure: do not turn a quick answer into a lesson.
- A turn-guidance branch for every `stuck` turn after the first. If they asked whether their own
  version works, say yes or no first, then why — and if it works, let them keep theirs, because
  theirs is the one they will remember. Keep answering while they are still asking; offer to go
  back once nothing is left hanging.
- Both non-`stuck` triggers keep the diagnostic prompt word for word, plus one new line: answer a
  direct question before asking one of your own.

### Two more, found by driving the whole aside instead of one turn

Timo asked for a second scenario the same evening: *ask how to order a water, then ask what agua
means.* His exact exchange already answered correctly by then — *"Puedo means I can or may"* — so
the screenshot he sent was almost certainly produced by the prompt as it stood before this change.
Driving four turns end to end found two faults that a single turn could not.

**The English said twice.** *"agua means water. agua means water."* The teaching voice says put the
English under the Spanish line, and the model obeyed it for an answer that was already English.
It now says that rule applies to a Spanish line, and that a word's meaning is said once.

**An aside that would not end.** After *"got it, thanks"* the coach repeated its opening line and
`done` stayed false, so the detour ran on toward its turn budget. The rule was there —  offer to go
back once nothing is left hanging — and it was too quiet to beat four turns of answering. Now: the
moment they signal they have it, or say anything that is not a question, offer resume THAT turn. An
aside that will not end is the scene they walked out of, wearing a different hat.

Driven again afterwards, all four turns: the line with its English, *agua means water* once, *por
favor means please* once, *"yes, quiero un agua works"* with the reason, and then a close with the
**go back to the cafe** button.

### Verified against the real model, because a mock would prove nothing

This is a prompt fault, and `OUTLOUD_MOCK_AI` short-circuits the model entirely — a green mock run
here would have been worthless. Two live calls against the dev server; the route is stateless and
writes nothing.

Timo's exact exchange, replayed: **"Yes, you can say 'Sí, un agua, por favor.' It means 'Yes, a
water, please.' It works well and sounds polite."** Twice, consistently.

And the half that could have been broken by this: a `learner` aside still opens *"You stepped out.
What's on your mind right now?"* — a question, no Spanish, no teaching.

## 2026-09-14 — coach or roleplay, decided by the language

Timo, on the third go at this: *"wir optimieren hier nicht fuer einzelne Saetze, wir optimieren
fuer das Szenario."* He is right, and the two fixes before this one were the wrong shape.

Both widened a regex over English asking phrases. Both passed their checks. And a live session
still produced *"here's what I heard. fix anything that's wrong, then send."* — this time for
**"How do I order a water?"**, where the only thing wrong was that the verb was `order` and the
pattern listed four: say, ask, tell, put. Every other thing a learner does in a scene — order, pay,
book, greet, apologise, complain, explain, invite — fell straight through.

A list of phrasings has no end. Each widening fixed the sentences in front of it and left the next
ones to be found by a person, in a real session, being told their pronunciation was the problem.

### The decision moved

A turn in a Spanish scene has two cases and no tail:

| | |
|---|---|
| Spanish, however broken | an attempt at the scene. Judge it. |
| English, whatever it says | not an attempt. The learner is talking **to** us. |

`looksBrokenAttempt` reads the words "the", "you", "do", "is" and "know" as evidence that English
leaked into a Spanish attempt. That is right for a half-Spanish sentence and exactly backwards for
a whole English one, where those words are simply what English is made of — so it claimed to have
misheard every sentence it had heard perfectly.

`saidInEnglish` answers the question the scenario actually asks: is there any Spanish in this at
all? Deterministic, function words only, because content words are endless and a beginner's
vocabulary is tiny — what nobody produces by accident is the grammar around them. An accent or an ñ
counts double. Two English markers are needed, so a stray "okay" is not a sentence addressed to us.
Words that are both — "me", "no", "a", "son" — are evidence of neither and belong to no list.

`needsWordsEn` stays, and still runs first. It tells the coach route that words were *asked for*
rather than merely that English was spoken, and it catches an ask wrapped around Spanish — *"I want
to say quiero un agua"* — which the language gate correctly refuses to call English.

### A change in the intake, found by accident and worth a decision

The harness walked itself into the aside before it ever reached a scene. It was answering the
coach's Spanish turns with an English problem description, and that now steps out immediately —
where it used to count toward `noteIntakeAsideSignal`'s two-strike nudge.

That follows from the rule and is arguably what the rule is for. It also bypasses a deliberate
design, and 1.3a already carries the open question of whether stepping out stalls the conversation.
Flagged rather than tuned.

### Verification

**End to end, in a browser, for the first time on this fault.** `asks-reach-the-coach.mjs` walks
the funnel through the intake and the verdict into a real Spanish scene turn, types Timo's exact
sentence, and asserts the aside opened rather than the confirm box. It passes.

Typed rather than spoken, and here that is not a compromise: `submitAttempt` runs the same
`englishTurnShouldStepOut` the captured-transcript path runs, deliberately, so the help you get
does not depend on which input you used. What typing cannot reach is the confirm box itself.

`scene-turn-check.mjs` mirrors the room's decision at the unit level over 25 English utterances —
asking, choosing, complaining, apologising, stalling — and 14 Spanish ones including broken and
mixed. 39 of 39. The false-positive set in `stuck-unit.mjs` still passes: 27 caught, 20 ignored.

## 2026-09-12 — asking for words, in the shapes people actually use

Timo, mid-funnel, by voice: ask something in English and the confirm box comes back. *"Here's what
I heard. fix anything that's wrong, then send."* The transcription was perfect. He had asked a
question.

This detector was widened once before, on 2026-09-11, after a real session produced exactly this.
That fix was right and too narrow: it taught the app the ASKING shape but only the phrasings that
happened to be in front of it.

**Why a miss is expensive, and it is not this detector's doing alone.** The confirm box appears
when `needsWordsEn` says no and `looksBrokenAttempt` says yes. The second one reads "the", "you",
"do", "is", "know" and "want" as evidence that English leaked into a Spanish attempt — so it says
yes to very nearly every English sentence. The two together mean a phrasing the detector misses is
not merely un-helped. It is told its pronunciation was the problem.

**Measured rather than guessed.** Twenty-three ways a half-fluent learner asks for a word, written
down before running anything, then put through both functions:

| | before | after |
|---|---|---|
| reached the coach | 9 | 23 |
| got the confirm box | 11 | 0 |
| scored as a Spanish attempt | 3 | 0 |

The three that were scored are the quieter half of the same fault. *"I want to say I'll be there at
eight"* contains none of the words `looksBrokenAttempt` hunts for, so it was never suspicious — it
went to the evaluator as if it had been an attempt at Spanish. `strippedAsk`, ten lines further
down the same file, already knew that shape.

Eleven alternatives added, each a request for words that cannot be read as anything else: bare
"how to say", "X in Spanish", "the word for X", "which one do I use", "is it X or Y", "I want to
say X", "help me say X", "what does X mean", "what was that word". The false-positive set this file
has paid for twice — people DESCRIBING their problem, which is what the opening question asks them
to do — is pinned in `stuck-unit.mjs` and still passes: 27 caught, 20 correctly ignored.

### What is NOT fixed, and it is a decision rather than a patch

`looksBrokenAttempt` cannot tell a broken Spanish attempt from a clean English sentence. It never
could; enumerating ask phrasings works around it. So during a Spanish turn, English that is not a
request for words still gets the confirm box — *"I don't like the way I sound"*, *"I understand a
lot but the words disappear"*. Said in the opening, where English is the expected answer, none of
this applies and the suspicion router never consults it.

The honest claim for that screen is narrow: it means "I heard words and they might be wrong, check
them". A sentence with no Spanish in it at all is not that, whatever else it is. What should happen
instead — step out to the coach, answer in English inside the scene, or nudge back to Spanish — is
a design call with a real cost attached, and 1.3a already carries the open question of whether
stepping out stalls the conversation.

### Verification, and its limit

Unit level, against the real file, both directions. **The path itself cannot be reached without a
microphone**: both callers of `routeCapturedTranscript` are voice paths, so nothing typed ever
reaches the confirm box, and no automated run here connects the realtime session. The sentence-level
behaviour is verified. That it lands correctly in a live scene is not, and `/dash` is what that is
for.

## 2026-09-12 — the funnel gets its screen back

Found by Timo, by voice, on a fresh browser: run the 90-second flow and it comes out mixed with the
rest of the product. You are never let say what is hard for you, and the funnel breaks from there.

Two faults, both from the 2026-09-11 merge of `/dash` into the homepage, and both invisible to
every automated check, because the typed path never touches the voice stream.

**1. The funnel's orb was the entry engine's orb.** The landing screen has two faces — the funnel
for a first-time visitor, the entry engine for anybody with practice behind them — but the orb
between them was wired to the engine on both. So the biggest thing on the screen, under "you
understand Spanish. you just can't speak it.", opened a microphone into `/api/intent`: a classifier
built for "what do you want to do?", handed "I freeze when I have to answer". It replies with a
read-back into the stung intake, or with "I didn't catch what you want to do" — and on the funnel
there is no header to put that line on, so the visitor heard a refusal and saw nothing change. Only
the small "start talking." button reached the placement conversation.

**2. The engine listened to the room's turns.** The voice session is one shared connection, and
the engine subscribes to the same event stream the room does. Its listener had no guard for "the
room has the screen", and it is registered first, because the hook is called above the room's own
subscription. So every turn that server VAD ended inside the room was closed by the engine before
the room saw it: `closeCapture` ran there, the room's handler then found nothing to finish, and the
learner's Spanish attempt went to the intent router. The room's turn never ended.

Neither is the router's fault. It is right about what it does; it was being handed sentences that
were never for it.

### What changed

- `busy` — the engine's "somebody else has the screen" flag — now covers the funnel:
  `!isLanding || showFunnel`. The decision about who is looking moved above the hook, so the hook
  can know.
- On the funnel the orb is the room's: tapping it does exactly what "start talking." does. The
  engine's header, focus line and typed box render only on the other face.
- The engine is deaf while busy. Its stream listener and `finishListening` both return before
  touching a capture, and `say` refuses to speak into a live room. The room's handler ignores the
  stream on the landing, which is the mirror image: one listener per face of the screen.
- A stand-down when `busy` flips on: the idle timer, the read-back hand-off, a "when is it?" or
  "how did it go?" waiting for its answer, and any capture the engine itself opened are dropped.
  `ownsCaptureRef` is what makes "itself" answerable — `voice.capturing` cannot say whose window it
  is. The phase resets during render, the way React asks for state that follows a prop; the effect
  touches only refs, timers and the shared session.
- The read-back timers go through one `handOff` with a handle, because a tap on the card during
  the read-back used to start one session and the timer a second one on top of it.
- `orbState` typed as its four literals. A return object widens them to `string`, which `tsc` had
  been reporting on `/dash` since the merge.

### How it was checked

`funnel-separation-check.mjs`, run against the unchanged build first: case A failed exactly as
reported — the funnel's orb was labelled "say what you want" and tapping it opened the engine's
typed box under the funnel headline. After the change both cases pass. The router check in the
room (4 intents), the five-case leaving check, the auth-survival check and the closing-panel check
all still pass. The two page errors the leaving check now records are the production-build
navigation fault already in TODO section 2 — the pill is clicked in two of its cases, and until
this week the pill was hidden mid-session, so no click ever happened.

**What this does not verify is the voice half.** No automated run connects the realtime session, so
fault 2 is fixed by reading and reasoning, not by a green run. The proof is a real run on the
phone: the funnel from a fresh browser, then the same sentence on `/dash`, which is what `/dash`
is for.

## 2026-09-12 — leaving the room stops costing the room

The account pill used to **disappear** the moment there was anything to lose. The comment beside it
said why: a plain navigation with no stash and no restore, so following it cost you the run. It was
the last open item in TODO 1.5 — and it meant that signed in, mid-session, there was no way to your
own account and therefore no way to sign out.

**The finding that made it bigger.** There was no `beforeunload`, no `pagehide`, no
`visibilitychange` anywhere in the project, and `stashRoomForAuth` had exactly one call site:
immediately before the Google redirect. A run is not written to the database until it closes. So a
reload at turn four threw the whole thing away, silently, and always had.

### The hard part, and where the safety actually comes from

The restore already had four guards, and at mount the most important one evaporates:

| | signing in | at mount |
|---|---|---|
| `if (roomHasUnsavedWork) return` | holds | **useless** — the room is empty at mount by definition |
| the two-hour TTL | holds | holds, but that covers a lunch break |
| "something has to be in it" | holds | holds |
| read once, clear immediately | holds | holds |

The auth snapshot is safe for reasons that are not in its code: it is written **only** while a
redirect is in flight, and read **only** when somebody has just signed in. Its existence is the
signal. A snapshot written on every way out does not have that, so the provenance had to be made
explicit — and the answer is the store itself.

**`sessionStorage`, not `localStorage`.** It belongs to a tab, which supplies all three of the
missing guarantees at once: closing the tab throws the intention away with it, tomorrow morning is a
new tab with nothing in it, and two open tabs cannot steal each other's session.

**The restore became the sixth hand-off key.** The room already reads five on mount in a documented
precedence order. The new one goes last in precedence — anything naming a particular conversation to
start beats coming back to the one you left — which meant declaring it **first**, because every
reader in that ladder clears its own key as it reads, so a key can only be checked by an effect that
runs before its reader. With that, the race against `resumeMomentKey` and `autoStartKey` does not
have to be solved; it does not exist.

### What changed

- `stashRoomForAuth` / `restoreRoomAfterAuth` became `stashRoom(journey)` / `restoreRoom(journey,
  email)`. `email` is null on a plain return, and two things hang off it that must not happen then:
  filling the return box, and the auto-save — which writes the moment **and posts a summary**.
  Somebody who glanced at their account has asked for neither.
- The pill stashes in its `onClick` and stopped hiding.
- `pagehide` covers every way out that unloads the document. Not `beforeunload`: mobile Safari does
  not fire it reliably and some browsers read it as grounds for a "leave site?" dialog.
- The exit button and sign-out **clear** the key. Both mean "I am done".
- `stashRoom` refuses on the landing screen. The exit button does not reset `openingAnswer` or
  `placementRescue`, so without this a reload after pressing exit would hand back a room that had
  just been closed.
- Coming back sets "picking this back up." — the same sentence a resumed moment already uses.

### How it was checked

Five cases against the mock build, recorded **before** the change so the before state is on record:
the pill was indeed absent mid-session, and a reload did indeed lose everything.

| | |
|---|---|
| the account pill, then back | restored |
| reload mid-scene | restored |
| **exit, then reload** | **not restored** |
| **a second tab while the first is mid-scene** | **stays empty** |
| **sign out, then back to the room** | **not restored** |

The three in bold are the real tests. A restore that fires when nobody wanted it is worse than no
restore: it drops a finished conversation on somebody, or hands one browser's practice to whoever
opens the tab next.

`session-survives-auth-check.mjs` failed on one assertion afterwards, and it was the check that was
stale rather than the code: it asserted that an abandoned redirect leaves you with an empty room.
That was an honest description of a limitation, not a property worth keeping, and it is exactly what
this change exists to end. The expectation is inverted, with the reason written next to it.

### Found on the way, and not fixed

**Every client-side link is dead in the production build.** In a local `vinext build` +
`vinext start`, every `next/link` navigation throws `TypeError: e is not a function` and the URL
never changes — `/` to `/account`, `/account` back to `/`, `/dash` to `/account`, including links
written long before this work. The dev server does all of them cleanly, and every route renders
fine when reached by a fresh page load.

It is not this change's doing and it is not the account page's. What has **not** been established
is when it started or whether the deployed app has it — `vite.config.ts` targets Cloudflare by
default, so a local `vinext start` may not be what the host runs. It is in TODO section 2.

Two consequences here. The five-case check leaves the room with `goto` rather than by clicking,
because clicking through a broken bundle would test the bundler; and the click itself — that the
key is written before the navigation, that `/account` arrives, that coming back brings the
conversation — is proved separately against the dev server.

## 2026-09-11 — `/dashboard` and `/profile` become `/account`

Step 3 of TODO 1.5, and the last of the three. Four surfaces are now three.

`/dashboard`'s own header comment called it *"Home. What a learner lands on once the funnel is
behind them"* — which is the room's job since the landing screen learned who is looking. A second
screen calling itself home is how somebody ends up with two front doors and no idea which is
theirs. So what is left on `/account` is the half neither screen was on its own: **who you are,
what you have done, and the way out.**

| | |
|---|---|
| `app/account/page.tsx` | new, 212 |
| `app/dashboard/page.tsx` | deleted, was 221 |
| `app/profile/page.tsx` | deleted, was 170 |
| links repointed | 7 |

**Two things did not come across.**

The **hero** — `/dashboard` opened with the focus label as a headline and "start talking" under it.
The room's landing carries both now, against live data, so a second copy would be the same claim in
two places with nothing keeping them honest.

The **coach chat**, Timo's call in 1.5. It had no engine, a disabled input saying so out loud, and
canned replies behind a preview flag. `mockChatReplies` stays in `lib/dashboard-mock.ts` because
#30 is a real plan and that mock is the shape it was drawn in; it simply has no caller.

**One duplication resolved itself.** Both old files built the trend sentence inline, in two
different wordings — precisely the fault `lib/dashboard-data.ts` warns about in its own header.
There is one now, and it stays inline until there is a second caller.

**One correction to the plan.** TODO 1.5 said sign-out existed in exactly one place. It was two:
the verdict card has had its own since 1.1 and keeps it, because catching somebody at the verdict
is the whole point of that one. What `/profile` held alone was the sign-out you can reach when you
are *not* mid-session, and that is what moved.

### How it was checked

- `/account?preview=1` — the merged screen carries everything both old ones did: identity, the
  three stats, the focus reading and its trend, all five `HomePanel` sections, sign-out. The chat
  is asserted **gone**, not merely unrendered.
- **a real throwaway account**, created and deleted through GoTrue's admin API. Two things the
  preview cannot answer, because it has no session at all: the identity line reads the auth session
  directly rather than `/api/library`, and sign-out is the only action on the page. Signed in it
  read `signed in with email · since 11. Sept.` and the honest zeros; signing out returned to the
  room and left `/account` showing the empty state.
- **every door**, from both hosts: the room's account pill and debug pill, `/dash`'s tray. The
  account disc on `/dash` was removed rather than repointed — the disc and the tray went to two
  screens, and one row with the same destination twice reads as a choice that is not one.
- `/dashboard` and `/profile` return 404, asserted rather than assumed.

### Still costs a session

The account pill is a plain navigation with no snapshot, so it still hides while there is work to
lose. That guard was right when it led to a screen nobody needed mid-session. It is wrong now that
it leads to the only place a learner can sign out — and it is not a one-liner, because
`restoreRoomAfterAuth` is wired to `onAuthStateChange` and a back-navigation fires no auth event.

## 2026-09-11 — the homepage learns who is looking

Step 2 of TODO 1.5, and the reason for it in Timo's words: *the landing not knowing who is standing
in front of it is why we want `/dash` on the homepage — so we can give them a dashboard feeling.*

`/dash` had all of it built and **nothing in the repo linked to it**. The pick-up card, the event
cards, the steps drawer, the focus line, and the orb that listens and works out what you want — all
reachable only by typing the URL.

### What the landing does now

| | before | after |
|---|---|---|
| signed out, nothing on this device | the funnel | **unchanged**, plus an orb that listens |
| signed out, an event planned here | the funnel | the event, the next go, the drawer |
| signed in | the funnel | their own practice |

Events are keyed to the browser rather than an account (`/api/events` has never required a
session), so somebody who planned one before signing up still sees it. That was Timo's call and it
is the honest reading of how events were built.

**`previewByDefault: false` in the room.** `/dash` shows the invented account to a signed-out
visitor because it is an unfinished screen worth looking at without a month of practice behind it.
The homepage must never do that, and it is a parameter rather than a shared constant so it cannot
be switched on by accident.

### The orb, and why the engine is a hook

Timo asked for the orb to work on the homepage exactly as well as it does on `/dash`. Pasted in,
that was ~800 lines of phase machine, microphone and router landing in a file that had just had 535
lines taken out of it — and two copies of the one decision on that screen that must not drift: what
a sentence means.

So the engine moved **once**, into `lib/use-voice-entry.ts`, and takes two things: what is on
screen, and what to do about it. That second half is the whole difference between the hosts:

| the learner says | `/dash` | the room |
|---|---|---|
| "let's do that one" | write `outloud-event-beat`, navigate to `/` | `runEventBeat(event, index)` |
| "pick that back up" | write `outloud-resume-moment`, navigate | twelve lines of state |
| "just talk to me" | write `outloud-autostart`, navigate | `enterRoom("speaks-first")` |

All three receivers already existed in the room. In the room the hand-off keys are not written at
all — proved, not assumed, by a check that reads `sessionStorage` afterwards.

The derivations went the same way, into `lib/use-entry-data.ts`. The individual helpers were
already shared; what was not was the **ranking** — a dated evening beats an overdue phrase beats
the last thing you did — and that ranking is a claim about the learner.

| file | |
|---|---|
| `app/dash/page.tsx` | **1382 → 410** |
| `lib/use-voice-entry.ts` | new, 1077 |
| `lib/use-entry-data.ts` | new, 161 |
| `app/components/PickUpCard.tsx` | new, 213 |
| `app/components/StepsDrawer.tsx` | new, 94 |
| `app/page.tsx` | 5950 → 6154 |

### A dead end, found and closed

`blocked` — no microphone — was a dead end. The copy said "the card below still works", which was
true and beside the point: the router is the only route to a new scenario, an event plan or a
phrase question, and somebody whose browser refuses the microphone was told to take whatever was on
offer instead. It has a typed way in now, joining the flow at exactly the junction a clean
transcript does, so there is still one router and one set of rules.

Writing the check for it immediately found a second fault, and a worse one. `route` and `planEvent`
both **ask something back** — "I didn't catch what you want to do", "when is it?" — and then reopen
the microphone. With no microphone that reopen fails, and the failure path clears the line that was
just put on the header. The question was wiped in the same breath it was asked, twice over. `openMic`
now refuses a retry it already knows will fail, and leaves the question standing.

### How it was checked

Two harnesses, both proved against unchanged code first, both free — `/api/intent` and
`/api/event-plan` answer from regexes under `OUTLOUD_MOCK_AI`, and `?preview=1` serves an invented
account with no network at all.

- **the router, seven cases** — every intent typed in, and the sequence of header states it passes
  through recorded. The first version of this disagreed with itself on three of seven runs: "one
  sec." is real but whether a 120ms poll catches it is not, so the plumbing states are filtered and
  what is left is every state a learner is meant to read.
- **six structural fingerprints of `/dash`** — the card row, the drawer and the stage, in five data
  states. Identical after each stage.
- **the router in the room** — four intents typed into the landing, asserting the room took each
  one in place: no navigation, and nothing left in `sessionStorage`.
- **the warm landing's masking** — new exposure, not moved exposure. The event name, the saved
  phrase and its meaning were only ever on a screen nothing linked to; they are on the front door
  now. Nothing on either warm state survives into a session replay.
- plus `closing-panel-check`, `session-survives-auth-check`, `replay-mask-check`, `home-check`,
  `dash-check`, `dash-default-check`, `event-states-check`, and `tsc` / `eslint` after every stage.

**What is still not covered is the microphone itself.** The harness aborts the realtime token,
which is exactly the "no microphone" path — the right place to prove the honest failure state and
the wrong place to claim the capture works. That one is still a real phone.

### `/dash` is kept

**`/dash` is not going anywhere, and this is why** (Timo, 2026-09-11, overruling an earlier note
here that said it should be deleted after step 3):

> we need `/dash` so I can cross-check whether what you built on the homepage actually works. And
> you can't do that with your tests, because you can't give voice input — and for a reason probably
> nobody knows, the voice input is completely different from the text input.

Both halves are right and the second is the important one. Every check in this repo drives the
TYPED path: the Playwright harness aborts the realtime token, which is by construction the "no
microphone" branch. So the microphone has no automated cover at all and cannot get any. `/dash` is
the control — the same two hooks, the same engine, a screen whose behaviour is already known — and
the only way to tell "the homepage is broken" from "the merge broke it" is to run the same sentence
into both by voice. Deleting it would remove the one instrument that can answer that.

## 2026-09-11 — thirteen sheets out of the room file

Step 1 of TODO 1.5. `app/page.tsx` held **6485 lines**, and inside its JSX sat thirteen overlay
sheets — the verdict card down to the eyes-off sheet — about 715 lines of markup in a file that is
otherwise the session engine. Step 2 folds `/dash` in *as components*, and the point of doing this
first is that the room should then grow by wiring rather than by pasting.

**Pure motion. No behaviour changed, no markup changed.** Six new files in `app/components/`,
following `HomePanel.tsx`:

| file | sheets |
|---|---|
| `VerdictCard.tsx` | verdict |
| `AfterCard.tsx` | after, journey |
| `FeedbackSheet.tsx` | feedback |
| `ProfileSheets.tsx` | profile, evidence, assistance |
| `RepairSheets.tsx` | correction, pronunciation |
| `SessionSheets.tsx` | transcript, pressure, ask, eyes-off |

`app/page.tsx`: **6485 → 5950**.

**No derivation moved with its sheet.** `momentBefore`, `lootItems`, `feedbackDone`,
`activeEvidence` and the rest are each read by exactly one sheet and would have looked at home
inside it. They stayed in the room and travel as props, for the reason `lib/dashboard-data.ts` gives
in its own header: the same claim about a learner, computed in two places, is how an app ends up
telling somebody two different things about themselves. It also keeps every stage a pure cut and
paste, which is what makes the verification below mean anything.

Where a sheet needed a type declared in `app/page.tsx` — `PlacementAttempt`, `FeedbackQuestion`,
`LifelineResponse` — it declares the fields it actually reads instead of importing the type back.
The room and its own sheet should not depend on each other.

**Two things worth knowing before touching these sheets again**, both found by reading rather than
guessed at:

- `closeOverlay` is not "hide me". It also clears `feedbackStep`, `feedbackPick`, `feedbackText`,
  `askDraft`, `askStatus` and `askAnswer`. It is passed down; nothing reimplements it.
- The journey and pressure sheets are **dead ends** — neither has a button that changes which sheet
  is open, so the sheet handle is the only way out, and it closes the after card behind them too.

### How it was checked

A structural fingerprint of all fourteen screens (thirteen sheets plus the verdict's email
fallback), before and after: the tag tree, class names, attributes and whether each text node is
present and non-empty, with the text itself normalised away.

The first attempt at this did not work, and why is the useful part. Against the real model no two
sessions produce the same screen, so the same sheet came back with 48 nodes on one run and 46 on the
next — a diff that cannot tell a lost prop from a differently-worded rescue. Every route on the
session path already has a mock branch behind `OUTLOUD_MOCK_AI`, so the check now runs against a
production build served with it on. Identical sessions every time, byte-identical fingerprints, and
no model calls at all.

Before trusting it, it was pointed at unchanged code and had to report thirteen sheets identical.
It did. Then, after each of the six stages: `npx tsc --noEmit` (the three known pre-existing
errors), `npx eslint app lib` clean, and the fingerprint diff. All six green, and the last run
covered all fourteen screens.

Plus the three existing walks, against the real dev server: the full session to the closing card,
the room surviving a sign-in redirect, and the replay masking, which is worth re-running precisely
because it hangs on class names and this touched a great many of them.

## 2026-09-11 — a session survives signing in

The snapshot that carried a learner across the Google redirect was called `VerdictSnapshot` and it
held eight fields, all from the intake. Everything else in a 6000-line client component is React
state, and a full-page redirect empties it. So somebody who signed in during the practice
conversation came back to the landing screen: no error, no warning, no sign they had been there,
and nothing to resume from either, because the moment is only written at close.

That is backwards for what this app is trying to be. The account is meant to be earned by a win —
master-plan **#18**, as Timo restated it — which means the thing somebody is being asked to sign up
for is the run they are in the middle of. It was exactly that run we threw away when they said yes.
Nobody can accept an offer at the moment it lands if accepting costs them the reason they wanted it.

**`RoomSnapshot`** now carries the whole room: the phase, the conversation id and turn index, the
intake and its rescue, the character, every scene turn, the line on screen, and what has already
been banked. Deliberately not in it: the microphone, the realtime connection and the overlays, all
of which are rebuilt on mount, where a stale copy is worse than none.

Three things are load-bearing and none of them is the snapshot itself:

- **`savedMomentId` travels.** Without it the next save writes a second moment for the same
  conversation and the library grows a duplicate nobody can tell apart.
- **Restore refuses over a live room.** Password sign-in never reloads, so an abandoned snapshot
  could otherwise reach into the conversation somebody is having right now. A refused snapshot is
  also *discarded*, not left to fire on the next reload — the case where it is refused is the case
  where we have just decided they do not want it.
- **The auto-save only fires for a run that is over.** `saveReturnEmail` writes the moment, the
  words and a retrieval email; mid-conversation that would file a half-finished run and post
  somebody a summary of a session they are still sitting in.

The sign-in button goes back into the room header at every point in the session, which is the
payoff. The profile link stays hidden while there is work: it is a plain navigation with no stash
behind it, and whoever gives it the same treatment can delete that branch.

**Tested by walking it.** A real session to mid-scene, "continue with Google" with the redirect
blocked, back to the app, and the snapshot read from storage: the phase, the conversation, the
rescue, the character, the line and the scene turn are all in it. Then a session put into storage
and the page reloaded the way an OAuth return does — the room comes back on the same line, ready to
answer, with no verdict sheet dropped on top, and the snapshot consumed. Coming back *signed out*
restores nothing, which is the abandoned-redirect case.

The two halves that need a real account were run against a throwaway one, created through GoTrue's
admin API and deleted afterwards along with everything it wrote:

- signing in with a password mid-session leaves the room alone, and a planted stale snapshot never
  reaches the screen;
- **finishing a session signed in really does write to `word_bank`** — two rows, both with a
  `due_at` two days out, sources `rescue_phrase` and `rescue_pattern`. Those are exactly the two
  sources that were permanently ineligible for resurfacing this morning, in a table that had held
  zero rows for three weeks. Both fixes from earlier today, confirmed against the table rather than
  the code.

## 2026-09-11 — the words were never saved either

Found while applying the backfill above: `word_bank` holds **zero rows**, against 40 saved moments.
The migration was a no-op because there was nothing to migrate.

`saveWordBank` had exactly one caller, `saveReturnEmail`. So a signed-in learner who finished a
session and did not type an address into the email box saved a moment and no words at all. Every
route the app has to the word bank ran through a box that a signed-in learner has no reason to fill
in.

That is the bigger half of "the phrase never came back". Scheduling every saved phrase is worth
nothing while nothing is ever saved, and the closing card has been promising a return on top of an
empty table for three weeks.

`saveCurrentMoment` now saves the words with the moment. Idempotent by design — the upsert is keyed
on `(user_id, lower(spanish))` — so the call in `saveReturnEmail` stays for the case this one cannot
cover: somebody who played the whole session signed out and creates the account at the verdict, when
the moment is already saved and the words needed a token nobody had at the time.

Confirmed that the path runs by walking a full session: `POST /api/moments` fires at close, which is
where the word save now sits. Signed out it returns before the network, which is correct —
`word_bank.user_id` is not null. **The signed-in half still needs one real run to confirm rows land.**

## 2026-09-11 — the phrase that never came back

The closing card has been telling learners **"we'll bring this back in a new situation, with a
little less help"** about the phrases their session produced. It could not. Three gates, in three
files, only let a phrase into the recall queue if `source === "asked"` — and every phrase on that
card is `coach_tool`, `rescue_phrase` or `rescue_pattern`. `lib/phrase-recall.ts` skips any row
without a `due_at`, so the promise was false for effectively every phrase in the app, made on the
one screen where we ask for an account.

Written down hours earlier in this same repository: *"signed in that is true — `lib/phrase-recall.ts`
really does resurface a saved phrase."* That came from reading the design, not the code.

**Timo's call: make it true rather than cut it.** The argument the old comment made for the
restriction — that queueing everything would "make every scene a quiz within a week" — was simply
wrong, and worth writing down as a lesson: **the pool size does not set the frequency.**
`pickForScene` returns at most one phrase and skips roughly two scenes in three no matter how many
are due. Widening the pool changes *which* phrase comes back, never *how often* one does.

- `app/api/word-bank/route.ts` — every saved phrase gets a `due_at`. A re-save restarts the clock,
  deliberately: the same phrase surfacing from a second session is evidence they are still reaching
  for it.
- `lib/phrase-recall.ts` — `duePhrases` now sorts `asked` first. Handed-over phrases outnumber
  asked-for ones by about two a session to none, so on a plain most-overdue sort the one thing
  somebody went looking for would sit behind a fortnight of vocabulary it never asked to be tested
  on. Widening the pool must not cost the strongest cue its place.
- `app/page.tsx` — `loadDuePhrases` no longer filters the rest out on the way in. This was the
  quiet one: the server could schedule every phrase and this line would still have dropped them.
  Two copies of one rule, which is how the rule survived being changed once.
- `supabase/202609110001_phrase_recall_all_sources.sql` — **not yet applied.** Backfills `due_at`
  from `created_at` for every unscheduled, unlanded row: the phrases that were promised a return
  and never scheduled for one. `created_at`-based so a learner's history staggers instead of all
  coming due at the same instant. Landed rows are untouched — they are theirs.

Checked against the real module, eleven cases, including that a phrase saved an hour ago still does
not come back today and that a forty-phrase pool still yields at most one.

## 2026-09-11 — session replay was reading the sentences

`lib/track.ts` masked session replay with a list of content class names, with `.private` as the
escape hatch and a comment warning that the list *"is a snapshot of one afternoon's class names and
the next panel somebody adds will not be in it."*

Audited: `.private` was on **zero** elements, and roughly forty classes rendering a learner's
sentences, the coach's replies and the verdict's diagnosis were not on the list. Its own comment had
described what happened. Among the missing was `.then-line` — the learner's opening sentence, quoted
back at them on the closing card — added that morning and recorded from its first render.

**Fixed by inverting the default, not by extending the list.** A rule you have to remember is not a
rule, it is a hope.

- `maskTextSelector: "*"` makes every rendered string a masking candidate.
- `maskTextFn: replayText` hands back only what we can vouch for: `chromeSelectors`, fourteen
  hand-checked classes of our own fixed copy. Content beats chrome, chrome beats the default, and
  the default is masked — so a sentence rendered inside a button is still a sentence.
- A panel added tomorrow is private without anybody deciding it should be. A mistake now costs a
  button you cannot read rather than somebody's words in a recording.
- `.profile-pill` is the one that looks like chrome and is not: it renders the first letter of the
  signed-in address.

Verified twice rather than assumed. Against rrweb itself, using the recorder build posthog-js ships:
content asterisked, chrome readable, and content nested inside chrome still asterisked. And against
the running app, walking every text node on four screens with the two selector lists parsed out of
`lib/track.ts` at run time — a test carrying its own copy of the rule proves only that two copies
agree, which is exactly how the old list managed to look correct while being forty classes behind.

Nothing is really lost. Masking keeps layout, length, and every click, hover and scroll, and the
event catalogue already names the phase precisely.

## 2026-09-11 — the little circle that ate the session

The room's header pill offered sign-in at any moment. Both of its branches leave the page — the
profile link routes away, the sign-in button ends in a Google OAuth redirect — and neither saves
anything. `stashVerdictForAuth` is the only rescue there is and it writes nothing unless a verdict
already exists.

So a learner four turns into a conversation who tapped the circle in the corner came back to an
empty room. No error, no warning, no record they had ever been there. It reads as a crash, and it
sits four millimetres from the exit button.

The pill is now hidden while there is work on the screen (`roomHasUnsavedWork`). Nothing is lost by
it: master-plan **#18**, as Timo restated it on 2026-09-11, puts the account ask *after* a win
rather than before a paywall, and that ask already exists on the verdict card — where the session is
finished, the value is still on screen, and signing in costs the learner nothing.

## 2026-09-11 — `/dash` showed everyone a stranger's month

`useLibraryData` checked `previewByDefault` before it checked the session, so **every** visitor got
the invented account — signed in or not. A learner opening the entry screen was shown somebody
else's month of practice inside their own account, behind a badge the size of a word.

The order is now: an explicit `?preview=1` wins, then the real session, and only a signed-out
visitor falls back to the invented one. `?preview=0` still refuses the fallback. `previewByDefault`
survives as the one line to change when the screen is finished, but it now decides only what happens
when there is no session to show.

## 2026-09-11 — the button that asked for a phrase now answers with one

1.5 step one. The landing screen's second button says **"didn't know how to say something?"** and
called `enterRoom("stung")` — the engine for *a moment that went badly*. Walked end to end, it
answered *"tell me what happened — english is fine"*, and after being told the exact sentence
somebody wanted to be able to say, replied with a choice of two scenarios and never said the
phrase. `/api/lifeline` was not called at all.

The engine that answers it has existed since the `talk` build and was reachable only through
`/dash`'s intent router — and nothing in the app links to `/dash`.

Neither option previously written down was needed. Relabelling the button would have made it
honest and useless; routing through `/api/intent` would have pulled the router forward before the
merge. **`RoomMode` gained an `ask` entry instead**: one direct question — *what do you want to be
able to say?* — so the answer IS the thing, and nothing has to infer what they meant. It is an
entry mode, not a phase; `runAskPhrase` puts the mode back to `speaks-first` the moment the answer
arrives.

**`strippedAsk`** turns a question into the sentence it asks for: *"how do I say I'll take care of
it"* → *"I'll take care of it"*. Deliberately conservative — it strips a leading ask and a trailing
"in Spanish", and hands back the original if that would leave nothing. It has to be, because
`askEn` becomes the lifeline's query, then the rescue's `originalText`, then the phrase in the word
bank. Pinned in `strip-unit.mjs`, 18 cases, importing the real file: *"I say it wrong every time"*
and *"how do I sound less rude"* come back untouched.

Verified in the running app, not reasoned about. The button now produces `/api/lifeline`, three
options each with **when to use it**, the say-it-back, a real `/api/rescue`, and then the offer to
*use it for real* or say *that's all I needed*. The whole chain the `talk` plan described, from the
one door a stranger can actually find.


## 2026-09-11 — the closing card shows the result but never the change

Groundwork for 1.5, and it turned out to be the cheap part. Two findings shrank it.

**The top of the ladder has never been reached.** `confirmed_real_life`: 0 runs of 37, over five
weeks. Not rare — `deriveReviewLedgerState`, the function that infers it, has **zero callers**. It
is reachable by another door, `/api/events` setting it when somebody reports back that they went to
the real thing and spoke — and that question is asked on `/dash`, which nothing links to. The
second feature to fail for only that reason.

**But that is the wrong win for a first visit anyway.** It takes days. The session win already
happens: 26 of 37 runs reached `answered_on_own` or `used_new_situation`. The taster does not need
inventing — and per Timo, the single win's job is to earn an **account**, not a subscription.
Nobody pays for something they did once; habit is what people pay for, and habit needs somewhere
to accumulate.

So what was missing was the contrast. The card led with the learner's Spanish sentence — right
instinct — and then reported it underneath as *"you got at least one real reply across clearly"*.
A participation note, for somebody who had just said fourteen words of Spanish after opening with
*"the words disappear"*.

**The card now puts the two sentences next to each other**, both in the learner's own words:

```
YOU CAME IN SAYING   "I understand a lot but when I have to answer I just freeze
                      and the words disappear."
YOU LEFT SAYING       No, gracias, solo el café con leche.
```

Shown only when there really are two different things to compare. The before is deliberately
quieter than the after: equal weight would turn a win into a before-and-after advert.

**"Changed today" counts instead of hedging.** *"At least one"* is what you write when you do not
know the number, and the room does know it. It now reports replies that needed no help — the thing
the contrast cannot show. Worded as *replies in this conversation*, because the journey block
below counts saved moments across all sessions under nearly the same phrase, and two units with
one wording put "3 sentences" and "1 sentence so far" on the same screen.

**The weekday promise is gone for anybody signed out.** The card said *"FRIDAY — we'll bring this
back."* Signed in that is true; `lib/phrase-recall.ts` really does resurface a saved phrase. Signed
out, `word_bank.user_id` is `not null`, so nothing is saved to come back and no Friday ever
arrives. It now says what is true: *this run is saved on this device. nothing brings it back on its
own.* Stated as a fact, not a second ask — 1.1 settled that there is one ask per session and it
lives at the verdict.

Verified by driving a full typed session to the closing card and looking at it.


## 2026-09-11 (later still) — "ah..." was treated as a broken transcript

Reported with a screenshot: a capture of exactly `ah...` shown under **"here's what I heard. fix
anything that's wrong, then send."** The transcription was perfect. There was nothing in it.

`isFillerOnly` existed for precisely this, and its own comment describes the failure — *"puts a
confirm box in front of someone who was still working out how to start"*. It did not fire because
`ah` had been deliberately left out of `fillerSounds` on the grounds that it is a reaction, not a
stall.

That reasoning is right about a reaction INSIDE an utterance: *"ah, sí, quiero un café"* is an
answer with a noise on the front, and the rule never touches it because the other words are not
fillers. It is wrong about a reaction that is the WHOLE utterance. `ah...` on its own answers
nothing, and whoever produced it was reacting or thinking, not speaking.

So reactions now live in their own set — `ah`, `oh`, `ay`, `uf`, `huh` and their stretched forms —
and `isFillerOnly` accepts either set. Every word still has to be one of them, which is what keeps
real answers safe. `mm`, `mmm` and `mhm` stay out for the original sharper reason: as a whole
utterance they usually mean YES.

**Both capture paths classify now.** The screenshot came from the realtime path, which had already
run `classifyCapture`, got `ok`, and passed the transcript to `routeCapturedTranscript` — where a
one-word English answer is "suspicious" and gets the confirm box. The recorded path never
classified at all, so a decode loop could have gone straight through it unscreened. It now runs the
same function the realtime path does, before anything is called suspicious, and answers `filler`
and `empty` with *"take your time."* rather than with a correction screen.

The confirm box means *I heard words and they might be wrong, check them*. Showing it for a
capture with no content tells somebody who was still thinking that the microphone misheard them,
which is untrue and the opposite of what that moment needs.

Pinned in `filler-unit.mjs`: 12 captures treated as nothing said, 12 real answers untouched —
including `ah, sí` and `uh, quiero un café`. It imports `lib/voice-guards.ts` rather than copying
it.


## 2026-09-11 (later) — the app answered a sentence nobody said

From a real voice session, with the console log. Three separate faults, and the model was not one
of them: every `response.create` carries *"Say this exact line and nothing else"* with
`conversation: "none"`, so the realtime layer only ever read out what the coach routes wrote.

**A speech segment that began after the mic shut could answer for the learner.** `closeCapture()`
sets `awaitingTranscript`, which deliberately keeps accepting transcription while the window is
closed — the transcript for the turn that just ended is still in flight. What it did not do was
check WHICH segment the transcript belonged to. From the log:

```
[voice:capture] waiting for transcript, timeout: 6000 ms
[rt] input_audio_buffer.committed       | micWindow: closed
[rt] input_audio_buffer.speech_started  | micWindow: closed   <- a new segment, mic shut
[rt] ...transcription.completed "Valla en az..."
```

`"Valla en az..."` was submitted as the learner's answer. Nobody said it — it is the room, or the
tail of the coach's own audio, decoded into words. A `speech_started` while the window is closed
now ends the window: what was already finalised still counts, nothing after it does. If that
leaves the turn empty it is discarded as a dud and the learner is asked again, which is the honest
outcome and much better than being answered about a sentence they never spoke.

**The transcription language was pinned too late to matter.** It was applied inside
`startRealtimeListening`, which on the open-mic path runs *after* server VAD has already fired —
the learner is mid-word by then, so the switch describes audio that has gone. It now happens in
`syncRealtimeMic`, which runs on every mic transition and therefore strictly before the first
sample of speech. Skipped while a capture is open or its transcript in flight, because changing
the language under an utterance being decoded corrupts the turn it is meant to fix.

**The stepped-out screen showed three status lines at once.** "speaking", "tap the orb to
interrupt" and "stepped out — we can pick this up again", stacked, none of them the thing being
read — and "interrupt" is wrong there anyway, since no scene is running. The room's label and
subcopy are dropped while stepped out; the aside's own badge is the one line.

Also in that screen: the learner's own lines were 0.75 opacity on soft ink and close to unreadable
on a phone; the thread rendered oldest-first so it clipped the newest line mid-sentence; and the
scrollbar thumb sat on top of the text, which is the "stray cursor" in the screenshot. Contrast
back, pinned to the bottom with the older lines fading out above, and 12px of room for the
scrollbar.

**Not verified by machine.** All three are on the voice path, which the headless harness cannot
drive — it aborts the realtime token by design. The stepped-out screen was rendered and looked at;
the two voice fixes have been reasoned from the log and typecheck clean, and need a real session.


## 2026-09-11 — asking a question is also asking for help

Reported from a real session on the homepage, mid-scene, in Timo's own words:

> *"What is the word, like, I know, thanks to the hint, I know like Quiero comprarse, I want to
> buy, but what's, do I say if I wanna say, how, where is the pizza?"*

The app answered with **"here's what I heard. fix anything that's wrong, then send."** — the
screen that was supposed to have stopped appearing yesterday.

It did not fire because yesterday's detector only knew one shape. Every phrasing it recognised is
an **admission**: "I don't know how to say it", "no idea", "I'm lost". That sentence admits
nothing. It says *"I know"* twice. It is a **question**.

And the question is the normal case, not the edge case. Somebody who half speaks the language
does not announce defeat; they are already halfway through a sentence and ask which word goes in
the gap. Building only the admission shape means the app helps people who give up and ignores
people who are trying.

`lib/stuck-signal.ts` now exports both, and `needsWordsEn` — either shape — is what the room and
`/api/coach` call. The question pattern is anchored on the asking itself and deliberately not on a
bare "what to say", because *"I never know what to say when someone asks how I am"* is a
description of a problem, which is the over-firing this file has already paid for once.

Live, in the real UI: that sentence now steps out to the coach, which opens with **"You can say,
¿Dónde está la pizza? It means, Where is the pizza?"** No confirm box.

**The unit test now imports `lib/stuck-signal.ts` instead of copying it** (run it with
`node --experimental-strip-types`). The copy is what let three of these bugs through: when the
pattern was broken, the copy was broken identically and the test agreed with it. 27 phrasings
caught, 20 correctly ignored.


## 2026-09-10 (evening) — asking for help now reaches the coach

Reported by Timo, about the two moments that matter most: *I tell it the sentence I want to be
able to say, and it never tells me. And when I say mid-scene that I have no idea how to say
something, I keep getting the screen where it checks it understood me.* Both were reproduced
against the running app before anything was changed.

**"Here's what I heard" was the answer to asking for help.** Mid-scene, an English sentence trips
`looksBrokenAttempt` — which keys on English filler words as evidence that English leaked into
Spanish — so `routeCapturedTranscript` marked it suspicious and opened the transcript confirm box:
*"here's what I heard. fix anything that's wrong, then send."* The transcription was perfect. Being
told your pronunciation is the problem, right after asking for words, is worse than silence, and it
repeats for as long as you keep asking. A comment beside that screen already described the failure
and offered a third button as the way out — which the learner had to notice and press.

The room now reads the ask as an ask. `stuckAskShouldStepOut` runs before the suspicion router and
before scoring, on the typed path and the spoken one, and hands the learner to the aside — which
was already the coach mode, already a room mode so the mic stays open, already carrying the scene
snapshot and already able to put them back. It was only ever reachable by pressing a chip. Now the
asking reaches it.

**The coach then opened by asking what was on their mind.** Correct for somebody who walked out for
an unknown reason; wrong when they said why on the way out. `/api/aside` gains a third trigger,
`stuck`, carrying the sentence verbatim — and its turn-0 guidance teaches first. If the sentence
names the phrase, it hands over that phrase; if it names nothing (*"I have no idea how to say
that"*), the thing they could not say is the answer to the character's last line, which is already
in the payload. Find the referent, never invent one, never ask them to repeat what they just said.

Measured, in the real UI: a learner saying *"I have no idea how to say that"* to *"¿quieres algo
para comer también?"* now gets *"You can say, 'Quisiera algo para comer también, por favor.'"*
Naming it outright gets *"You can say, 'Me encargo de eso.' … Would you like to try saying it out
loud now?"* Neither is a question about their feelings, and neither is the confirm box.

**The detector moved to `lib/stuck-signal.ts`.** It was inlined in `/api/coach` and copied into the
harness that verified it, so when it turned out to be broken the copy was broken identically and
the test reported green. One home, imported by the route, the room and the tests.

### Known, diagnosed, not fixed

The landing button labelled **"didn't know how to say something? →"** calls `enterRoom("stung")`
— the engine for *a moment that went badly*, not the one for *how do I say this*. Walking it end
to end: it answers *"tell me what happened — english is fine"*, and after being told the exact
sentence somebody wants to be able to say, it replies with a choice of two scenarios and never
says the phrase. `/api/lifeline` is not called at all. `ask_phrase` is built and in
`runnableIntents`, but only `/dash`'s voice router reaches it. Left alone deliberately: relabelling
the button and routing it through `/api/intent` are different products, and that is Timo's call.


## 2026-09-10 (later) — the stuck detector never fired on a phone, and fired on the wrong things

The first synthetic-run sweep — four personas, three runs each, through the real UI — found two
faults in the detector fixed earlier the same day. They pull in opposite directions and neither
was visible from a transcript.

**Only one shape of apostrophe was spelled.** The pattern wrote the contraction as `don'?t`, which
matches `dont` and a straight quote. iOS and macOS substitute a curly U+2019 as you type, so the
sentence that actually arrives from a phone is `I don’t know how to say it` — a different string,
matching nothing. The morning's fix was real in the harness and **invisible on the device the app
is mainly used on**. Inputs are normalised before matching now.

This surfaced by accident, which is worth recording: the sweep's own false positives all carried
straight quotes and fired, while the single sentence carrying a curly one stayed quiet. The
inconsistency was the clue, not the failure.

**The widened pattern fired on people describing themselves.** Matching any `I don't ...` meant
`I don't like the way I sound`, `I don't have much time to practice` and `I can't stop translating
in my head` were all read as "hand me the words". The opening question literally asks people to
describe their problem, so this was aimed straight at the most common answer in the app. Handing
somebody a phrase card for a sentence they never asked to say is the mirror image of the morning's
bug and lands the same way: it looks like listening and is not.

The negation now has to be reaching for *saying* something — `know how`, `say`, `get it out`,
`put it`, `remember the word` — with a separate anchored branch for the bare `I don't know.` as a
whole answer, which in a room that just asked you to speak cannot mean anything else.

`stuck-unit.mjs` now pins all three bugs at once: 19 phrasings caught, 18 correctly ignored,
including every stuck sentence a second time with the phone's apostrophe. Live: the curly
admission is answered with `Yo me encargo de eso`, in a say-it-back card.

**Also built: the synthetic-run harness** it came out of. Four personas along two independent axes
— what they can produce, and what they do when they cannot — driven through the real UI on the
typed path, so the app makes exactly the calls it makes for a person. Documented in
`docs/features/synthetic-runs.md`, including the part that matters most: this is a measurement,
not a test suite, and voice is never covered.


## 2026-09-10 — "I don't know how to say it" was answered with a new question

Reported from a real session: *tell it you do not know how to say something, and it asks you, in
the scene, to say that thing.* It turned out to be three faults stacked, and the first diagnosis
written down for it — that the rule against this only existed on one turn of `/api/coach` — was
simply wrong. Both routes carry it as a general rule. Reproducing it against the live route is
what found the real causes.

**The scenario turn had no way to help.** Its instruction is hardcoded to `intent=probe,
tool=none` and ends *"show me what you would say — in Spanish, however it comes out"*, and
`stuckNote` was only ever appended from the turn AFTER it. So somebody answering the framing
question with *"I want to tell my girlfriend's mum I'll take care of it, but I have no idea how"*
got a scene set in front of them and a demand for Spanish. Six of six runs.

The turn now changes shape rather than gaining a footnote: when they have declared themselves
stuck, the scene is still set and `sceneCharacter` still filled — naming the person is the
valuable half — but it ends by handing over the words instead of asking for them. Structural, for
the same reason the framing turn was in #30: a prompt cannot argue a turn out of the instruction
that defines it.

**The detector missed the second admission.** `declaredStuckEn` required the pronoun and the
negation to be adjacent, so *"I **still** don't know how to say it"* did not match and was
handled as an ordinary attempt — answered with a fresh, unrelated question. Somebody saying it
for the second time is more stuck, not less, and it was exactly the second time that fell
through. Up to two words are allowed between now ("still", "really", "honestly", "just"). The
same lesson the date guard in `/api/event-plan` paid for: a pattern that only matches tidy
phrasing misses how people talk, and misses hardest when they are frustrated. Spanish stays out
of it — a learner who answers *"no sé"* has given a real answer.

**Then the help arrived for the wrong thing.** With both fixed, somebody stuck on *"I'll take
care of it"* was handed *"Quisiera un café y un sándwich"*: `stuckNote` said to help with "the
SAME thing", and the model read that as the same as the scene. It now says the content is decided
by them and not by the scene, and that a vague *"I still don't know how to say it"* refers back to
what they named earlier. Helping confidently with something nobody asked about is the *"what was
the point of telling it my problem?"* failure with a tool attached — worse than not helping,
because it looks like listening.

**And the scene itself had been drifting all along.** `pickScenario` fell through to option A —
built from the opening answer — whenever the reply matched neither option. So *"I froze at my
girlfriend's parents last friday"* became a cafe, because option A had been built from the word
"vocabulary" one turn earlier. A reply that overlaps neither option and is long enough to be a
situation is now the scenario itself. The same run afterwards opens *"This is Ana, your
girlfriend's mother — kind but very direct."*

**Measured, not asserted:** three scripted openings, two runs each, against the live route.
**1—2 of 12 turns asked back before; 0 of 12 after**, and the phrase handed over is the one they
named. The stuck pattern also has a unit check: 12 phrasings caught, 11 real attempts (Spanish
included) correctly ignored.

## 2026-09-10 — practice saved by a stranger belonged to nobody

#32, and the reason it could not be answered honestly until now.

**The bug.** `/api/library` claimed a new account's earlier runs with
`.eq("email", user.email)`. A run saved without an email is stored against the browser's
identity, with `anonymous+<session-id>@outloud.local` in the email column — a string that by
construction can never equal a real address. So anonymous practice was **saved and
permanently unreachable**: not by the learner, not by us, not by anyone, forever. Meanwhile
the closing card said *"sign up with the same address and everything you already saved comes
with you"*, which was true only for people who had typed one in.

`/api/events` has claimed on `session_id` since #30, and the comment there already named this
as the missing half one route over. It claims both ways now.

**The trade, stated rather than buried.** Signing in on a shared browser claims whatever
anonymous practice is sitting in it. That is the trust model events already run on — the
session id lives in that device's localStorage, so possession of the device is the credential
— and it is the only model under which "your practice follows you" is true for somebody who
never gave an address.

**The ask points at something now.** *"Nothing here comes back on its own"* is a claim about
tomorrow that a first-time visitor has no way to check. It now reads *"4 sessions are saved on
this device and nothing is holding on to them"*, from a new `GET /api/moments` that returns a
count for a session id and nothing else — no auth, because the session id **is** the
credential and a count is strictly less than the full rows `/api/events` already hands back
for one.

Order matters here: the sentence only became sayable in the same change that made it true.
Shipped a week earlier it would have been a better-sounding version of the same broken
promise.

Under two runs it keeps the older wording, and every failure path answers zero rather than
guessing. A number we cannot stand behind must never end up in a sentence telling somebody
what they have done.

**One ask, down from two.** Nothing new was added — nothing on `/dash`, nothing after the
first aha, and the room's `profile-pill` stays silent — and one was taken away. The verdict
and the closing card both asked, and both were gated on being signed out, which meant the
second could only ever appear to somebody who had just said no. An app that bans streaks and
refuses to praise silence does not get to ask twice. The verdict keeps it: the rescue and the
diagnosis are still on screen there to justify it, and it is the block that also carries the
email fallback and the signed-in save control. If instrumentation ever shows people leaving
before it converts, that is when it comes back — not on a guess.

## 2026-09-10 — the card and the account share a line, and the plan can be read

`UI.Idee.md`, built. Three changes to the bottom band of `/dash`.

**The card and the account are on one row**, roughly 85/15. The account used to sit in the tray
underneath, next to "everything", where the two competed for the same job — both were a way off
this screen and neither said which. It is now a disc on the card's own line, and the tray has one
link and one purpose.

**The event card can be opened.** A card can only ever show the next go, which is right for a
screen whose whole job is "one thing to do". But an evening broken into four pieces is a plan, and
a plan you cannot read is a plan you have to take on trust. A control on the card's right opens a
drawer upward with every go in it: which are done, which is next, who is in each one, and when.
Every row is startable — including the finished ones, which say "again" rather than going quiet.
Deciding somebody is done before they do is the same small betrayal #38 removed from the retry cap.

**The drawer closes the microphone.** Not a courtesy. An open capture window behind a panel of
text is the worst thing this screen can produce: the learner reads, server VAD hears nothing, and
the header comes back with "I didn't catch what you want to do" about a sentence nobody tried to
say. Silently, because nothing was asked.

### Two things the first pass got wrong

**A glyph nobody has.** The control started as `&#8963;` (UP ARROWHEAD), chosen because the house
convention here is text glyphs rather than icons. It has almost no font coverage and fell back to
an ASCII caret sitting on the cap line — it read as a stray `^`. The convention holds only while
the character is actually covered, which `&rarr;` is and this was not. It is now a drawn list
icon, the first SVG in the project, and it also says something truer: you get a list, not a
direction.

**A box inside a box.** The control was a 44px rounded rectangle floating inside the card's
rounded rectangle. Two nested radii that close together read as debris. It is now a zone *of* the
card — full height, separated by a hairline, sharing the card's right radius. The target grew from
44x44 to 46x66 on the way, which is the part that matters: it sits inside another tappable thing,
and missing it starts a session nobody asked for.

**The account was a letter in a rectangle.** An initial alone reads as a letter; on a disc it
reads as a person. The pill went from 46 to 58px — the 15% the idea asked for — and holds a
34px ink disc. Signed out it holds a real silhouette instead of a placeholder letter, which would
have been a small lie about whose account it is.

### Found while opening the account discussion, not yet fixed

**Anonymous practice is never claimed.** `/api/library` claims prior runs with
`.eq("email", user.email)`, so a run saved without an email — stored under the synthetic
`anonymous+<session-id>@outloud.local` — can never match a real address and is never claimed by
anyone. It is saved, and it is permanently unreachable.

`/api/events` already solves exactly this, one route over, by claiming on `session_id`. The
closing card meanwhile promises *"sign up with the same address and everything you already saved
comes with you"*, which is true only for people who typed an address in. See `docs/TODO.md` 1.1.

## 2026-09-07 — `talk` was three things, and one of them is never being built

The last intent on `/dash` had no engine. Looking at it closely it was not one thing waiting for
one engine — it was **three things wearing one label**, and two of them had engines already built
and sitting unused.

| what somebody says | what it is | what happens now |
|---|---|---|
| *"how do I say I'll take care of it"* | a **question** | the lifeline answers it, and then they have to **say it** |
| *"I froze at the pharmacy today"* | a **moment** | the room's `stung` intake, which has existed since before this screen did |
| *"can we just talk for a bit"* | **open chat** | a plain no, with copy that says so |

The design, and the reasoning behind every rule in it, is
[docs/features/router-talk-feat.md](docs/features/router-talk-feat.md).

### "Not built yet" and "never being built" are different sentences

`talk` used to take the honest-refusal screen: *"I can't build that one yet. I've kept it — it's
the first thing when I can."* For open-ended chat that is a promise we have decided never to keep
— free-chat mode is a hard ban — and somebody who comes back in a month to collect on it finds out
they were being managed. It gets its own state now: *"open chat isn't a thing I do. give me a real
situation, or something you couldn't say."* The no still names what we do take, because teaching
what to say is this screen's whole job.

It is still recorded on the way past. How many people ask for open-ended chat is worth knowing
precisely *because* we are refusing them.

### Told apart by example, never by a keyword list

The obvious implementation is a list — *"how do I say"*, *"what's the word for"*. It would miss
*"I never know what to say when someone asks how I am"*, which is a phrase question with none of
those words in it, and fire on *"the woman at the bakery asked me something and I couldn't work out
how to say I was just looking"*, which is a moment. The date guard in `/api/event-plan` paid for
that lesson already: a word list scanning a whole sentence is wrong in both directions at once.

Both of those cases are now worked examples in the prompt, and both are in the test. So is the
precedence rule: *"I couldn't say I'll take care of it at the pharmacy today"* is both a moment and
a phrase, and **the moment wins** — a situation carries a person, a place and a reason, and the
phrase can be reached from inside it.

29 sentences against the live router, all passing.

### The chain behind a question

```
"how do I say I'll take care of it"
  → 1-3 real options, each with when to use it        /api/lifeline
  → "now say it."  →  they produce it out loud        ← this IS the attempt
  → a real rescue                                     /api/rescue
  → the phrase is kept, with a date to come back      word_bank
  → "use it for real"  →  a scene                     /api/variation → /api/converse
```

**The say-it-back is not a flourish.** `/api/converse` refuses to start without a rescue and a
rescue needs an attempt — the same wall #30 had to get over. Here it is cheap, because the thing
normally missing is already present: `originalText` is literally what they asked for. And it is
the product thesis in two seconds. Knowing a phrase and producing it under pressure are different
things; a screen that stops at the answer is a dictionary, and dictionaries already exist and are
free.

**A room phase, not a sheet.** Overlays close the microphone — that is why the aside is a room
mode — so a say-it-back in a sheet would be a screen that asks somebody to speak and cannot hear
them. All the options show, each with when to use it: choosing between them is most of what
knowing a phrase means, and the in-scene sheet's single option exists only because it is
interrupting a conversation.

**No moment is saved for the ask itself.** Only playing the scene saves one. A thirty-second
lookup is not a session and must not sit in the list next to one.

### The half this is actually for

Days later, in a scene built for something else entirely, the learner lands in a spot where that
phrase is exactly what is needed — and reaches for it themselves. The feeling is **"I know this
one."** Timo's idea, and the reason the rest of it is worth building.

`lib/phrase-recall.ts` is pure and AI-free, the twin of `lib/event-plan.ts`: the model writes
content, deterministic code owns counts and dates. Everything in it stops one specific way this
dies, all of which ship fine and quietly teach nothing:

- **never the same session** — 20 hours minimum after it was asked for, whatever the schedule says
- **not every scene** — at most one, and nothing about two scenes in three
- **not everywhere** — event goes are excluded, and so is the scene straight after a phrase
  question. Dropping an unrelated phrase into a run-up to a real dated evening is the same failure
  as offering somebody a rotation topic next to their own dreaded call. Every caller says yes or
  no explicitly, because a default is how "it fires every time" arrives later without anybody
  choosing it
- **the scene NEEDS it, never says it** — a character that produces it first has handed it back,
  and the learner recognises instead of retrieving
- **unaided or it did not happen** — `assistanceUsed === "none"`, or it is not recorded as landed
- **nothing said beforehand** — announcing it on the way in shows somebody a system instead of
  letting them feel a memory. **Afterwards is the opposite**: *"that's the one you asked me about
  on tuesday — and you just reached for it."*

The measurement is deterministic: accent- and punctuation-blind containment, the same flattening
as `appearsIn` in `/api/event-plan`. The evaluator's own `usedTargetChunk` judges the rescue's
chunk, which here is a different string entirely.

The unit tests found the trap in it. A pattern is stored with its blank in it, and `"quiero ___"`
reduces to the single word *"quiero"* — which appears in a huge share of everything anybody says in
Spanish. A pattern whose stem is under two words is now declined rather than guessed at, because a
phrase wrongly marked as landed never comes back and the learner silently loses it.

### The framing turn, again — and this time the rule is right

Walking through the new `stung` door produced a familiar screen. Somebody who had just said *"I
froze at the pharmacy today and switched to english"* was asked: *"Where do you want to try first
— asking at a pharmacy, or telling someone about your job?"*

That is the same failure reported on the landlord call, and it was already in the shipped
landing-panel path, because the room's `stung` entry asks *"tell me what happened"* first. The fix
for #30 keyed on `mode === "upcoming"`, and `mode` was only ever standing in for **"we already
know what they are practising"**. It now keys on the thing itself: a session whose scenario is
settled before it starts has no framing turn, whatever mode it is in.

Somebody whose whole answer is *"I just froze, I don't know"* still gets the two options — for them
that is the help, not the insult. Six cases pinned in a test, in both directions.

### Needs applying

`supabase/202609070002_phrase_recall.sql` — `'asked'` joins the `source` CHECK, and `word_bank`
gains `due_at`, `resurfaced_count` and `landed_at`. Until it runs, a phrase question still answers
and still becomes a scene; what does not happen is the keeping, and therefore the coming back.
`/api/library`, which the dashboard reads, does not touch the new columns either way, so it cannot
break whether the migration has run or not — the same discipline as `event_id`.

Signed out, the keeping half is off entirely: `word_bank.user_id` is not null against `auth.users`.

## 2026-09-07 — building backward from one real evening (#30)

You say *"dinner at my girlfriend's parents on friday"* at the orb, and the screen lays out four
goes at that specific evening between now and friday, runs them one at a time, and afterwards asks
how it went. Master plan #30, and the last thing on `/dash` that was answering honestly that it
could not be built.

### The wall

Everything downstream of the room hangs on a **rescue**, and a rescue needs an **attempt**.
`/api/converse` refuses to start without one; `moments` has `first_attempt` and `rescue_json` as
not-null columns. A named event has neither — nobody tried to say anything, somebody named a date.

**So the first go IS the intake.** Seeded with what they said and which part of the evening it is,
it produces the rescue, and every go after it starts its scene from that same rescue. That is the
shape `restartSceneFromAside` already used to move somebody who said the situation was wrong for
them, so `startSceneFor` is now shared between the two. Four goes at an evening, one placement.

### Never invent a date

`/api/event-plan` has to quote the words it read the date from, and the server checks the quote is
really in what the learner said and really names a time. Otherwise: null, and an undated event
still gets a plan.

The first version of that guard scanned the whole sentence for time words, and the test caught it
being wrong in both directions — it would have refused *"christmas with her family"* a perfectly
good date and then asked *"when is it?"*, to which the only answer is "christmas" again.

### Two things the live test found that reading could not

**The thinning threw the point away.** An event tomorrow gets two goes, not four, and picking them
by position turned *"I have to call the landlord tomorrow about the heating"* into the hello and
the goodbye — with the complaint the entire call is about dropped out of the middle. The planner
now marks which beat is the one they are dreading, and that one survives first.

**Scenes came back with two people in them** — `"Elena and Carlos"`, `"the bride and groom"`. The
room plays a single character and its own prompt forbids it to switch or rename, so that would
have left it with nobody to be.

### Two things found on the first real run

**The intake offered a choice that had already been made.** Somebody who had just said *"I have
to call the landlord tomorrow"* was asked whether they would rather practise calling the landlord
or telling a friend about their job. Framing exists to pick between two situations, and for an
event there is nothing to pick — so `upcoming` mode has no framing turn at all: turn 0 sets the
scene and `chosenScenario` is settled before the session starts. Structural rather than a line in
the prompt asking it nicely, because the turn machine is what drives that turn.

**You could only start a go by tapping it.** The router was only ever offered the *next* one, so
*"let's do the second one"* quietly fell back to whatever was next. Every remaining go is offered
now, numbered, and the client acts on the index it was handed rather than on what happens to be
next.

### After it happens

*"how did it go?"* is asked once and stored **verbatim and unclassified**: the sentence is the
research, and a label would be the thing we analysed instead of it.

Then one closed question, answered with a tap: *"did you get to say any of it?"* Only a yes moves
the linked moments to `confirmed_real_life`. That rung says *"you used it for real"* and until now
nothing in the app could honestly put anyone on it — it was inferred from a perfect transfer
evaluation, which is practice. Turning up and freezing is not mastery, which is why the question is
asked separately rather than read out of the sentence above it.

### Needs a migration

`supabase/202609070001_events.sql`. Until it is applied, creating an event ends at *"I couldn't
save that one"* rather than in a promise that dies with the tab. Saving a normal moment is
deliberately unaffected: `event_id` is only sent when there is one, so a schema change for a new
feature cannot break saving for everybody else.

The room's own behaviour is unchanged, verified by a full typed run to the closing card and by the
aside's scene change still landing in the right scene with the right person.

## 2026-09-07 — the entry screen says it out loud

You spoke to it and it answered in silence. That is asymmetric, it quietly says the microphone is a
form field, and it contradicts the product's own rule that the AI speaks first — so the read-back is
now spoken as well as written.

I had decided against this, on latency and cost. Both arguments fell over on inspection:

- **`kept` and `unclear` are dead ends.** You stay on the screen, so speaking costs no waiting.
- **`resume` navigates, but the room does not speak on arrival** — it shows the verdict card and
  waits for a tap. And the session survives the navigation, so the read-back plays *across* the
  transition. Zero added latency, and the first thing the module singleton bought that was not just
  hygiene.

### The one real catch

At 4.6 and on both retries the microphone **reopens** straight afterwards. An open mic while the
coach is still audible hears his own voice and starts a turn nobody asked for. So those lines are
awaited, and `voice.speak` resolves on **playback drained** (`output_audio_buffer.stopped`), not on
generation finished. That distinction is the entire reason this needed the session module rather
than a `response.create` sent inline.

### What moved

The playback lifecycle followed the capture into `lib/voice-session.ts`: `speak()`,
`cancelSpeech()`, and the five refs behind them. `realtimeInterruptible` and `realtimeInterrupted`
stayed in `app/page.tsx`, because they are **policy** — the room has closing lines nobody may talk
over, and the entry screen has nothing of the kind. `speakCoachText` is now its orchestration
(static clips, auto-listen, handing the turn back) over the module's primitive.

The room's behaviour is unchanged, verified by a full typed run to the closing card before the entry
screen was touched at all.

### What speaks and what does not

**It speaks when it is responding to something you said, and stays quiet about its own plumbing.**
Read-back, the refusal and its promise, the 4.6 vocabulary, *"take your time."*, *"that came back
garbled."* — all spoken. The idle timeout is silent: nobody said anything to answer, and a voice
from a phone somebody has put down is startling rather than helpful.

A tap always cuts the line and opens the microphone. Talking over a voice interface is the most
natural thing a person does to one.

## 2026-09-06 — the microphone moves to the entry screen

`/api/intent` was built and passing, and nothing fed it. The orb on `/dash` handed off on a *tap*,
and the room then started its own fixed intake — so the header invited someone to describe their
week and the app ignored what they said. That is the failure this whole screen exists to prevent,
rebuilt on a new screen.

Now the orb is a microphone. Tap once, say what you want, and the screen reads back what it
understood before anything happens.

### The microphone could not move alone

Around it in the room sat roughly six hundred lines of guards, each one paid for by a real failure:
VAD profiles, the transcription-language pin, the decoder-loop discard, filler patience, dud
strikes, the noisy-room offer. Copying any of that onto a second screen is how this codebase keeps
producing features that look built and are not. So it moved instead:

- **`lib/voice-guards.ts`** — what an utterance *is*. Pure: it classifies a string and never
  decides what to do about it, because the room mid-session and a learner arriving at the door
  genuinely want different things from the same "that was only um".
- **`lib/voice-session.ts`** — the connection, the microphone, one capture. A **module singleton**,
  not a hook, for two reasons: two screens need it, and it has to outlive a navigation. Going from
  the entry screen into the room unmounts one React tree and mounts another; a connection held in
  refs would die there and cost a second microphone prompt and a second token mint for one
  continuous act. It now survives that gap and the room adopts it.

The boundary is **"get me a transcript"** against **"and then what"**. Speaking — `response.create`,
interruption, waiting for playback to drain — stayed in the room, because only the room has
anything to say. Nineteen refs left `app/page.tsx`; seven stayed.

The room's behaviour is unchanged, and that was verified before any of the entry-screen work
started: a full typed run to the closing card, plus the hand-off.

### What the entry screen does with a sentence

| you say | what happens |
|---|---|
| *"let's do that one"* | resumes that saved moment. The only intent with an engine behind it. |
| *"dinner at her parents on friday"* | read back, then: **I can't build that one yet. I've kept it.** |
| *"how do I say I'll take care of it"* | the same. `talk` came *off* `runnableIntents`. |
| anything it can't place | *"I didn't catch what you want to do"* — and the mic reopens under it. |

Nothing ever proceeds on a guess, and nothing falls through to the default intake behind the
learner's back. The intake is still offered — as a card at the bottom, named, when there is nothing
waiting — because an offer you choose is not the same thing as a fallback you get.

**Keeping the sentence is the point.** `POST /api/kept-scenario` writes it to `analytics_events`,
an existing table that had no writer at all. For the learner it turns a dead end into a promise;
for us it is the corpus the upcoming-event engine needs and does not have — real situations real
people asked for, in their own words.

### Smaller things in the same change

- **A `connecting` state the design did not have.** The first tap mints a token, asks for the
  microphone and does the handshake. Saying "listening…" through that is a lie that gets found out
  in the two seconds it takes, so it says *"one moment — waking the mic."*
- **The signed-out entry screen had a blank header.** It treated "signed out" as "we don't know
  yet". A signed-out visitor is a brand-new learner, which is a state with copy of its own.
- **The bottom band can no longer be empty.** With no saved work and no microphone it was a dead
  screen. There is always either a pick-up card or the intake, offered by name.
- **`lib/use-library-data.ts`** — the `/api/library` loader, which existed twice and had already
  begun to differ in what a failed load meant.
- `audio.playsInline` (not a property of `HTMLAudioElement`) is now `setAttribute("playsinline")`,
  which removes a standing type error.

### Not built, and not pretended

`new_scenario` and `talk` have no engines. The screen says so in their own words and keeps what
they asked for. `runnableIntents` is `["resume"]` and the copy reads from that list, so the two
cannot drift apart.

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

## 2026-09-06 — The router, and a header that teaches what to say

A microphone offers nothing. A text field has a placeholder and a menu has items, but an open mic
leaves the learner guessing what the system understands — and that is where voice products die:
someone says the one sentence it cannot handle and concludes it does not work.

Two halves, shipped together on purpose. See `VOICE_ENTRY.md`.

### `/api/intent` — the router

One sentence in, one intent and one read-back out. Stateless, like `/api/aside`. Four outcomes:
`resume`, `new_scenario`, `talk`, and **`unclear` as a first-class answer** — never a fallback into
the default intake, because silently starting the funnel after someone told you what they wanted is
the "what was the point of telling it my problem?" failure in a new place.

Every server-side downgrade ends in `unclear` rather than a guess: an id we never sent, a resume
with no match, a scenario with no situation, or a confident intent with no read-back. The cost is
asymmetric — a wrong route costs a whole session and the belief that the app listens, while
`unclear` costs one sentence and has copy written for it.

**Two things the first live run exposed.**

The read-back came back a **parrot**: *"how do I say I'll take care of it"* echoed word for word.
That proves we transcribed them, not that we understood them, and it reads as though nobody was
listening. The prompt now carries three worked examples of the compression — *"dinner at my
girlfriend's parents on friday, her mum talks really fast"* → *"friday. her parents. her mum talks
fast."* A concrete example outweighs a rule sitting beside it; this codebase has learned that one
the hard way before.

And **"hmm okay so" was routed as `resume`** — throat-clearing starting a session nobody asked for,
which is the single worst mistake this route can make. The prompt forbids it and the model did it
anyway, so the server decides: an utterance made **entirely** of hesitation, agreement and
discourse glue is refused before it costs a request. Every token has to be in the set, which is
what keeps it safe — `"that one"` survives because neither word is filler, and `"yeah let's do that
one"` survives because most of it is not.

22 sentences against the live route, all passing, including every case that must come back
`unclear` and the two that must survive the guard.

### The header on `/dash`

Above the orb, two lines, always the same two roles: what is true now, and what else you could say.
Written as the words a learner would actually say — *"tell me about friday"* teaches a sentence,
*"you can describe an upcoming situation"* teaches a category and helps nobody.

Three resting states, chosen by the database rather than by a mood: something waiting, nothing
waiting but a history, or nothing at all. The shape never changes, only the content — a header that
is different every visit is a slot machine and nobody learns a vocabulary from one.

**The header must not narrate the card.** The first version read *"'me he perdido' has been waiting
4 days"* directly above a card saying *"WAITING 4 DAYS / me he perdido"*. One message, two elements,
on the screen least able to afford it. It now names the phrase — a bare "that one" needs a referent
— and spends the rest of the line opening the door to saying something else, which is the half the
card cannot do and the whole worry this screen exists for.

### Layout

The pick-up moved to the bottom as a full card, in thumb reach: it is the retrieval loop, which is
the memory proof and the thing no competitor has, and a quiet line would have buried it. Account
button bottom-left. The journey line and the three counts are gone — they live on `/dashboard`, and
on this screen every element has to beat something already on it. Still fits four viewport sizes
with no scroll; the orb now scales 240px to 340px.

### Not built

The orb still hands off on a **tap**, not on speech, and the router is therefore not yet fed by
anything. The mic, the WebRTC session and the capture guards all live in the room. Where the spoken
sentence comes from is the next decision.

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
