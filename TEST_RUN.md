# One test run — everything to check, in order

Consolidates `PHASE0_MANUAL_TESTS.md` … `PHASE3_MANUAL_TESTS.md`. Those stay for the reasoning
behind each item; this is the version to actually work through. Ordered by blast radius, not by
phase: the two checks that can invalidate other work come first.

**Setup:** a real phone, the dev server reachable from it, `OUTLOUD_MOCK_AI` **not** set to `true`.
Everything below needs a real microphone — none of it could be automated.

Roughly 35 minutes for blocks 1–3.

---

## Block 1 — Do these two first (~5 min)

If either fails, stop and tell me before running anything else.

### ☐ 1.1 The voice rollback

Set `localStorage["outloud-mic-mode"] = "push"` in the browser console and reload.

**Expect:** behaviour identical to before any of this work. Mic closed until you tap the orb, tap
again to finish, all copy back to "tap the orb…".

> This one value is the rollback for the entire voice change. If it does not reproduce the old
> behaviour, that is the most important bug in the project right now — everything else in Block 2
> is riding on it being a safe exit.

Set it back to `"open"` (or clear it) before continuing.

### ☐ 1.2 The account claim

The end cards now tell people: *sign up with the same address and everything you already saved
comes with you.* That is a factual claim about the database, and it is the one thing I could not
verify.

1. Signed **out**, finish a run and save it with an email address.
2. Create an account with **that same address**.
3. Open `/dashboard`.

**Expect:** the run you saved before signing up is there.

> If it is not, the copy is lying to users and has to come out today. It rests on one line in
> `app/api/library/route.ts` that claims `user_id: null` rows by email on first load.

---

## Block 2 — One natural run on the phone (~10 min)

Just play through, using your voice the whole way. Notes are in the order you will meet them.

### ☐ 2.1 Just start talking

Reach a turn and **do not touch the orb**. Start speaking.

**Expect:** the room switches to listening on its own and captures you. The label reads "just start
talking", never "tap the orb to speak". Tapping the orb must still work too.

Say something very short — "sí", "gracias". **Expect:** still captured. A short reply is not noise.

### ☐ 2.2 Who is in the room

**Expect:** the coach introduces a named person with one trait that makes them hard — *"this is
Marco behind the counter, friendly, but it's lunchtime and there are five people behind you."* Not
a role alone ("the waiter"), not a name alone.

**Expect:** a small "with Marco — the barista" line at the top, all session, with the name
capitalised. **Expect:** they do not drift back into being a neutral tutor after a few turns —
**that drift is the failure mode to watch for.**

### ☐ 2.3 The verdict

**Expect:** it names *your* stated problem against what actually happened, in one short line — not
the same sentence every run.

**Expect:** when it contradicts or complicates you, a second grey line underneath with the actual
evidence, addressed to you as "you".

> **Report immediately:** a verdict that tells you your read was wrong when it wasn't. It is
> instructed to choose "both" over "correct" whenever unsure, and never to invent a contradiction.

### ☐ 2.4 The focus line

**Expect:** one quiet line at the very top — *"today: the words that go missing"* — only during a
real session, never during the opening, never while a card is open.

**Expect:** it does **not** change between turns of the same session.

### ☐ 2.5 English behind a tap

**Expect:** the translation is hidden with a visible "what that means" affordance, and expands on
tap. Instructions ("say this back once…") must always stay visible — only translations fold.

### ☐ 2.6 The help ladder

Open `help`.

**Expect:** the rung order matches your diagnosed problem — missing words puts KEYWORD first, a
sentence that won't assemble puts FRAME first, freezing puts AGAIN first, pronunciation puts SLOWER
first. Plus one sentence underneath saying why.

**Expect:** real content from *this* turn, not invented examples.

### ☐ 2.7 The callout — and the lie it must never tell

Answer two turns in a row correctly **without touching anything**.

**Expect:** *"twice in a row now — and you didn't reach for help once."* Once per session, never on
the closing turn.

Now do it again but tap **"what that means"** each turn. **Expect: no callout.** Same with `help`,
`fix`, `pronounce`, `ask`, "hear again" or "slower".

> **Report immediately** if it ever fires after you used something. The whole value of that line is
> that it is true.

### ☐ 2.8 Practice as many times as you want

Open `pronounce` and fail the same word four or five times.

**Expect:** it never cuts you off. After the second try a quiet "that's enough for now" appears — an
offer, not a decision. The note reads "go as many times as you want."

### ☐ 2.9 The end card

**Expect:** "what OutLoud knows about you" at the bottom. Open it.

**Expect:** the first row is the same dimension as the "today:" line — if they disagree, that's a
bug. Rows only for things actually observed; nothing saying "finding out what actually trips you up
— seen today".

### ☐ 2.9a Explain yourself instead of answering

The most human thing a learner does, and the thing that used to break worst.

When you are asked to say something in Spanish, **don't**. Explain in English instead — what you
would try, and why you can't. Mention two or three real things from your day.

**Expect:** the coach hands you the words for **the things you just named**. If you said programming
and a steak, you should get *"programé"*, *"comí un bistec"* — not a generic phrase from the scene.

> **Report immediately** if it answers with **"¿cómo?"** or any kind of confusion. You spoke clear
> English; playing confused at it is the most alienating thing it can do, and it was doing exactly
> that.

Now say **"no idea honestly"**.

**Expect:** it teaches. A word, a frame, or a way in — every time.

> **Report immediately** if you get *"perfecto"*, *"muy bien"*, *"¡qué rico!"* or any reaction to
> something you did not say. Reacting to content that does not exist is worse than being unhelpful.

**Expect:** it never asks a fresh question that leaves you exactly as stuck as you were.

Then the opposite, to check the guard: answer a Spanish question with **"no sé"** — a real, correct
Spanish answer. **Expect** it to be taken as an answer and the conversation to continue, **not** as
you asking for help.

### ☐ 2.9b Who is asking whom

Pick a scenario where **you** want something from them: asking directions, ordering, a price, a
favour. Then ask for it — *"¿dónde está el museo?"*

**Expect:** they **answer**, with a real invented detail — *"está a dos cuadras, junto al parque"* —
and only then, maybe, a short follow-up.

> **Report immediately** if they hand your question back, or ask you the thing you just asked them.
> That was the bug behind both the library and the museum reports, and it lived in two places at
> once, so it is the one most likely to return.

**Expect** their very first line not to be your own practice sentence said at you. In a scene where
you are the one who wants something, they should open like someone who has just been approached —
*"¿sí, dime?"* — and wait.

Then check the opposite shape: a scenario where **they** lead (telling a friend about your
weekend). **Expect** them to still open with a real question — *"¿qué hiciste el fin de semana?"* —
and not with "how can I help you".

**Expect:** a small slip that still makes sense — *"la museo"* instead of *"el museo"* — does not
stop the conversation. A real person answers. It should show up later as evidence, not as a drill.

### ☐ 2.10 Does the coach let you talk?

Subjective, but it is the point of the product.

**Expect:** each coach line is one idea, under ~20 words. No line that reacts, explains and asks a
question all at once. It should never explain your Spanish back to you mid-conversation.

**Expect:** the reply takes about 8 seconds. That is the repair loop's cost, measured — if it reads
as dead air, say so and I will put it back to ~6.

### ☐ 2.11 Stepping out of the scene

The one part of this that has never been spoken aloud — every check below was verified typed, in a
headless browser, with no microphone. **The voice half is unverified.**

Mid-session, tap **"hold on — can we talk?"**.

**Expect:** the scene disappears and the room changes: a small "stepped out — the scene is on
pause" line, no "with Marco" header, no help/fix/pronounce row. The coach asks **one** question, in
English, and **makes no offer on this first turn**.

**Expect the coach to actually speak it in English** — not English read with a Spanish accent, and
not translated into Spanish. *(The realtime bridge used to be told "speak the exact Spanish text".
It now says to speak each line in the language it is written in, but no English line has ever gone
through a real connection. If this comes out wrong, that instruction is why.)*

**Expect:** you can just talk — no tap needed — and it is transcribed as English, not as mangled
Spanish. Watch the log for `transcription language -> en`.

Now tell it something real. Three things must hold:

1. **It listens before it fixes.** Turn one is a question, never a plan. If it answers your first
   sentence with a solution, it has pattern-matched instead of listening.
2. **It lands by about the third turn** with one button, not five.
3. **Never a Spanish lesson in here.** No Spanish words, no patterns, no rehearsing the line you
   were stuck on. You left that behind on purpose.

Now try each of the three endings:

**Say the situation is wrong for you** — *"ordering coffee isn't my problem, it's my girlfriend's
family at dinner."* **Expect:** an offer to change the scene, and after tapping it, a **new named
person** and a first line that belongs to the **new** place.

> **Report immediately** if the new scene's first line mentions the old one — a menu, an order, the
> thing you were buying. That exact bug was found and fixed twice and it is the most likely one to
> come back.

> Also report if the new person is *nicer* than the old one. A new scene is a different situation,
> never an easier one, and the model's instinct is to "help" by making everyone patient.

**Say the difficulty is wrong** — *"it's not that I don't know the words, I just freeze."*
**Expect:** an offer to change the focus, not the scene. After taking it, the **"today:" line at
the top changes** to match, and the `help` ladder reorders (freezing puts AGAIN first).

**Say nothing needs changing** — *"nothing really, I'm just tired, let's keep going."* **Expect:**
"back to the conversation", and nothing changes. **It must not invent a scene change.** Being heard
and carrying on is a real outcome.

In all three: **expect the character's line to be spoken again** when you come back — you have been
away in another language and dropping you onto a silent Spanish sentence loses the thread. And
expect to be on the **same turn** you left, with nothing lost.

**Expect:** "back to the conversation" always works, including while an offer is on screen.

### ☐ 2.12b Stepping out of the getting-to-know-you

**Do this one first — it is where the last test broke.** It happens before any session, so you
reach it in about a minute.

During the coach's questions, tap **"hold on — can we talk?"**. The chip is now there too.

**Expect:** the badge reads "stepped out — we can pick this up again", **not** "the scene is on
pause". There is no scene yet.

Tell it you are a beginner — *"I can't remember any vocabulary, I'm completely new, I can't make a
sentence at all."*

**Expect:** an offer like **"start from zero"**. Taking it throws the conversation away and asks
again from what you just said. The coach's next question should be built on being a beginner, not
on whatever it had decided before.

**Expect: no offer to change the scene.** There is no scene yet, and the server blocks it even if
the model asks for one.

Then say the opposite in a fresh run — *"just nervous for a second, it's fine, let's keep going."*
**Expect:** "back to where we were", nothing changed.

> **Report immediately** if a button promises a change and nothing changes — especially "focus
> on X" where X is already the "today:" line. That was a real bug and the guard against it is
> server-side; if it comes back, the guard is not firing.

### ☐ 2.12c The way out of the confirm box

**Completely untested — the confirm box only appears on a suspicious spoken transcript, so no
automated run can reach it.**

Answer a turn where Spanish is expected entirely in English — say something real, like that you
don't know any Spanish yet. You should land in the **"here's what I heard."** box.

**Expect:** underneath "start over" there is now **"that's not the problem — can we talk?"** which
takes you straight into the aside.

> Without that link the box is a trap: it asks you to correct a transcript that was perfectly
> right, and everything else in the room is hidden behind it.

### ☐ 2.12 The room offering it first

Give two replies in a row that are heard clearly but make no sense — real speech, real transcript,
wrong Spanish. Or answer a Spanish turn in mostly English.

This works in both phases now, but off different signals: during a session it reads the real
`/api/evaluate` verdicts; during the intake there is no evaluator, so it counts Spanish-expected
turns that came back English or broken. Two in a row, either way.

**Expect:** once per session, *"step out and talk about it"* with the note that the scene waits.
Taking it opens the aside with the coach acknowledging it wasn't going smoothly, rather than asking
why you walked out.

**Expect:** "keep going" dismisses it and it does not come back.

> **Report immediately** if this appears at the same time as the "noisy room?" offer, or instead of
> it. They answer different problems and share no counter on purpose.

> It should also **not** fire when the app is simply broken — if `/api/evaluate` is failing, that
> is our outage, and stepping out cannot fix it.

---

## Block 3 — Deliberately break it (~10 min)

### ☐ 3.1 Say nothing

Hold the orb, dead silence for ~2 seconds, release.

**Expect:** "nothing came through." No scoring, no confirm box, **no praise**.

Repeat but mumble inaudibly. **Expect:** the same, or the confirm box with a garbled transcript.

### ☐ 3.1b Think out loud

Reach a turn, say **"um…"** and then stop and think for a few seconds.

**Expect:** *"take your time."* and the mic **reopens on its own** — no confirm box, no "here's what
I heard", nothing asking you to fix a transcript that was right. You should be able to just carry
on speaking when the thought arrives, and it should feel like it is waiting longer than usual.

Do it three times in a row. **Expect:** after the second, the room hands the turn back with
"whenever you're ready — or type it if that's easier" and stays open. It must **not** offer
hold-to-talk — nothing is wrong with the room.

Now the thing that would be worse than the original bug: answer a yes/no question with just
**"mhm"** or **"mm"**.

> **Report immediately** if that gets treated as hesitation. It means yes. Swallowing it discards a
> correct answer, which is worse than the confirm box ever was.

Same for a short real answer that starts with a filler — **"um, el museo"**. That must go straight
through as an answer.

### ☐ 3.1c The repeating transcript

Hard to trigger deliberately — it comes from being cut off mid-sentence — so mostly this is a thing
to watch for rather than to provoke. Speaking a long sentence with a pause in the middle, in a room
with some noise, is the best way to invite it.

**Expect:** if a transcript ever comes back as the same phrase over and over ("Oh god Oh god Oh
god…"), you never see it. The room says *"that came back garbled — say it once more, I'll wait
longer."* and gives you a longer window.

> **Report immediately** if a repeated phrase like that ever reaches a coach reply, or shows up on
> the closing card as something you said. Being quoted saying something you never said is the worst
> thing this app can do to you.

The flip side matters just as much: **stutter on purpose.** *"yo yo yo quiero un café"*, or
*"no, no, no gracias"*. **Expect** those to go through as normal answers — they are how people
actually talk.

### ☐ 3.2 Say something unintelligible

Half English, a fragment — *"the uh how do you say the thing with and want is"*.

**Expect:** warm, in-character confusion in Spanish — *"¿Cómo? No te entendí, ¿puedes decirlo de
otra forma?"* Not a correction, not a lesson, not a switch to English.

**Expect the guidance under it to give you nothing** — no Spanish, no pattern, just "try saying it a
different way". *(The model broke this rule once already and the instruction had to be hardened.)*

Do it twice in a row. **Expect:** only the first triggers confusion.

### ☐ 3.3 The one that matters most

Speak in a genuinely noisy room, so the transcript comes back unreliable.

**Expect: no repair turn.** A bad transcript is our failure, and turning it into "I didn't
understand you" hands you the blame for our microphone.

> **Report immediately** if the character ever blames you for bad audio.

### ☐ 3.4 The transcript confirm

Say a clear sentence. **Expect:** if a confirm box appears, it reads "here's what I heard." with
your text editable. Edit it to something different and send. **Expect:** the *edited* text is what
gets scored — check the next coach line or the transcript sheet.

**Expect:** the confirm box does **not** appear after every ordinary turn. Only on suspicion.

### ☐ 3.5 Noisy room adaptation

Somewhere with real background noise, let two captures in a row come back empty.

**Expect:** once per session, a "switch to hold-to-talk" offer with a note that headphones help.
Tapping it restores the old behaviour completely. It must not reappear if dismissed.

> The two-strike threshold is invented. If it fires too eagerly or never fires when it obviously
> should, that number needs tuning.

### ☐ 3.6 Mic limits

Reach a turn and say nothing for ~10 seconds. **Expect:** the turn ends but the mic stays armed —
you can still just start talking.

Leave it two minutes. **Expect:** "mic went to sleep. tap the orb when you're back." A tap wakes it.

### ☐ 3.7 Echo — iPhone specifically

Listen to a full coach line on **speakerphone at real volume**, in a quiet room, without speaking.

**Expect:** the coach finishes. It must not interrupt itself or report "nothing came through".

> This is the gate for voice barge-in, which is deliberately not built yet. If this fails, it stays
> unbuilt.

### ☐ 3.8 Pressure Mode

Mid-session: profile → "how she speaks" → "under pressure".

**Expect:** less silence allowed before your turn ends, and occasionally a curveball follow-up.
Compare against "real person" on a second run — it is a nudge to the model, not a hard rule.

---

## Block 4 — Real conditions (whenever you can)

Flagged in the roadmap as a P0 and never done. Each should either work or fall back gracefully via
3.5 — never score garbage, never silently do nothing.

- ☐ In a car, engine running, phone in a cradle
- ☐ With AirPods or any Bluetooth headset
- ☐ With background music, or a second person talking nearby
- ☐ With a strong regional accent
- ☐ Deliberately switching between English and Spanish mid-sentence

---

## The five that mean "stop and tell me"

Everything else is a bug. These six are broken promises, which is worse:

1. **1.2** — signing up does not bring across what you saved.
2. **2.3** — the verdict tells you your own read was wrong when it wasn't.
3. **2.7** — the callout says you used no help after you used help.
4. **3.3** — the character blames you for audio we failed to capture.
5. **1.1** — the rollback does not restore the old behaviour.
6. **2.11** — you say the situation is wrong for you, get moved, and the new scene asks you about
   the old one anyway. Being moved and then ignored is worse than not being moved.
