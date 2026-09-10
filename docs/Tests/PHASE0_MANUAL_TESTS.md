# Phase 0 — Manual Test Checklist

Everything here needs a real microphone/browser or a deliberate environment change, so it
couldn't be automated this session. Run these against the dev server (`npm run dev`,
`localhost:3000`) with a real headset/mic.

What's already been verified automatically (see the earlier session): TypeScript/ESLint clean,
`/api/transcribe` returns a working `transcriptionConfidence` field against real Whisper output,
`/api/evaluate`'s `lowConfidenceAttempt` flag is correctly enforced by the real model, and the
ready-state label fix is live. The items below are the ones that genuinely need a human with a
microphone.

## 1. Real silence / mumble (#11, #12)

- Start a session, hold the orb, say nothing (dead silence) for ~2 seconds, release.
- **Expect:** "nothing came through. tap the orb to try again, or type." No scoring call fires,
  no confirm box opens.
- Repeat but mumble/trail off inaudibly instead of pure silence.
- **Expect:** same result if VAD never picks up real speech energy. If VAD *does* trigger on the
  mumble, you should instead land in the confirm box (#2 below) with a garbled transcript —
  that's the case worth watching most closely, since it's the one this session's automated
  testing couldn't reach (Whisper hallucinating a word from noise/mumbling requires a real
  noisy recording, not synthetic silence).

## 2. Transcript confirm step (#13)

- Say a clear sentence out loud.
- **Expect:** the box now reads "here's what I heard." with your transcript pre-filled, editable,
  and a "start over" link instead of "try voice again."
- Deliberately edit the text to something different before hitting send.
- **Expect:** the *edited* text is what gets scored/continues the conversation, not the original
  transcript — check the next coach line or the transcript review sheet reflects your edit, not
  what was actually said.
- Send without editing.
- **Expect:** behaves like today's flow, just with the one extra confirm tap.

## 3. Noisy environment (#11, #12, the untested edge case)

- Try a capture with real background noise (TV, music, traffic) while saying nothing yourself.
- This is the case the automated session flagged as unverified: does Whisper hallucinate a word
  from the noise, and if so, does it come back `"borderline"` or `"unreliable"` rather than
  `"reliable"`? Only reachable via the MediaRecorder/`/api/transcribe` fallback path specifically —
  that path only activates when the realtime/WebRTC connection fails, so you may need to block
  WebRTC or the realtime token endpoint to force the fallback and actually exercise it.

## 4. Pressure Mode (#7)

- Get to the profile overlay → "how she speaks" → the pressure sheet.
- Tap all 3 buttons (patient / real person / under pressure); confirm the active-state highlight
  moves correctly and persists if you back out and reopen the sheet.
- With "under pressure" selected, play through to the second conversation turn (turn index 1).
- **Expect:** occasionally a curveball follow-up ("¿por qué?", "¿en serio?", "espera, ¿qué?")
  instead of a mild follow-up. Compare against "real person" mode on a second run to confirm the
  difference is real, not coincidental (it's a guidance nudge to the model, not a hard rule, so
  don't expect it on every single run).

## 5. Mock mode, for fast/free iteration

- Stop the dev server, set `OUTLOUD_MOCK_AI=true` in `.env` (or export it before `npm run dev`),
  restart.
- Re-run any of the above flows — responses are deterministic and instant, no OpenAI cost. Good
  for re-checking #15's independent pronunciation flagging (`lib/mock-ai.ts`'s mock now shows a
  pronunciation target whenever there's a real spoken attempt, regardless of the primary blocker)
  without burning API credits.
- **Remember to set it back to `false`** before testing anything that needs real model behavior —
  the VERCEL_SETUP.md warning about this applies locally too.

## 6. General regression pass

- One full run from landing through the verdict card using your voice the whole way, to confirm
  nothing in the new confirm-step/gating logic makes the session feel broken or unusually
  chatty/confirmation-heavy in normal use — this is a subjective feel check, not a pass/fail.
