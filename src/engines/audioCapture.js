/**
 * Microphone capture + voice-activity detection.
 *
 * The controller keeps ONE MediaStream open for the whole session and uses it for:
 *   - explicit permission handling with user friendly errors,
 *   - a level meter / VAD that knows when the user actually speaks (drives the
 *     "finalise after a pause" behaviour and the floating indicator animation),
 *   - the Whisper engine's chunk recorder.
 *
 * Engines that capture audio themselves (Web Speech) simply ignore the stream; the
 * controller releases it automatically if the recogniser reports `audio-capture`.
 */

export const MIC_STATE = Object.freeze({
  UNKNOWN: 'unknown',
  GRANTED: 'granted',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  BUSY: 'busy'
});

export const DEFAULT_CONSTRAINTS = Object.freeze({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
});

/**
 * @param {{constraints?:object, pollMs?:number, speechThreshold?:number,
 *          speechStartMs?:number, onLevel?:Function, onSpeechStart?:Function,
 *          onSilence?:Function}} options
 */
export class MicCapture {
  constructor(options = {}) {
    this.constraints = options.constraints || DEFAULT_CONSTRAINTS;
    this.pollMs = options.pollMs || 100;
    this.speechThreshold = options.speechThreshold ?? 0.012;
    this.speechStartMs = options.speechStartMs ?? 120;
    this.silenceMs = options.silenceMs ?? 1600;
    this.onLevel = options.onLevel || (() => {});
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSilence = options.onSilence || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});

    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.timer = null;
    this.state = MIC_STATE.UNKNOWN;
    this.level = 0;
    this.speaking = false;
    this.lastSpeechAt = 0;
    this.speechCandidateSince = 0;
    this.silenceReported = false;
    this.deviceLabel = '';
  }

  async open() {
    if (this.stream) return { stream: this.stream, state: this.state };
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.state = MIC_STATE.UNAVAILABLE;
      throw Object.assign(new Error('mediaDevices-unavailable'), { name: 'NotSupportedError' });
    }
    this.stream = await navigator.mediaDevices.getUserMedia(this.constraints);
    const track = this.stream.getAudioTracks()[0];
    this.deviceLabel = track ? track.label : '';
    this.state = MIC_STATE.GRANTED;
    this.#startMeter();
    return { stream: this.stream, state: this.state };
  }

  #startMeter() {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      this.audioContext = new Ctx();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      source.connect(this.analyser);
      const buf = new Float32Array(this.analyser.fftSize);
      this.timer = setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        this.level = Math.min(1, rms * 6);
        this.onLevel(this.level, this.speaking);
        this.#updateVad(Date.now());
      }, this.pollMs);
    } catch (err) {
      // VAD is a nice-to-have: recognition must keep working without it
      this.analyser = null;
    }
  }

  #updateVad(now) {
    const active = this.level >= this.speechThreshold;
    if (active) {
      this.lastSpeechAt = now;
      this.silenceReported = false;
      if (!this.speaking) {
        if (!this.speechCandidateSince) this.speechCandidateSince = now;
        if (now - this.speechCandidateSince >= this.speechStartMs) {
          this.speaking = true;
          this.onSpeechStart(this.level);
        }
      }
    } else {
      this.speechCandidateSince = 0;
      if (this.speaking) {
        const silentFor = now - this.lastSpeechAt;
        if (!this.silenceReported && silentFor >= this.silenceMs) {
          this.silenceReported = true;
          this.speaking = false;
          this.onSpeechEnd(silentFor);
          this.onSilence(silentFor);
        }
      }
    }
  }

  /** Change the silence window at runtime (settings are live-editable). */
  setSilenceMs(ms) {
    if (Number.isFinite(ms) && ms > 0) this.silenceMs = ms;
  }

  setThreshold(value) {
    if (Number.isFinite(value) && value > 0) this.speechThreshold = value;
  }

  /** Tap the live stream (used by the Whisper chunk recorder). */
  getMediaStream() {
    return this.stream;
  }

  isOpen() {
    return Boolean(this.stream && this.stream.active);
  }

  close() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch { /* noop */ } this.analyser = null; }
    if (this.audioContext) { try { this.audioContext.close(); } catch { /* noop */ } this.audioContext = null; }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.stop(); } catch { /* noop */ }
      }
      this.stream = null;
    }
    this.speaking = false;
    this.level = 0;
  }
}

/** Permission state of the extension origin (Chromium-only API, safely guarded). */
export async function queryMicPermission() {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state; // 'granted' | 'denied' | 'prompt'
  } catch (err) {
    return 'unknown';
  }
}

/** List available audio input devices (labels need a granted permission). */
export async function listInputDevices() {
  try {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone', groupId: d.groupId }));
  } catch (err) {
    return [];
  }
}

/**
 * Short "does the microphone work" probe used by the onboarding test and Settings.
 * @returns {Promise<{ok:boolean, level:number, state:string, error?:string}>}
 */
export async function testMicrophone(durationMs = 1600, { onLevel } = {}) {
  const capture = new MicCapture({ onLevel: (level) => onLevel && onLevel(level) });
  const started = Date.now();
  let peak = 0;
  capture.onLevel = (level) => { peak = Math.max(peak, level); if (onLevel) onLevel(level); };
  try {
    await capture.open();
    while (Date.now() - started < durationMs) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: true, level: peak, state: MIC_STATE.GRANTED };
  } catch (err) {
    return { ok: false, level: 0, state: capture.state, error: err && err.name };
  } finally {
    capture.close();
  }
}
