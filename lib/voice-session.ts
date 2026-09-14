import { micConstraints } from "@/lib/voice-guards";

/**
 * The live voice connection, owned by the module rather than by a React tree.
 *
 * Two reasons it lives here and not in a hook:
 *
 * 1. **Two screens need it.** The room captures speech, and so does the entry screen now. A second
 *    implementation would drift from this one within a week -- and every rule in here was paid for
 *    by a real failure, so drift means those failures come back one at a time.
 * 2. **It has to outlive a navigation.** Going from the entry screen into the room unmounts one
 *    React tree and mounts another. A connection held in refs would die there, and the learner
 *    would get a second microphone prompt and a second token mint for one continuous act.
 *
 * The boundary is deliberately narrow: this module answers **"get me a transcript"** and **"say
 * this line, and tell me when the sound has actually stopped"**. It does not know about turns,
 * coaches, scenes, or what an utterance means. Policy stays with the screens -- which lines may be
 * interrupted, what to do when one is, whether the microphone reopens afterwards -- because the
 * room has closing lines nobody may talk over and the entry screen has nothing of the kind.
 *
 * Events are forwarded to every subscriber after this module has updated its own state, so a
 * subscriber always reads a settled world.
 */

export type RealtimeSpeechMode = "intake" | "conversation";

/**
 * What the microphone is doing right now. One derived value in place of scattered `track.enabled`
 * flipping, because full-duplex adds a third state between "off" and "recording":
 *
 * - `closed`    -- track disabled. Nothing reaches the server.
 * - `armed`     -- track live but no turn is in progress. Speaking starts one. Runs the stricter
 *                  `guard` profile so room noise doesn't open a turn nobody asked for.
 * - `capturing` -- a turn is in progress and being transcribed.
 */
export type MicWindow = "closed" | "armed" | "capturing";
export type VadProfile = "capture" | "guard" | "patient";

export type RealtimeServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  item?: {
    content?: Array<{
      transcript?: string;
      text?: string;
    }>;
  };
  response?: {
    status?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

type RealtimeTokenResponse = {
  ok: true;
  value: string;
  model: string;
  /** Restated on every language switch; a partial `transcription` object would drop the model. */
  transcribeModel?: string;
  voice: string;
  expiresAt: string | null;
};

/**
 * Realtime errors that are expected side effects of the turn choreography rather than real
 * failures: committing an already-VAD-committed (empty) buffer, or cancelling a response that has
 * already finished by the time the interrupt tap lands.
 */
const ignorableRealtimeErrorCodes = new Set([
  "input_audio_buffer_commit_empty",
  "input_audio_buffer_commit_too_small",
  "response_cancel_not_active",
]);

/**
 * How long a released session stays open with nobody holding it.
 *
 * This is the navigation window. Leaving the entry screen unmounts it before the room mounts, so
 * for a moment the count is zero while the learner is very much still in the middle of something.
 * Long enough to cross that gap, short enough that a closed tab does not leave a microphone open.
 */
const releaseGraceMs = 4000;

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * Whatever a caller handed `log()`, as one line of text.
 *
 * Mirrors `vlog` in the room so the two halves of a trace read alike once they share a buffer.
 * `console.log` can render an object; a joined string cannot.
 */
function printable(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserialisable]";
  }
}

class VoiceSession {
  // --- transport ---
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private connectPromise: Promise<boolean> | null = null;
  private consumers = 0;
  private releaseTimer: number | null = null;
  private listeners = new Set<(event: RealtimeServerEvent) => void>();

  /** Which instructions this connection was minted with. A different mode means a new mint. */
  mode: RealtimeSpeechMode | null = null;
  /** The connection is unusable; callers should drop to their own fallback. */
  fallback = false;
  transcribeModel = "gpt-4o-mini-transcribe";
  language: "en" | "es" = "en";
  micWindow: MicWindow = "closed";
  /** `localStorage["outloud-debug-realtime"] = "1"`. A data channel is invisible in the network tab. */
  debug = false;

  // --- speaking ---
  /**
   * Playback lifecycle only. **Not** policy: whether a given line may be interrupted, and what to
   * do when it is, belongs to the screen -- the room has closing lines nobody may talk over, and
   * the entry screen has none of that. This half only knows when a line started, when generation
   * finished, and when the sound actually stopped coming out of the speaker.
   */
  private speakingResolve: (() => void) | null = null;
  private speakingTimer: number | null = null;
  private speakingStartedAt = 0;
  private responseDone = false;
  private outputAudioActive = false;

  /** True while a line is still generating or still playing out. */
  get speaking() {
    return this.speakingResolve !== null || this.outputAudioActive;
  }

  // --- capture ---
  capturing = false;
  transcript = "";
  transcriptFinal = false;
  speechActive = false;
  speechSeen = false;
  /**
   * A capture has closed and its transcript is still in flight. Without this, the guard that
   * ignores transcription events while the mic is shut would throw away the very transcript the
   * caller is waiting for.
   */
  awaitingTranscript = false;
  /**
   * The server started a NEW speech segment after this capture had already closed.
   *
   * `awaitingTranscript` deliberately opens a window in which transcription events are accepted
   * while the mic is shut -- the transcript for the turn that just ended is still in flight and
   * has to get through. The gap that window leaves is that it accepts transcription from ANY
   * segment, including one that began after the learner stopped talking.
   *
   * From a real session (2026-09-11):
   *
   *   [voice:capture] waiting for transcript, timeout: 6000 ms
   *   [rt] input_audio_buffer.committed        | micWindow: closed
   *   [rt] input_audio_buffer.speech_started   | micWindow: closed  <- a new segment, mic shut
   *   [rt] ...transcription.completed "Valla en az..."
   *
   * "Valla en az..." was submitted as the learner's answer. It is not something anybody said --
   * it is whatever the room, or the tail of the coach's own audio, decoded into. Being answered
   * about a sentence you never spoke is the worst version of not being heard, because it looks
   * like listening.
   *
   * So a `speech_started` while the window is closed ends the window. Whatever has already been
   * finalised still counts; nothing after it does. If that leaves the turn with nothing, the
   * capture times out and is discarded as a dud, and the learner is asked again -- which is the
   * honest outcome and much better than answering the noise.
   */
  private strayAfterClose = false;
  private captureResolve: ((value: string) => void) | null = null;
  private captureTimer: number | null = null;

  /**
   * To the console AND to the room's dump buffer.
   *
   * The second half matters more than it looks. `__outloudVoiceDump()` is what somebody can
   * actually paste back after a session went wrong, and until 2026-09-14 nothing in this file
   * reached it -- only the room's own `vlog` did. So a trace sent in for diagnosis showed the
   * microphone opening and closing and never showed which language the transcriber was pinned to,
   * which was the open question about the transcript it produced. Same debug gate, same array,
   * same timestamp format, so both sources interleave in the order they happened.
   */
  private log(scope: string, ...rest: unknown[]) {
    if (!this.debug) return;
    const tag = `[voice:${scope}]`;
    const suffix = `| mic:${this.micWindow} mode:${this.mode} capturing:${this.capturing}`;
    console.log(tag, ...rest, suffix);
    if (typeof window === "undefined") return;
    const store = window as unknown as { __outloudVoiceLog?: string[] };
    store.__outloudVoiceLog ??= [];
    store.__outloudVoiceLog.push(
      `${new Date().toISOString().slice(11, 23)} ${[tag, ...rest.map(printable), suffix].join(" ")}`,
    );
  }

  // ------------------------------------------------------------------ lifecycle

  /** One more screen is using the connection. Cancels a pending teardown. */
  acquire() {
    this.consumers += 1;
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }

  /**
   * One fewer screen. The teardown is delayed rather than immediate: see `releaseGraceMs`. An
   * `acquire` inside the window cancels it, which is exactly what a navigation looks like.
   */
  release() {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers > 0) return;
    if (this.releaseTimer !== null) window.clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      this.releaseTimer = null;
      if (this.consumers === 0) this.disconnect();
    }, releaseGraceMs);
  }

  onEvent(handler: (event: RealtimeServerEvent) => void) {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  isConnected(mode?: RealtimeSpeechMode) {
    if (this.channel?.readyState !== "open") return false;
    if (this.peer?.connectionState === "closed") return false;
    return mode === undefined || this.mode === mode;
  }

  // ------------------------------------------------------------------ connecting

  async connect(
    mode: RealtimeSpeechMode,
    body: unknown,
    options: { pressureMode?: boolean } = {},
  ): Promise<boolean> {
    if (
      typeof window === "undefined" ||
      typeof RTCPeerConnection === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return false;
    }

    if (this.isConnected(mode)) return true;

    if (this.connectPromise) {
      this.log("connect", "already connecting, awaiting existing promise");
      return this.connectPromise;
    }

    this.log("connect", "starting, mode:", mode);
    this.connectPromise = (async () => {
      try {
        if (this.peer || this.channel || (this.mode && this.mode !== mode)) {
          this.disconnect();
        }

        const tokenResponse = await fetch("/api/realtime-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const token = (await tokenResponse.json()) as RealtimeTokenResponse & { error?: string };
        if (!tokenResponse.ok) {
          throw new Error(token.error ?? "Realtime token was refused.");
        }

        const peer = new RTCPeerConnection();
        const audio = new Audio();
        audio.autoplay = true;
        audio.setAttribute("playsinline", "");
        this.audio = audio;

        peer.ontrack = (event) => {
          audio.srcObject = event.streams[0];
          void audio.play().catch(() => undefined);
        };
        peer.onconnectionstatechange = () => {
          this.log("connect", "peer state:", peer.connectionState);
          if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            this.fallback = true;
          }
        };

        if (token.transcribeModel) this.transcribeModel = token.transcribeModel;
        this.language = "en";
        this.log("connect", "token minted, requesting microphone");
        const stream = await navigator.mediaDevices.getUserMedia(micConstraints);
        stream.getAudioTracks().forEach((track) => {
          // Muted until a mic window opens it. Nothing is transmitted by connecting.
          track.enabled = false;
          peer.addTrack(track, stream);
        });
        this.log(
          "connect",
          "microphone granted:",
          stream.getAudioTracks().map((t) => `${t.label} (muted:${t.muted}, state:${t.readyState})`),
        );

        const channel = peer.createDataChannel("oai-events");
        channel.addEventListener("message", (message) => {
          try {
            this.handleEvent(JSON.parse(message.data) as RealtimeServerEvent);
          } catch {
            // Ignore malformed transport events; the app state is driven by our own engines.
          }
        });
        channel.addEventListener("error", (event) => {
          this.log("connect", "DATA CHANNEL ERROR -> callers should fall back", event);
          this.fallback = true;
        });

        this.peer = peer;
        this.channel = channel;
        this.stream = stream;
        this.mode = mode;
        this.micWindow = "closed";

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.value}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });

        if (!sdpResponse.ok) {
          this.log("connect", "SDP exchange failed:", sdpResponse.status);
          throw new Error("Realtime session could not connect.");
        }

        await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });

        const opened = await this.waitForChannel(channel);
        if (!opened) throw new Error("Realtime channel did not open.");

        // State the profile explicitly rather than inheriting whatever the token was minted with:
        // the token is minted once per session, so its values can never change again.
        this.setVadProfile("capture", options.pressureMode ?? false);
        this.fallback = false;
        this.log("connect", "CONNECTED — data channel open");
        return true;
      } catch (error) {
        // This used to be a bare `catch {}`. Every connection failure -- a 429 on the token, a
        // denied microphone, a rejected SDP -- became an identical silent drop to the recorder
        // path, which is indistinguishable from "the mic just does nothing".
        this.log("connect", "FAILED -> caller should fall back:", error);
        this.fallback = true;
        this.disconnect();
        return false;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  private async waitForChannel(channel: RTCDataChannel) {
    if (channel.readyState === "open") return true;

    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 5000);
      channel.addEventListener(
        "open",
        () => {
          window.clearTimeout(timer);
          resolve(true);
        },
        { once: true },
      );
      channel.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          resolve(false);
        },
        { once: true },
      );
    });
  }

  disconnect() {
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    this.resetSpeaking();
    this.resetCapture();
    this.connectPromise = null;
    this.mode = null;
    this.fallback = false;
    this.micWindow = "closed";
    this.channel?.close();
    this.channel = null;
    this.peer?.close();
    this.peer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio = null;
    }
  }

  // ------------------------------------------------------------------ sending

  /**
   * Sends one event on the data channel. Returns false when the channel isn't usable, so callers
   * can fall back rather than assume delivery. A closing channel throwing here is expected -- the
   * connection-state handler takes over.
   */
  send(payload: Record<string, unknown>) {
    if (this.channel?.readyState !== "open") {
      this.log("send", "DROPPED (channel not open):", payload.type, this.channel?.readyState ?? "no channel");
      return false;
    }
    try {
      this.channel.send(JSON.stringify(payload));
      this.log("send", "ok:", payload.type);
      return true;
    } catch (error) {
      this.log("send", "THREW:", payload.type, error);
      return false;
    }
  }

  /**
   * Pins the transcriber to the language the learner is actually expected to answer in.
   *
   * Auto-detection turned short replies into Korean and a clean Spanish sentence into Danish --
   * the right meaning, the wrong language -- and those transcripts are submitted as the learner's
   * turn, so the conversation derails on input nobody produced. The flow genuinely switches
   * language (English scaffolding, Spanish practice), so this has to move with it rather than be
   * fixed at mint time.
   */
  setTranscriptionLanguage(language: "en" | "es") {
    if (this.language === language) return false;
    this.language = language;
    this.log("vad", "transcription language ->", language);
    return this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            // The model is restated deliberately: a partial `transcription` object drops it.
            transcription: { model: this.transcribeModel, language },
          },
        },
      },
    });
  }

  /**
   * Server-VAD tuning, sent live over the data channel rather than baked into the token, because
   * the token route mints once per session (and is rate limited), so mint-time values can never
   * change mid-session.
   *
   * - `capture`: actively listening. A long silence window so a thinking pause doesn't end a turn.
   * - `patient`: the answer to a capture that came back as nothing but "um". The learner is
   *   mid-thought, and the fix for cutting them off is to stop cutting them off.
   * - `guard`: open but not their turn. Both profiles sit at the API default of 0.5 today; `guard`
   *   was 0.75, invented as a defence against the coach's own voice tripping a turn -- but the mic
   *   is only ever armed while it is the learner's turn, which is precisely when the coach is
   *   silent. Raise it again when voice barge-in lands, not before.
   *
   * `create_response` and `interrupt_response` are restated on every update: a partial
   * `turn_detection` object would let them fall back to defaults, and `create_response: true`
   * would let the realtime model answer the learner directly -- it is only a voice bridge here.
   */
  setVadProfile(profile: VadProfile, pressureMode = false) {
    this.log("vad", "applying profile:", profile);
    return this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms:
                profile === "guard" ? 600 : profile === "patient" ? 2600 : pressureMode ? 850 : 1200,
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    });
  }

  /**
   * The single place that decides whether the microphone transmits, and under which VAD profile.
   * The *derivation* of which window is right belongs to the screen -- it reads turn state, open
   * overlays, and the learner's mic-mode preference. This only applies the answer.
   */
  setMicWindow(next: MicWindow, options: { patient?: boolean; pressureMode?: boolean } = {}) {
    const changed = this.micWindow !== next;
    const before = this.micWindow;
    this.micWindow = next;
    const tracks = this.stream?.getAudioTracks() ?? [];
    tracks.forEach((track) => {
      track.enabled = next !== "closed";
    });
    if (changed) {
      this.log(
        "mic",
        `window ${before} -> ${next}`,
        "| tracks:", tracks.length,
        "| enabled:", tracks.map((t) => t.enabled),
        "| muted:", tracks.map((t) => t.muted),
      );
    }
    if (changed && next !== "closed") {
      this.setVadProfile(
        next === "capturing" ? (options.patient ? "patient" : "capture") : "guard",
        options.pressureMode ?? false,
      );
    }
    return changed;
  }

  // ------------------------------------------------------------------ speaking

  /**
   * Says one line, and resolves when the sound has actually stopped.
   *
   * **Resolving on playback drained rather than on generation done is the whole point.** It is
   * what lets a caller open the microphone straight afterwards without the coach's own voice
   * tripping a turn, which is the failure that keeps voice interfaces from working in a room with
   * a speaker in it.
   *
   * Out-of-band (`conversation: "none"`): this response must not see, or join, the session's
   * conversation history. The realtime model is a voice bridge here -- with history it sometimes
   * "answers" the learner's last utterance, or repeats an earlier line, instead of reading this
   * one.
   */
  async speak(text: string, options: { slow?: boolean; timeoutMs?: number } = {}): Promise<void> {
    // A previous line still generating or playing would keep talking under the new one.
    if (this.speaking) this.cancelSpeech();

    this.speakingStartedAt = nowMs();
    this.responseDone = false;
    this.outputAudioActive = false;

    const finished = new Promise<void>((resolve) => {
      this.speakingResolve = resolve;
      // Safety net: if neither the response nor the audio ever reports finishing, the caller must
      // not be left waiting forever with a shut microphone.
      this.speakingTimer = window.setTimeout(() => this.resolveSpeaking(), options.timeoutMs ?? 8000);
    });

    const sent = this.send({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["audio"],
        instructions: options.slow
          ? `Say this exact line and nothing else, noticeably slower and very clearly, without changing a word: ${text}`
          : `Say this exact line and nothing else: ${text}`,
      },
    });
    // Nothing was sent, so nothing will ever come back to resolve it.
    if (!sent) this.resolveSpeaking();

    await finished;
  }

  /** Stops whatever is being said right now, and releases anyone waiting on it. */
  cancelSpeech() {
    this.send({ type: "response.cancel" });
    this.send({ type: "output_audio_buffer.clear" });
    this.resolveSpeaking();
  }

  private resolveSpeaking() {
    const resolve = this.speakingResolve;
    this.speakingResolve = null;
    if (this.speakingTimer !== null) {
      window.clearTimeout(this.speakingTimer);
      this.speakingTimer = null;
    }
    this.outputAudioActive = false;
    resolve?.();
  }

  // ------------------------------------------------------------------ capture

  /**
   * `resumingSpeech` means the learner is ALREADY talking -- VAD fired and this call is promoting
   * an armed mic into a real turn. Two things must not be reset in that case:
   *
   * - the transcript, which already holds the deltas for the word that started the turn;
   * - the speech flags, because `speech_started` will not fire a second time for the same
   *   utterance, and a transcript arriving with `speechSeen` false is discarded as a noise
   *   hallucination. Without this, every voice-started turn would be silently thrown away.
   */
  openCapture(options: { resumingSpeech?: boolean } = {}) {
    const { resumingSpeech = false } = options;
    this.transcriptFinal = false;
    // A new capture supersedes any transcript the previous one was still waiting on.
    this.awaitingTranscript = false;
    this.strayAfterClose = false;
    if (!resumingSpeech) this.transcript = "";
    this.speechActive = resumingSpeech;
    this.speechSeen = resumingSpeech;
    this.capturing = true;
    this.log("capture", "OPENED, resumingSpeech:", resumingSpeech);
  }

  /**
   * Ends the capture window and reports whether VAD ever heard speech inside it.
   *
   * Split from `awaitTranscript` on purpose: the caller has to shut its own microphone **between**
   * the two calls, so that the buffer commit is the last thing that happens while the track is
   * still live. Muting first would clip the tail; committing first and muting after could open a
   * fresh buffer with the few milliseconds in between.
   */
  closeCapture(): { speechSeen: boolean } {
    // Set BEFORE the window closes: the transcript for this capture is still to come, and the
    // accumulation guard must not mistake it for stray room noise.
    this.awaitingTranscript = true;
    this.capturing = false;
    // Fresh for this window: only a segment that starts AFTER this moment is stray.
    this.strayAfterClose = false;
    return { speechSeen: this.speechSeen };
  }

  /**
   * Commits the buffer if the caller ended the turn by hand, then waits for the transcript that is
   * still in flight. Server VAD may already have committed, and an empty commit is on the
   * ignorable-error list precisely because both paths are allowed to race.
   */
  async awaitTranscript(options: { commit: boolean }): Promise<string> {
    const speechSeen = this.speechSeen;
    if (options.commit && this.speechActive) {
      this.send({ type: "input_audio_buffer.commit" });
    }
    this.speechActive = false;

    const transcript = await new Promise<string>((resolve) => {
      if (this.transcriptFinal) {
        resolve(this.transcript.trim());
        return;
      }
      this.log("capture", "waiting for transcript, timeout:", speechSeen ? 6000 : 2000, "ms");
      this.captureResolve = resolve;
      this.captureTimer = window.setTimeout(
        () => {
          this.log("capture", "TIMED OUT; using:", JSON.stringify(this.transcript));
          this.resolveCapture(this.transcript);
        },
        speechSeen ? 6000 : 2000,
      );
    });

    this.awaitingTranscript = false;
    return transcript.trim();
  }

  /**
   * Drops the window without waiting for anything, because the turn is being taken away rather
   * than finished: an overlay opened over it, or nobody ever spoke. No transcript is wanted, so
   * nothing is left marked as awaiting one.
   */
  abortCapture() {
    this.capturing = false;
    this.awaitingTranscript = false;
  }

  /** Drops any line in flight without sending anything. For a teardown, where the channel is going. */
  resetSpeaking() {
    if (this.speakingTimer !== null) {
      window.clearTimeout(this.speakingTimer);
      this.speakingTimer = null;
    }
    this.responseDone = false;
    this.outputAudioActive = false;
    const resolve = this.speakingResolve;
    this.speakingResolve = null;
    resolve?.();
  }

  /** Clears capture state and keeps the connection. What entering a new room needs. */
  resetCapture() {
    this.capturing = false;
    this.awaitingTranscript = false;
    this.speechActive = false;
    this.speechSeen = false;
    this.transcript = "";
    this.transcriptFinal = false;
    this.resolveCapture("");
  }

  private resolveCapture(transcript: string) {
    const resolve = this.captureResolve;
    this.captureResolve = null;
    if (this.captureTimer !== null) {
      window.clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
    resolve?.(transcript.trim());
  }

  // ------------------------------------------------------------------ events

  /**
   * Updates this module's own state first, then forwards to every subscriber, so a subscriber
   * always reads a settled world. Everything is forwarded, including events handled here: the room
   * needs `error` to release a pending speak, and `speech_started` to decide whether an armed mic
   * should become a turn -- a decision that needs turn state this module deliberately cannot see.
   */
  private handleEvent(event: RealtimeServerEvent) {
    const type = event.type ?? "";

    if (this.debug) {
      console.log(
        "[rt]",
        type,
        "| micWindow:", this.micWindow,
        "| capture:", this.capturing,
        "| speechSeen:", this.speechSeen,
        "| transcript:", JSON.stringify(this.transcript),
        type === "error" ? event.error : "",
      );
    }

    if (type === "error") {
      if (event.error?.code && ignorableRealtimeErrorCodes.has(event.error.code)) return;
      // An unhandled error silently drops the session to the recorder path, which is very hard to
      // notice while developing -- a malformed session.update looks like "voice just got worse".
      if (process.env.NODE_ENV === "development") {
        console.warn("[realtime] unhandled error event", event.error?.code, event.error?.message);
      }
      this.fallback = true;
      this.resolveCapture(this.transcript);
      // A line that will never finish must not hold a caller's microphone shut.
      this.resolveSpeaking();
      this.emit(event);
      return;
    }

    if (type === "output_audio_buffer.started") {
      this.outputAudioActive = true;
      this.emit(event);
      return;
    }

    if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") {
      this.outputAudioActive = false;
      // Playback has actually drained on the client, so a microphone can open without echoing.
      if (this.responseDone) this.resolveSpeaking();
      this.emit(event);
      return;
    }

    if (
      type === "response.done" ||
      type === "response.output_audio.done" ||
      type === "response.audio.done" ||
      event.response?.status === "completed"
    ) {
      this.responseDone = true;
      if (this.outputAudioActive) {
        // Generation is done but the audio is still playing out; wait for the buffer to stop, with
        // a safety net in case that event never arrives.
        if (this.speakingTimer !== null) window.clearTimeout(this.speakingTimer);
        this.speakingTimer = window.setTimeout(() => this.resolveSpeaking(), 8000);
        this.emit(event);
        return;
      }
      // No audio was ever reported. Hold a floor so a line does not blink past unheard.
      const elapsed = nowMs() - this.speakingStartedAt;
      window.setTimeout(() => this.resolveSpeaking(), Math.max(0, 900 - elapsed));
      this.emit(event);
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      // Speech beginning while the window is shut is not this turn's learner. It is the room, or
      // the coach's own audio coming back in. Anything it transcribes to must not become the
      // answer to a turn that is already over.
      if (this.micWindow === "closed") {
        this.strayAfterClose = true;
        this.log("transcript", "STRAY segment started while the mic window was closed -- ignoring what it decodes to");
        this.emit(event);
        return;
      }
      this.speechActive = true;
      this.speechSeen = true;
      this.emit(event);
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      this.speechActive = false;
      this.emit(event);
      return;
    }

    // Transcription can arrive for audio captured outside a turn -- an armed mic hears the room.
    // The transcript is only cleared when a capture STARTS, so anything accepted here would
    // otherwise be prepended to whatever the learner says next.
    if (
      this.micWindow === "closed" &&
      (!this.awaitingTranscript || this.strayAfterClose) &&
      type.includes("input_audio_transcription")
    ) {
      this.log(
        "transcript",
        this.strayAfterClose ? "IGNORED (stray segment after close):" : "IGNORED (closed, no capture awaiting):",
        type,
      );
      return;
    }

    if (typeof event.delta === "string" && type.includes("input_audio_transcription.delta")) {
      this.transcript += event.delta;
    }

    if (typeof event.transcript === "string" && type.includes("input_audio_transcription")) {
      this.log("transcript", type, JSON.stringify(event.transcript));
      this.transcript = event.transcript;
      if (type.endsWith(".completed")) {
        this.transcriptFinal = true;
        this.resolveCapture(event.transcript);
      }
    }

    const contentTranscript = event.item?.content
      ?.map((item) => item.transcript ?? item.text ?? "")
      .join(" ")
      .trim();
    if (contentTranscript && type.includes("input_audio_transcription")) {
      this.transcript = contentTranscript;
      this.transcriptFinal = true;
      this.resolveCapture(contentTranscript);
    }

    this.emit(event);
  }

  private emit(event: RealtimeServerEvent) {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // One screen's handler throwing must not stop the others from hearing the event.
      }
    });
  }
}

/**
 * The one connection. A module-level singleton is the point -- see the note at the top of the
 * file: this has to survive the navigation from the entry screen into the room.
 */
export const voice = new VoiceSession();
