// Does the voice session's own tracing reach the buffer a learner can actually send back?
//
// Two loggers write the voice trace. The room's `vlog` writes to the console AND to
// `window.__outloudVoiceLog`, which is what `__outloudVoiceDump()` prints. `VoiceSession`'s own
// `log()` used to write to the console only -- so a trace pasted back after a session went wrong
// showed the microphone opening and closing and nothing about the connection underneath it: not
// the transcription language, not a dropped session.update, not a data channel that failed to
// open. All three look identical from the outside ("the mic does nothing"), which is the reason
// the file logs at all.
//
// Timo, 2026-09-14: one Spanish turn came back as German and the log he sent could not say which
// language that turn had been pinned to.
import { loadLib, baselineComparison, reportBaseline } from "../harness/load.mjs";

export const about = "voice-session lines reach __outloudVoiceDump(), timestamped, without leaving the console";

// The module writes to `window`; in node there is none until we say so.
globalThis.window ??= globalThis;

/**
 * Drive the real singleton through a real public method and report what came out.
 *
 * `setTranscriptionLanguage` is the one that matters -- it is the question a returned trace has to
 * be able to answer -- and with no data channel open it also produces a dropped `send`, so one
 * call exercises both scopes without any connection.
 */
async function probe(mod) {
  globalThis.window.__outloudVoiceLog = [];
  const consoleLines = [];
  const realLog = console.log;
  console.log = (...args) => { consoleLines.push(args.map(String).join(" ")); };
  try {
    mod.voice.debug = true;
    // Pinned first, because `setTranscriptionLanguage` returns early when nothing changed. Without
    // this the probe silently records zero lines whenever something earlier in the process already
    // left the singleton in Spanish -- which is how a probe passes by not running.
    mod.voice.language = "en";
    mod.voice.setTranscriptionLanguage("es");
    mod.voice.setTranscriptionLanguage("en");
  } finally {
    console.log = realLog;
    mod.voice.debug = false;
  }
  return {
    buffered: globalThis.window.__outloudVoiceLog.length,
    consoled: consoleLines.length,
    sawLanguage: globalThis.window.__outloudVoiceLog.some((l) => l.includes("transcription language -> es")),
    allStamped: globalThis.window.__outloudVoiceLog.every((l) => /^\d\d:\d\d:\d\d\.\d\d\d \[voice:/.test(l)),
  };
}

export default async function run(t) {
  const { voice } = await loadLib("lib/voice-session.ts");
  const now = await probe({ voice });

  t.ok(now.buffered > 0, "the session's own log lines reach the dump buffer", `${now.buffered} lines buffered`);
  t.ok(now.sawLanguage, "the transcription language switch is in the buffer");
  t.ok(now.allStamped, "every buffered line carries the room's HH:MM:SS.mmm prefix");
  t.ok(now.consoled > 0, "the console still gets them too — nothing moved OUT of the console");
  t.equal(now.consoled, now.buffered, "console and buffer saw the same number of lines");

  // And the part that says whether any of the above means anything today.
  reportBaseline(t, "lib/voice-session.ts", await baselineComparison("lib/voice-session.ts", probe));
}
