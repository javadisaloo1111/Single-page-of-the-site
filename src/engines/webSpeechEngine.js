/**
 * WebSpeechEngine — Chrome's Web Speech API (`webkitSpeechRecognition`).
 *
 * Facts that shaped this implementation (verified against the spec + Chromium behaviour):
 *   - the `lang` property is fixed for the lifetime of a recognition session; changing the
 *     language requires a restart, which is what `setLang()` does,
 *   - `continuous` sessions still end by themselves (device silence, 60s network limits),
 *     so the controller restarts them and the Reconciler removes any repeated text,
 *   - `langs` (multi-language) only exists in the experimental on-device API and supports
 *     a limited language list that does **not** include Persian, so it is exposed as an
 *     optional capability instead of being relied upon.
 */
import { SpeechEngine, classifySpeechError } from './base.js';
import { ENGINES, ERR, STATE } from '../common/constants.js';

function getCtor() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export class WebSpeechEngine extends SpeechEngine {
  constructor(options) {
    super(options);
    this.id = options.id || ENGINES.WEBSPEECH;
    this.recognition = null;
    this.intentionalStop = false;
    this.starting = false;
    this.hasInterim = false;
    this.interimText = '';
    this.finalText = '';
    this.restartCount = 0;
    this.lastActivityAt = 0;
    this.stopResolvers = [];
    this.speechDetected = false;
    this.lastErrorCode = null;
  }

  get capabilities() {
    return {
      id: this.id,
      label: 'Web Speech API',
      streaming: true,
      interim: true,
      multiLanguage: false,
      offline: false,
      onDevice: Boolean(this.settings?.recognition?.processLocally),
      perWordLanguage: false,
      finalizeOnDemand: true,
      needsNetwork: !this.settings?.recognition?.processLocally,
      needsApiKey: false
    };
  }

  static get supported() {
    return Boolean(getCtor());
  }

  static async probe() {
    const ctor = getCtor();
    if (!ctor) return { available: false, reason: 'no-web-speech-api' };
    return { available: true, reason: 'ok' };
  }

  /** On-device language-pack status (Chrome 138+ experimental API). */
  static async onDeviceStatus(langs = ['en-US']) {
    const ctor = getCtor();
    if (!ctor || typeof ctor.available !== 'function') {
      return { supported: false, status: 'unavailable', langs };
    }
    try {
      const status = await ctor.available({ langs, processLocally: true });
      return { supported: true, status, langs };
    } catch (err) {
      return { supported: true, status: 'error', error: String(err && err.message), langs };
    }
  }

  static async installOnDevice(langs = ['en-US']) {
    const ctor = getCtor();
    if (!ctor || typeof ctor.install !== 'function') return false;
    try {
      return await ctor.install({ langs, processLocally: true });
    } catch (err) {
      return false;
    }
  }

  static async listLanguages(langs = ['en-US']) {
    const ctor = getCtor();
    if (!ctor || typeof ctor.available !== 'function') return null;
    try {
      return await ctor.available({ langs, processLocally: false });
    } catch (err) {
      return null;
    }
  }

  #createRecognition() {
    const Ctor = getCtor();
    if (!Ctor) {
      this.fail(ERR.UNSUPPORTED, { fatal: true });
      return null;
    }
    const recognition = new Ctor();
    recognition.lang = this.lang;
    recognition.continuous = this.settings.recognition?.continuous !== false;
    recognition.interimResults = this.settings.recognition?.interimResults !== false;
    recognition.maxAlternatives = 1;
    if (this.settings.recognition?.processLocally && 'processLocally' in recognition) {
      try { recognition.processLocally = true; } catch { /* property may be read-only */ }
    }

    recognition.onstart = () => {
      this.starting = false;
      this.lastActivityAt = Date.now();
      this.speechDetected = false;
      this.setState(STATE.LISTENING, 'recognition-started');
    };

    recognition.onaudiostart = () => {
      this.lastActivityAt = Date.now();
      if (!this.speechDetected) this.setState(STATE.LISTENING, 'audio-started');
    };

    recognition.onspeechstart = () => {
      this.speechDetected = true;
      this.lastActivityAt = Date.now();
      this.setState(STATE.SPEECH, 'speech-start');
    };

    recognition.onspeechend = () => {
      this.setState(STATE.PROCESSING, 'speech-end');
    };

    recognition.onresult = (event) => this.#handleResult(event);

    recognition.onerror = (event) => {
      const code = classifySpeechError(event.error, event.message);
      this.lastErrorCode = code;
      // `no-speech`/`aborted` are part of normal continuous operation
      const fatal = code === ERR.MIC_DENIED || code === ERR.UNSUPPORTED || code === ERR.RECOGNITION_LANGUAGE;
      this.hasInterim = false;
      this.emit({ type: 'error', code, message: event.message || event.error, fatal, recoverable: !fatal });
    };

    recognition.onend = () => {
      this.running = false;
      this.starting = false;
      const flushOnly = this.intentionalStop;
      this.emit({ type: 'end', reason: flushOnly ? 'stopped' : 'engine-ended', interim: this.interimText });
      this.interimText = '';
      this.hasInterim = false;
      for (const resolve of this.stopResolvers.splice(0)) resolve();
    };

    this.recognition = recognition;
    return recognition;
  }

  #handleResult(event) {
    this.lastActivityAt = Date.now();
    let interim = '';
    const finals = [];
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result || !result[0]) continue;
      const text = result[0].transcript || '';
      if (result.isFinal) finals.push({ text, confidence: result[0].confidence });
      else interim += text;
    }

    if (interim) {
      this.hasInterim = true;
      this.interimText = interim;
      this.emit({ type: 'interim', transcript: interim, lang: this.lang });
    }

    for (const item of finals) {
      const text = item.text.trim();
      if (!text) continue;
      this.hasInterim = false;
      this.interimText = '';
      this.emit({
        type: 'final',
        transcript: text,
        lang: this.lang,
        confidence: item.confidence,
        segment: true
      });
    }
  }

  async start() {
    if (this.destroyed) return false;
    if (this.running || this.starting) return true;
    const recognition = this.#createRecognition();
    if (!recognition) return false;
    this.intentionalStop = false;
    this.starting = true;
    this.setState(STATE.STARTING, 'recognition-starting');
    try {
      recognition.start();
      this.running = true;
      return true;
    } catch (err) {
      this.starting = false;
      this.running = false;
      if (err && err.name === 'InvalidStateError') {
        // already started (race) — treat as success
        this.running = true;
        return true;
      }
      this.fail(classifySpeechError(err && err.name, String(err && err.message)), { detail: String(err) });
      return false;
    }
  }

  /**
   * Ask the engine to flush its buffer as final text.
   * Chrome finalises the pending utterance when `stop()` is called; because our session
   * wants to continue listening, the controller restarts it afterwards.
   * @returns {Promise<void>}
   */
  requestFinalize() {
    if (!this.recognition || !this.running) return false;
    const hadInterim = this.hasInterim;
    this.intentionalStop = true;
    try {
      this.recognition.stop();
    } catch (err) {
      this.log('warn', 'finalize-stop-failed', String(err));
      return false;
    }
    return hadInterim;
  }

  /** Graceful stop: flush the last utterance, then stop for good. */
  async stop({ flush = true } = {}) {
    if (!this.recognition) { this.running = false; return; }
    this.intentionalStop = !flush;
    if (!this.running && !this.starting) return;
    const promise = new Promise((resolve) => {
      this.stopResolvers.push(resolve);
      setTimeout(resolve, 1500); // never hang the controller
    });
    try {
      if (flush) this.recognition.stop();
      else this.recognition.abort();
    } catch (err) {
      this.log('warn', 'stop-failed', String(err));
    }
    this.running = false;
    await promise;
  }

  abort() {
    this.intentionalStop = true;
    try { this.recognition?.abort(); } catch { /* noop */ }
    this.running = false;
  }

  async setLang(lang) {
    if (!lang || lang === this.lang) return false;
    this.lang = lang;
    // Web Speech binds the language at session start → restart with the new language.
    await this.stop({ flush: true });
    this.destroyRecognition();
    return this.start();
  }

  destroyRecognition() {
    if (!this.recognition) return;
    try {
      this.recognition.onstart = null;
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onspeechend = null;
      this.recognition.abort();
    } catch { /* noop */ }
    this.recognition = null;
  }

  async destroy() {
    this.destroyRecognition();
    this.destroyed = true;
    this.running = false;
  }

  /** The controller feeds VAD levels so the engine can react to real silence. */
  onAudioLevel(level, speaking) {
    if (speaking) this.lastActivityAt = Date.now();
  }

  get lastActivity() {
    return this.lastActivityAt;
  }
}
