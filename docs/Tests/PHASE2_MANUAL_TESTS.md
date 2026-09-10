# Phase 2 — Manual Test Checklist

Phase 2 makes the problem the learner *states* visibly drive what they see. Three things changed:
the blocker is now classified by the coach instead of guessed by a regex, the verdict headline is
written from evidence instead of hardcoded, and every session names its focus at the top.

## Already verified automatically — don't re-test these

Confirmed against the live dev server, end to end: the coach returns a `selfReportedBlocker` on the
framing turn only (`null` on all seven turns after it), the value reaches `/api/rescue` intact, the
verdict headline is generated per run, the supporting evidence renders when the verdict complicates
what the learner said, and the focus line renders exactly once per session.

The four verdict branches were probed directly against the real model:

| stated | evidence | result | behaved |
|---|---|---|---|
| missing words | hesitation, "como se dice" | `confirm` | agreed, no invented contradiction |
| pronunciation | tense errors, clear sound | `both` | named what it saw, showed evidence |
| a goal, not a blocker (`not_sure`) | a clean sentence | `confirm` | did not invent a hypothesis |
| grammar | nothing said at all | `not_enough` | refused to judge |

## 1. The classification is right for *you*

The old regex could only ever return "missing words" or "not sure", so six of the eight blockers
were unreachable and most people were filed as "not sure". This is the fix, and it is the one thing
everything else reads.

- Run the opening five times, each time naming a different problem out loud: words going missing;
  freezing when asked something unexpected; grammar falling apart; being hard to understand; knowing
  the words but not being able to build a sentence.
- **Expect:** the coach's framing line names *that* problem back to you, in its own words.
- **Expect:** the session focus line (see 3) matches what you said, until real evidence overrides it.
- Now answer with something vague on purpose — *"I just want to talk to my girlfriend's family."*
  **Expect:** it does **not** guess a blocker. That is a reason, not a blocker, and inventing one
  there fabricates the exact thing this flow exists to learn.

## 2. The verdict — the highest-stakes sentence in the app

The headline used to be one hardcoded sentence shown to everyone: *"you have enough Spanish. the gap
is getting it out fast enough."* It is now written from what you said versus what happened.

- **Expect:** it names your stated problem and what actually showed up, in one short lowercase line.
- **When it agrees with you**, the line should read as agreement. It must not say "you said X, *but*
  …" and then show nothing to back that up.
- **When it contradicts or complicates you**, a second grey line appears underneath with the actual
  evidence — a quote or a concrete description, addressed to you as "you".
- **The thing to watch for, and to report immediately:** a verdict that tells you your own read was
  wrong when it wasn't. The model is instructed to choose "both" over "correct" whenever it is
  unsure, and never to manufacture a contradiction to look perceptive. A wrong *"actually it's X"*
  lands at the exact moment you are deciding whether to trust the app, and it does not recover.
- Try skipping the attempt entirely. **Expect:** it says plainly that it cannot check your
  hypothesis until you try once. It must never confirm or correct a blocker it did not observe.

## 3. The focus line

- Start a session. **Expect:** one quiet line at the very top, above the orb — *"today: the words
  that go missing"* — and nothing else new.
- **Expect:** it never appears during the opening or the coach flow, only in a real session, and
  never while a card or overlay is open.
- **Expect:** it reads as a label, not an instruction. If you find yourself trying to tap it, that's
  a bug worth reporting.
- Run two sessions with different problems. **Expect:** the line differs.

## 4. Old data still works

`stated_vs_observed` did not exist until now, so every moment saved before today lacks it.

- Open a verdict restored from before this change (or sign in via Google mid-verdict, which round
  trips the card through `localStorage`).
- **Expect:** the old hardcoded sentence appears as the fallback, and nothing crashes or blanks.
- **Expect:** the delayed retrieval email still goes out for older moments. This is the one that
  fails *silently* if it fails at all — the schema is read-lenient specifically to prevent it.

## 5. Help that matches your gap (#48)

The ladder used to show everyone the same five rungs in the same order. The order now comes from
the diagnosed blocker.

- Run two sessions where you name different problems, and open `help` in each.
- **Expect:** the order differs. Words going missing puts KEYWORD first; a sentence that will not
  assemble puts FRAME first; freezing puts AGAIN first; pronunciation puts SLOWER first.
- **Expect:** one sentence underneath saying why, in the app's voice — *"your opening is fine; the
  follow-up is what breaks."*
- **Expect:** the order does not change between turns of the same session. It is keyed to the
  session's diagnosis, not to the last thing you said.
- The rungs still are not tappable. That was true before this phase too.

## 6. The callout (#49) — and what it must never claim

One spoken line, once per session, after two clear replies in a row where you reached for nothing.

- Answer two turns in a row correctly without touching anything.
  **Expect:** *"twice in a row now — and you didn't reach for help once."*
- **Now the important half.** Do the same, but tap **"what that means"** on each turn to read the
  English.
  **Expect:** no callout. Reading the subtitle is reaching for help, and the line would be false.
- Same again but tapping `help`, `fix`, `pronounce`, `ask`, "hear again" or "slower".
  **Expect:** no callout on that turn.
- **Expect:** it never appears twice in one session, and never on the closing turn.
- **Report immediately if it ever fires after you used something.** The whole value of the line is
  that it is true.

## 7. The profile actually showing your dimension (#50)

- Finish a session and open **"what OutLoud knows about you"** at the bottom of the end card.
  *(That entry point is new. The card and the evidence card behind it used to open only each
  other, so neither was reachable at all.)*
- **Expect:** the first row is the same dimension as the "today:" line above the orb, marked
  "working on it now". If those two disagree, that is a bug.
- **Expect:** rows only for dimensions actually observed. No row should say "finding out what
  actually trips you up — seen today"; that is the absence of a finding, not a finding.
- **Expect:** the focus row's evidence includes how today went — *"2 of 3 replies came out clear
  today."*
- On **/profile**, with at least four saved sessions: a trend line comparing your recent sessions
  to the ones before. Below four sessions it says nothing, on purpose — two versus two would turn
  one good day into a trend.

## What is NOT built yet

Phase 2 is complete. Open items live in other phases — see `outloud-master-build-plan.md`.
