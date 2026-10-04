/**
 * SpeechEngine — the extension point that makes the recognition backend replaceable.
 *
 * Every engine emits the same event vocabulary, so the controller, the text pipeline and the
 * UI never need to know whether the transcript came from Chrome's Web Speech API, from a
 * Whisper server or from a future in-browser model:
 *
 *   { type: 'state',  state, detail }
 *   { type: 'interim', transcript, lang, confidence }
 *   { type: 'final',   transcript, lang, confidence, segment: true }
 *   { type: 'error',   code, message, fatal }
 *   { type: 'log',     level, message, data }
 *   { type: 'flush' }                       // all pending text has been emitted
 *
 * Implementations must be idempotent: calling stop() twice, or start() after a failure,
 * may never throw into the caller.
 */
import { STATE, ERR, ERR_MESSAGE_FA, ENGINES } from '../common/constants.js';

export class SpeechEngine {
  /** @param {{settings:object, lang:string, onEvent:Function, mic?:object}} options */
  constructor({ settings, lang, onEvent, mic = null }) {
    this.settings = settings;
    this.lang = lang || 'fa-IR';
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.mic = mic;
    this.running = false;
    this.destroyed = false;
    this.id = ENGINES.WEBSPEECH;
  }

  emit(event) {
    if (this.destroyed) return;
    try {
      this.onEvent(event);
    } catch (err) {
      // an engine may never crash the controller because of a listener bug
      console.error('[VoiceType] engine event listener failed', err);
    }
  }

  /** Human readable engine name for the UI / debug log. */
  get name() { return this.id; }

  /** What this engine can do — surfaced in Settings and used by the dual-engine mode. */
  get capabilities() {
    return {
      id: this.id,
      streaming: true,
      interim: false,
      multiLanguage: false,
      offline: false,
      perWordLanguage: false,
      finalizeOnDemand: false,
      needsNetwork: true,
      needsApiKey: false
    };
  }

  /** Static capability probe (browser support, endpoint configured, …). */
  static async probe() {
    return { available: false, reason: 'not-implemented' };
  }

  async start() { throw new Error('SpeechEngine.start() not implemented'); }
  async stop() { this.running = false; }
  abort() { this.running = false; }
  async setLang(lang) { this.lang = lang; return true; }
  /** VAD level in 0..1 when the controller owns a microphone stream. */
  onAudioLevel(_level, _speaking) {}
  /** Ask the engine to finalise whatever it is holding (pause detected). */
  requestFinalize() { return false; }
  async destroy() { this.destroyed = true; this.running = false; }

  fail(code, { fatal = false, detail = '' } = {}) {
    const message = ERR_MESSAGE_FA[code] || ERR_MESSAGE_FA[ERR.RECOGNITION_UNKNOWN];
    this.emit({ type: 'error', code, message, fatal, detail });
  }

  setState(state, detail = '') {
    this.emit({ type: 'state', state, detail });
  }

  log(level, message, data) {
    this.emit({ type: 'log', level, message, data });
  }
}

/** Map a DOMException / MediaStreamError into our stable error codes. */
export function classifyMediaError(err) {
  const name = err && err.name ? err.name : 'unknown';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return ERR.MIC_DENIED;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return ERR.MIC_UNAVAILABLE;
    case 'NotReadableError':
    case 'TrackStartError':
      return ERR.MIC_BUSY;
    case 'NotSupportedError':
      return ERR.MIC_CONSTRAINTS;
    default:
      return ERR.MIC_UNAVAILABLE;
  }
}

/** Map a Web Speech error name into our stable error codes. */
export function classifySpeechError(errorName, message = '') {
  switch (errorName) {
    case 'not-allowed':
    case 'service-not-allowed':
      return /microphone|permission|denied|blocked/i.test(message) ? ERR.MIC_DENIED : ERR.RECOGNITION_SERVICE;
    case 'audio-capture':
      return ERR.RECOGNITION_AUDIO_CAPTURE;
    case 'network':
      return ERR.RECOGNITION_NETWORK;
    case 'no-speech':
      return ERR.RECOGNITION_NO_SPEECH;
    case 'aborted':
      return ERR.RECOGNITION_ABORTED;
    case 'language-not-supported':
    case 'bad-grammar':
    case 'phrases-not-supported':
      return ERR.RECOGNITION_LANGUAGE;
    default:
      return ERR.RECOGNITION_UNKNOWN;
  }
}

export function stateForError(code) {
  if (code === ERR.MIC_DENIED) return STATE.MIC_DENIED;
  if (code === ERR.MIC_BUSY || code === ERR.MIC_UNAVAILABLE || code === ERR.MIC_CONSTRAINTS || code === ERR.RECOGNITION_AUDIO_CAPTURE) {
    return STATE.MIC_UNAVAILABLE;
  }
  if (code === ERR.UNSUPPORTED) return STATE.UNSUPPORTED;
  return STATE.ERROR;
}
