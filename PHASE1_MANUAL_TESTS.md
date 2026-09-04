# Phase 1 — Manual Test Checklist

Phase 1 changed the interaction model: the mic now stays open while it is the learner's turn
(`micMode: "open"`, the default), controls appear only once they're relevant, and the orb finally
looks inert when it can't be pressed.

**Almost none of the voice work can be tested without a real device.** Headless Chromium has no
microphone, so the automated run only proves the typed path still works. Everything below needs a
phone or a laptop with a real mic.

## Already verified automatically — don't re-test these

Confirmed in a browser against the live dev server: the ready-state label shows one instruction
instead of two; session one shows only the orb and `help`; the English translation is hidden by
default with a visible "what that means" affordance that expands on tap; the help ladder shows real
per-turn content (`la cuenta` / `¿Me trae ___, por favor?`) instead of the old hardcoded samples;
and the full landing → coach → verdict → session flow still completes.

## 1. Just start talking (the whole point of Phase 1)

- Get to a session turn. **Do not touch the orb.** Start speaking.
- **Expect:** the room switches to "listening" on its own, your words are captured, and the turn
  proceeds. The label should read "just start talking", never "tap the orb to speak".
- Say something very short ("sí", "gracias"). **Expect:** still captured. A short reply must not be
  treated as noise.
- Tap the orb instead of speaking. **Expect:** still works — the tap is kept deliberately, and it
  is the only path when the mic is asleep or permission was denied.

## 2. The mic's own limits

- Reach a turn, then say nothing for ~10 seconds.
  **Expect:** the turn ends but the mic stays armed — you can still just start talking. It must NOT
  print "tap the orb whenever you're ready" in open mode.
- Now leave it alone for two minutes.
  **Expect:** "mic went to sleep. tap the orb when you're back." A tap wakes it.
- This cutoff is a deliberate trust boundary, not a bug. An indefinitely hot mic is not something to
  ship quietly.

## 3. Noisy room adaptation

- Somewhere with real background noise (TV, café, traffic), let two captures in a row come back
  empty.
- **Expect:** once per session, a "switch to hold-to-talk" button appears with a note that
  headphones help. Tapping it restores the old tap-to-talk behaviour completely.
- **Expect:** it does not appear a second time in the same session if dismissed.
- **The two-strike threshold is invented.** If it fires too eagerly (or never fires when it
  obviously should), that number needs tuning — see `registerDudCapture` in `app/page.tsx`.

## 4. The rollback — test this before trusting anything else

- In the noisy-room offer, choose hold-to-talk (or set `localStorage["outloud-mic-mode"] = "push"`
  and reload).
- **Expect:** behaviour identical to before Phase 1. Mic closed until you tap, tap again to finish,
  all copy back to "tap the orb…".
- This is the single-value rollback for the entire voice change. If it does *not* reproduce the old
  behaviour, that's the most important bug to report.

## 5. Echo and self-interruption

The mic is never armed while the coach is speaking (that's Half B, not built yet), so the coach
should never cut itself off. Worth confirming anyway, because it's the failure mode that would
destroy trust fastest:

- Listen to a full coach line on **speakerphone at real volume**, in a quiet room, without speaking.
- **Expect:** the coach finishes its line. It must not interrupt itself or report "nothing came
  through".
- Repeat on an iPhone specifically. iOS Safari echo cancellation is the worst case and cannot be
  simulated.

## 6. Pressure Mode actually reaching the VAD

Phase 0 wired the Pressure Mode buttons, but the value was frozen into the realtime token at
connection time, so switching mid-session changed nothing. Phase 1 pushes it over the open channel.

- Mid-session, open the profile → "how she speaks" → "under pressure".
- **Expect:** the coach starts allowing less silence before ending your turn, and may throw a
  curveball follow-up on the second conversation turn. Compare against "real person" on a second
  run — it's a nudge to the model, not a hard rule, so don't expect it every single time.

## 7. Real audio conditions (roadmap #16 / #37)

Not yet done at all, and flagged in the roadmap as a P0. Worth a dedicated pass:

- In a car, engine running, phone in a cradle.
- With AirPods / any Bluetooth headset.
- With background music or a second person talking nearby.
- With a strong regional accent, and with deliberate English/Spanish code-switching mid-sentence.

Each one should either work, or fall back gracefully via the noisy-room offer — never score garbage
and never silently do nothing.

## What is NOT built yet

**Voice barge-in (interrupting the coach by talking over it) is not implemented.** Interrupting
still requires tapping the orb. That was a deliberate staging decision: it's the only part of
full-duplex exposed to echo, and its failure mode — the coach cutting itself off and then blaming
the learner — is worse than the tap it replaces. It needs section 5 above to pass on real hardware
first.
