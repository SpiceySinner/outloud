# Phase 3 — Manual Test Checklist

Phase 3 turned out smaller than the roadmap suggests in one place and larger in another. **#8 was
already built** — the adaptive coach replaced the three hardcoded placement questions some time
ago, and nothing in the codebase still asks "what did you do yesterday after work?". And **#44 was
not a prompt problem at all**; see section 4.

## Already verified automatically — don't re-test these

Against the live dev server: the coach names a person on the scenario turn and returns them as
structured data (`{ name: "Ana", relation: "close friend", traitEn: "very chatty and curious,
always asking unexpected questions" }`), that person is carried into the practice session instead
of the old `"an OutLoud Spanish coach"`, the room shows "with Ana — close friend" for the whole
session, and the coach's spoken line came in at 7 words.

## 1. Who is in the room (#29)

- Run the opening and pick a direction. **Expect:** the coach introduces a named person with one
  trait that makes them hard — *"this is Marco behind the counter, friendly, but it's lunchtime and
  there are five people behind you."* Not a role alone ("the waiter"), not a name alone.
- **Expect:** a small "with Marco — the barista" line at the top of the room, and it stays there
  for the whole session.
- **Expect:** the name keeps its capital letter. The product writes in lowercase; a person's name
  is not the product's voice.
- **Expect:** the character does not change identity mid-session, and does not drift back into
  being a neutral tutor after a few turns. **That drift is the thing to watch for** — it is the
  failure mode this item exists to prevent, and it is a prompt instruction, not a hard guarantee.
- Run it three times with different opening answers. **Expect:** different people, and each one's
  trait should press on the problem you named. In testing, a learner who said they freeze at
  unexpected questions got a character described as "always asking unexpected questions" — that is
  the item working exactly as intended.

## 2. Practice as many times as you want (#38)

The pronunciation retry used to stop you after two tries and say so: *"two tries max."*

- Open `pronounce` and fail the same word four or five times in a row.
- **Expect:** it never cuts you off. After the second try a quiet "that's enough for now" appears —
  an offer, not a decision.
- **Expect:** the note under the button now reads "go as many times as you want."
- **Expect:** "that's enough for now" returns you to the conversation cleanly, exactly like the old
  automatic stop did.

## 3. The coach stops talking so much (#14)

- Play a full session and pay attention to who is speaking longer.
- **Expect:** each coach line is one idea and under ~20 words. No line that reacts, explains and
  asks a question all at once.
- **Expect:** the coach never explains your Spanish back to you mid-conversation. That belongs in
  `fix` and the verdict, not in the character's mouth.
- This is a prompt instruction, so it will hold most of the time rather than always. **Report lines
  that ramble** — the counting is the whole point of the item.

## 4. The account truth (#44, reframed)

The roadmap filed this as "reference their history out loud" — a prompt fix. The actual feedback
was someone coming back and the app not knowing them, and the cause was mechanical: **everything a
learner does is saved with their email and `user_id: null`, but reading any of it back goes through
authentication.** Without an account the practice sits in the database, unreachable, and OutLoud
greets a returning learner as a stranger. The after-card even asked *"want me to bring this back
tomorrow?"* next to an email box — a promise an email alone cannot keep.

- Finish a run **signed out**. **Expect** on the verdict card: "nothing here comes back on its own.
  an account is what lets OutLoud remember you", the reason the line is drawn at a login, and the
  promise that signing up on the same address brings across what you already saved.
- **Expect** the email fallback to say what it actually does — a link to *this* session — and to say
  plainly that it won't know you next time.
- **Expect** the same message at the end of every session, not only on the first verdict.
- **Now test the promise, because it is a factual claim the code has to keep:** save a run with an
  email while signed out, then create an account with that same address. **Expect** the earlier run
  to appear in `/dashboard`. That claim rests on one line in `app/api/library/route.ts` which
  claims `user_id: null` rows by email on first load. If it does not work, the copy is lying and
  that is worse than saying nothing.

## 5. The coach reacting to how it is going (#44, in-session half)

The route used to receive only the raw attempt text and a boolean, so the character answered in the
same pleasant register whether the learner nailed it or dodged. It now gets two separate things:
the **settled** evaluations of earlier turns, and **measurements** of how the current reply came
out (pause before speaking, hesitations, English leakage, what they reached for).

- Answer three or four turns well without touching help. **Expect:** the character gets warmer and
  more specific as it goes, not uniformly pleasant. A run of clean replies should sound noticed.
- Now lean on `help` and the model answer for two turns running. **Expect:** it stops
  congratulating, and the next questions get smaller and more concrete rather than harder.
- Speak an answer with a long pause before starting. **Expect:** it may acknowledge that you pushed
  through — *delivery* — and nothing more.
- **The line it must never cross:** the character must never say your Spanish was right, good or
  correct on the strength of the current turn. That reply has not been evaluated yet when the line
  is generated. Praise of correctness may only reference earlier turns.
- **Report any "¡perfecto!" that lands on a wrong sentence.** That is the exact failure Phase 0
  removed everywhere else, and this is the one place it could come back.
- Type your answers rather than speaking them. **Expect:** no reaction to pauses or hesitation —
  there were none to measure.

## 6. The repair loop (#44, now switched on)

The character can now admit it did not understand, instead of answering smoothly over a reply a
real person would not have caught. This was written on the server long ago and unreachable: the
client always sent `repairRequested: false`, and the `lib/repair-loop.ts` both it and
`lib/types.ts` named as the decision's source did not exist.

- Say something genuinely unintelligible — half English, a fragment, a false start.
  **Expect:** warm, in-character confusion, in Spanish: *"¿Cómo? No te entendí, ¿puedes decirlo de
  otra forma?"* Not a correction, not a lesson, not a switch to English.
- **Expect the guidance under it to give you nothing.** No Spanish, no pattern, no frame — just
  "try saying it a different way". Repairing your own meaning is the skill being trained; handing
  you the phrasing removes it. *(The model broke this rule on first testing and the instruction had
  to be hardened. Report any Spanish that appears there.)*
- Do it twice in a row. **Expect:** only the first triggers confusion. Two "¿cómo?" back to back
  stops reading as a person and starts reading as a broken app.
- **Expect the repair not to cost you a turn.** The session budget is 4–8 exchanges; a
  misunderstanding is pinned to the same turn index and does not consume one.
- Ask for the model answer, then say it back badly. **Expect no repair** — a character that cannot
  understand its own model answer reads as blaming you.
- **The case that matters most:** speak in a noisy room so the transcript comes back unreliable.
  **Expect no repair.** A bad transcript is our failure, and the evaluator deliberately returns
  "insufficient evidence" for it — turning that into "I didn't understand you" would hand you the
  blame for our microphone. Report it immediately if the character ever does.

### The cost, measured

Turning this on required the evaluation of your reply to finish *before* the coach's line is
generated, where the two used to run in parallel. Measured over four session turns each, same
scenario, same machine:

| | parallel (before) | serialized (now) |
|---|---|---|
| turn, send → your turn again | 6.1 s | **8.2 s** |
| `/api/evaluate` | 2.4 s | 2.4 s |
| `/api/converse` | 3.7 s | 3.3 s |

**Roughly +2.1 s per turn, about a third slower.** The endpoints themselves did not change; the
wait is the evaluation no longer overlapping. Worth feeling on a real device before accepting: if
8 seconds reads as dead air in a spoken conversation, the trade is wrong and the parallel version
is one small change away.

## What is NOT built

Nothing from Phase 3 is outstanding.

The roadmap's own advice after this point is to stop building
and put the link in front of strangers — Phases 4–6 should be ordered by what real users complain
about, not by the document.
