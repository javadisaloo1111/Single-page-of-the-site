/**
 * VoiceController — owns the dictation session inside the offscreen document.
 *
 * Responsibilities
 *   - microphone lifecycle + user friendly permission errors,
 *   - engine lifecycle (create/start/stop/switch engine and language),
 *   - automatic restart with backoff when Chrome ends a recognition session,
 *   - "finalise after a pause" so long dictation is committed in sentences instead of hanging
 *     in an ever-growing interim buffer,
 *   - feeding every transcript through the TextPipeline and emitting ordered ops.
 *
 * The class has no direct dependency on `chrome.*` (all I/O goes through injected callbacks),
 * so it is unit-testable in Node with fake engines.
 */
import { STATE, ERR, ERR_MESSAGE_FA, SESSION_MAX_MS } from '../common/constants.js';
import { TextPipeline } from '../nlp/pipeline.js';
import { detectLanguage, shouldSwitchLanguage } from '../nlp/languageDetect.js';
import { classifyMediaError, stateForError } from '../engines/base.js';
import { MicCapture, MIC_STATE, queryMicPermission, listInputDevices, testMicrophone } from '../engines/audioCapture.js';
import { createEngine } from '../engines/factory.js';

const WATCHDOG_INTERVAL_MS = 15000;
const DEAD_ENGINE_MS = 45000;
const LANG_SWITCH_MIN_INTERVAL_MS = 2500;

export class VoiceController {
  /**
   * @param {{settings:object, emit:Function, engineFactory?:Function, micFactory?:Function,
   *          now?:Function, timers?:object}} deps
   */
  constructor({ settings, emit, engineFactory = createEngine, micFactory = (opts) => new MicCapture(opts), now = () => Date.now(), timers = null }) {
    this.settings = settings;
    this.emit = emit;
    this.engineFactory = engineFactory;
    this.micFactory = micFactory;
    this.now = now;
    this.timers = timers || { set: setTimeout, clear: clearTimeout, every: setInterval, stopEvery: clearInterval };

    this.pipeline = new TextPipeline({ getSettings: () => this.settings });
    this.engine = null;
    this.mic = null;
    this.session = this.#emptySession();
    this.micState = MIC_STATE.UNKNOWN;
    this.micError = null;
    this.devices = [];
    this.lastDetection = null;
    this.stats = { finals: 0, interim: 0, restarts: 0, switches: 0, chars: 0, errors: 0 };
    this.debugLog = [];
    this.pendingSwitch = null;
    this.watchdog = null;
  }

  #emptySession() {
    return {
      active: false,
      starting: false,
      startedAt: 0,
      tabId: null,
      frameId: null,
      lang: null,
      restarts: 0,
      consecutiveRestarts: 0,
      finalizeRequestedAt: 0,
      lastEndAt: 0,
      reason: ''
    };
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  get state() {
    return this.currentState || STATE.IDLE;
  }

  async init() {
    this.micState = await queryMicPermission();
    this.devices = await listInputDevices();
    return this.diagnostics();
  }

  async updateSettings(settings) {
    this.settings = settings;
    if (this.mic) {
      this.mic.setSilenceMs(settings.recognition?.silenceFinalizeMs);
      this.mic.setThreshold(settings.whisper?.vadThreshold);
    }
    if (this.engine && this.engine.running) {
      // engine change while running → restart with the new engine
      if (this.engine.id !== settings.recognition?.engine) {
        this.log('info', 'engine-change-restart', settings.recognition?.engine);
        await this.restartEngine('engine-settings-changed');
      }
    }
    return true;
  }

  /**
   * Start (or restart) a dictation session.
   * @param {{tabId?:number, frameId?:number, lang?:string, newSession?:boolean}} options
   */
  async startSession(options = {}) {
    if (this.session.active && !options.newSession) {
      return { ok: true, alreadyActive: true };
    }
    if (this.session.starting) return { ok: false, reason: 'starting' };

    this.session.starting = true;
    this.#setState(STATE.STARTING, 'session-starting');

    // 1) microphone ------------------------------------------------
    const micOk = await this.#ensureMicrophone();
    if (!micOk) {
      this.session.starting = false;
      this.session.active = false;
      return { ok: false, reason: this.micError || 'mic-unavailable' };
    }

    // 2) engine ----------------------------------------------------
    const lang = options.lang
      || (this.settings.language?.mode === 'manual' ? this.settings.language.manualLang : null)
      || this.lastDetection?.lang
      || this.settings.language?.fallbackLang
      || 'fa-IR';

    const { engine, reason } = this.engineFactory({
      settings: this.settings,
      lang,
      onEvent: (event) => this.handleEngineEvent(event),
      mic: this.mic
    });

    if (!engine) {
      this.session.starting = false;
      const code = reason === 'no-endpoint' ? ERR.WHISPER_CONFIG
        : reason === 'not-implemented' ? ERR.UNSUPPORTED
          : reason === 'no-web-speech-api' ? ERR.UNSUPPORTED
            : ERR.INTERNAL;
      this.#setError(code, true, reason);
      return { ok: false, reason };
    }

    this.engine = engine;
    this.pipeline.reset();
    this.session = {
      ...this.#emptySession(),
      active: true,
      starting: true,
      startedAt: this.now(),
      tabId: options.tabId ?? this.session.tabId,
      frameId: options.frameId ?? this.session.frameId,
      lang
    };
    this.#startWatchdog();

    const started = await this.engine.start();
    if (!started) {
      this.session.starting = false;
      // the engine already emitted a descriptive error
      this.session.active = false;
      this.#stopWatchdog();
      return { ok: false, reason: 'engine-start-failed' };
    }

    this.session.starting = false;
    this.#setState(STATE.LISTENING, 'session-started');
    this.#emitSession();
    return { ok: true, lang, engine: engine.id };
  }

  async stopSession({ abort = false, reason = 'user' } = {}) {
    if (!this.engine && !this.session.active) {
      this.#setState(STATE.IDLE, 'already-idle');
      return { ok: true };
    }
    this.#setState(STATE.STOPPING, reason);
    this.session.active = false;
    this.#stopWatchdog();

    const engine = this.engine;
    this.engine = null;
    try {
      if (abort) engine?.abort();
      else await engine?.stop({ flush: true });
    } catch (err) {
      this.log('warn', 'engine-stop-failed', String(err));
    }
    this.pipeline.reset();

    // release the microphone as soon as dictation stops (no idle capture, no CPU drain)
    if (this.mic && this.settings.ui?.keepMicOpen !== true) {
      this.mic.close();
      this.mic = null;
    }
    this.session = { ...this.#emptySession(), tabId: this.session.tabId, frameId: this.session.frameId };
    this.#setState(STATE.IDLE, 'stopped');
    this.#emitSession();
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * Microphone
   * ------------------------------------------------------------------ */

  async #ensureMicrophone() {
    if (this.mic && this.mic.isOpen()) return true;
    this.mic = this.micFactory({
      pollMs: 100,
      speechThreshold: this.settings.whisper?.vadThreshold ?? 0.012,
      silenceMs: this.settings.recognition?.silenceFinalizeMs ?? 1600,
      onLevel: (level, speaking) => this.#onLevel(level, speaking),
      onSilence: () => this.#onSilence(),
      onSpeechStart: () => this.#setState(STATE.SPEECH, 'speech-start')
    });
    try {
      const { state } = await this.mic.open();
      this.micState = state === MIC_STATE.GRANTED ? 'granted' : state;
      this.micError = null;
      this.devices = await listInputDevices();
      this.emit({ kind: 'mic', state: 'granted', device: this.mic.deviceLabel, devices: this.devices });
      return true;
    } catch (err) {
      const code = classifyMediaError(err);
      this.micState = code === ERR.MIC_BUSY ? MIC_STATE.BUSY
        : code === ERR.MIC_DENIED ? MIC_STATE.DENIED : MIC_STATE.UNAVAILABLE;
      this.micError = code;
      this.mic?.close();
      this.mic = null;
      this.emit({ kind: 'mic', state: this.micState, error: code, devices: this.devices });
      this.#setError(code, true, String(err && err.name));
      return false;
    }
  }

  async microphoneTest(durationMs = 1600) {
    const before = this.mic;
    const result = await testMicrophone(durationMs, { onLevel: (level) => this.emit({ kind: 'mic-level', level }) });
    this.micState = result.ok ? MIC_STATE.GRANTED : MIC_STATE.DENIED;
    this.devices = await listInputDevices();
    this.emit({ kind: 'mic', state: this.micState, devices: this.devices, test: result });
    return { ...result, devices: this.devices, previousStreamKept: Boolean(before && before.isOpen()) };
  }

  async micQuery() {
    const permission = await queryMicPermission();
    this.devices = await listInputDevices();
    return {
      permission,
      state: this.mic ? (this.mic.isOpen() ? MIC_STATE.GRANTED : MIC_STATE.UNKNOWN) : permission,
      device: this.mic?.deviceLabel || '',
      devices: this.devices,
      active: Boolean(this.mic && this.mic.isOpen())
    };
  }

  #onLevel(level, speaking) {
    this.engine?.onAudioLevel?.(level, speaking);
    this.emit({ kind: 'mic-level', level });
  }

  #onSilence() {
    if (!this.session.active || !this.engine) return;
    // Persist the interim text as a final segment so a pause produces a committed sentence.
    if (this.engine.id === 'webspeech' || this.engine.id === 'webspeech-dual') {
      const requested = this.engine.requestFinalize?.();
      if (requested) {
        this.session.finalizeRequestedAt = this.now();
        this.log('debug', 'finalize-on-silence');
      }
    } else {
      this.engine.onSilence?.();
    }
    this.#applyPendingSwitch();
  }

  /* ------------------------------------------------------------------ *
   * Engine events
   * ------------------------------------------------------------------ */

  handleEngineEvent(event) {
    switch (event.type) {
      case 'state':
        if (event.state === STATE.SPEECH) this.#setState(STATE.SPEECH, event.detail);
        else if (event.state === STATE.PROCESSING && this.engine?.hasInterim) this.#setState(STATE.PROCESSING, event.detail);
        else if (event.state === STATE.LISTENING && !this.session.starting) this.#setState(STATE.LISTENING, event.detail);
        else if (event.state === STATE.ERROR) this.#setState(STATE.ERROR, event.detail);
        break;

      case 'interim': {
        if (!this.session.active) return;
        const { tail } = this.pipeline.processInterim(event.transcript, { lang: event.lang });
        this.stats.interim += 1;
        this.emit({ kind: 'interim', tail, raw: event.transcript, lang: event.lang });
        this.#maybeApplySwitchOnBoundary();
        break;
      }

      case 'final': {
        if (!this.session.active) return;
        const { ops, text, meta, duplicate } = this.pipeline.processFinal(event.transcript, {
          lang: event.lang,
          // string (dual engine) or object (aria/whisper) — the pipeline normalises both
          detected: event.detected ?? event.detection ?? undefined
        });
        this.lastDetection = meta.detected || this.lastDetection;
        this.stats.finals += 1;
        this.stats.chars += text.length;
        this.emit({ kind: 'lang', lang: meta.lang, detected: meta.detected, mixed: meta.detected?.mixed });
        if (ops.length && !duplicate) {
          this.#setState(STATE.INSERTING, 'inserting');
          this.emit({ kind: 'ops', ops, text, meta });
          setTimeout(() => {
            if (this.session.active) this.#setState(STATE.LISTENING, 'inserted');
          }, 220);
        }
        if (text) {
          this.emit({ kind: 'transcript', text, meta });
        }
        this.#considerLanguageSwitch(meta.detected || detectLanguage(event.transcript, {
          candidates: this.settings.language?.candidates
        }));
        break;
      }

      case 'error': {
        this.stats.errors += 1;
        this.#setError(event.code, event.fatal, event.message);
        break;
      }

      case 'end': {
        this.session.lastEndAt = this.now();
        if (this.session.active) this.#handleUnexpectedEnd(event);
        else this.#setState(STATE.IDLE, 'ended');
        break;
      }

      case 'log':
        this.log(event.level || 'info', event.message, event.data);
        break;

      case 'flush':
        this.pipeline.reset();
        break;

      default:
        break;
    }
  }

  /** Chrome ended the recognition session: restart it unless the user stopped dictation. */
  #handleUnexpectedEnd(event) {
    if (!this.session.active) return;
    if (this.settings.recognition?.autoRestart === false) {
      this.stopSession({ reason: 'engine-ended' });
      this.#setError(ERR.RECOGNITION_ABORTED, false, 'auto-restart-disabled');
      return;
    }
    const max = this.settings.recognition?.maxRestarts ?? 15;
    if (this.session.consecutiveRestarts >= max) {
      this.#setError(ERR.RESTART_FAILED, true, `restarts=${this.session.consecutiveRestarts}`);
      this.stopSession({ reason: 'restart-limit' });
      return;
    }

    const wasFinalize = this.now() - this.session.finalizeRequestedAt < 4000;
    this.session.consecutiveRestarts += 1;
    this.session.restarts += 1;
    this.stats.restarts += 1;

    const baseDelay = Number(this.settings.recognition?.restartDelayMs ?? 250);
    const noSpeechDelay = Number(this.settings.recognition?.noSpeechRestartDelayMs ?? 900);
    const backoff = Math.min(3000, baseDelay * Math.max(1, this.session.consecutiveRestarts));
    const delay = wasFinalize ? baseDelay : Math.max(baseDelay, Math.min(noSpeechDelay, backoff));

    this.emit({ kind: 'restart', count: this.session.restarts, delay, reason: event.reason || 'ended' });
    this.log('debug', 'engine-restart', { count: this.session.restarts, delay });

    this.timers.set(() => {
      if (!this.session.active || !this.engine) return;
      // Recreate the recognition object: a used-and-ended object occasionally refuses to start.
      Promise.resolve(this.engine.start())
        .then((ok) => {
          if (!ok) this.#handleUnexpectedEnd({ reason: 'start-failed' });
        })
        .catch(() => this.#handleUnexpectedEnd({ reason: 'start-threw' }));
    }, delay);
  }

  async restartEngine(reason = 'manual') {
    if (!this.session.active) return false;
    const lang = this.session.lang;
    const engine = this.engine;
    this.engine = null;
    try { await engine?.stop({ flush: true }); } catch { /* noop */ }
    const { engine: next, reason: failReason } = this.engineFactory({
      settings: this.settings,
      lang,
      onEvent: (event) => this.handleEngineEvent(event),
      mic: this.mic
    });
    if (!next) {
      this.#setError(failReason === 'no-endpoint' ? ERR.WHISPER_CONFIG : ERR.INTERNAL, true, failReason);
      await this.stopSession({ abort: true, reason: 'engine-restart-failed' });
      return false;
    }
    this.engine = next;
    const ok = await next.start();
    if (ok) this.#setState(STATE.LISTENING, `restarted:${reason}`);
    return ok;
  }

  /* ------------------------------------------------------------------ *
   * Language auto-switching
   * ------------------------------------------------------------------ */

  #considerLanguageSwitch(detected) {
    if (!detected || this.settings.language?.mode === 'manual') return;

    if (this.settings.language?.dualEngine) {
      return; // dual engine covers multiple languages by itself
    }
    if (this.settings.recognition?.engine !== 'webspeech') {
      return; // Whisper handles language per request
    }
    if (!shouldSwitchLanguage(this.session.lang, detected, this.settings)) return;

    // hysteresis: require either high confidence or two consecutive detections
    const same = this.pendingSwitch && this.pendingSwitch.lang === detected.lang;
    const count = same ? this.pendingSwitch.count + 1 : 1;
    this.pendingSwitch = { lang: detected.lang, count, confidence: detected.confidence, at: this.now() };
    if (count < 2 && detected.confidence < 0.8) return;

    // apply at an utterance boundary (no pending interim text)
    if (!this.engine?.hasInterim) this.#applyPendingSwitch();
  }

  #maybeApplySwitchOnBoundary() {
    if (this.pendingSwitch && !this.engine?.hasInterim) this.#applyPendingSwitch();
  }

  async #applyPendingSwitch() {
    const pending = this.pendingSwitch;
    if (!pending || !this.session.active || !this.engine) return;
    if (this.now() - (this.lastSwitchAt || 0) < LANG_SWITCH_MIN_INTERVAL_MS) return;
    if (pending.lang === this.session.lang) { this.pendingSwitch = null; return; }

    this.pendingSwitch = null;
    this.lastSwitchAt = this.now();
    this.stats.switches += 1;
    this.session.lang = pending.lang;
    this.log('info', 'language-switch', { lang: pending.lang, confidence: pending.confidence });
    this.emit({ kind: 'lang-switch', lang: pending.lang, confidence: pending.confidence });

    const supported = typeof this.engine.setLang === 'function';
    if (!supported) return;
    this.#setState(STATE.PROCESSING, 'language-switch');
    const ok = await this.engine.setLang(pending.lang);
    if (!ok) {
      this.log('warn', 'language-switch-failed', pending.lang);
      // fall back to full restart with the new language
      await this.restartEngine('language-switch');
    }
    this.#emitSession();
  }

  /** Explicit language selection from the UI. */
  async setLanguage(lang) {
    if (lang === 'auto') {
      this.settings = { ...this.settings, language: { ...this.settings.language, mode: 'auto' } };
      return { ok: true, auto: true };
    }
    this.settings = { ...this.settings, language: { ...this.settings.language, mode: 'manual', manualLang: lang } };
    this.session.lang = lang;
    this.pendingSwitch = null;
    if (this.engine && this.session.active) {
      this.#setState(STATE.PROCESSING, 'manual-language-switch');
      const ok = await this.engine.setLang(lang);
      if (!ok) await this.restartEngine('manual-language-switch');
      if (this.session.active) this.#setState(STATE.LISTENING, 'language-set');
    }
    this.#emitSession();
    return { ok: true, lang };
  }

  /* ------------------------------------------------------------------ *
   * Housekeeping
   * ------------------------------------------------------------------ */

  #startWatchdog() {
    this.#stopWatchdog();
    this.watchdog = this.timers.every(() => {
      if (!this.session.active) return;
      const elapsed = this.now() - this.session.startedAt;
      const maxMs = (this.settings.recognition?.maxSessionMinutes ?? 120) * 60000;
      if (elapsed > Math.min(maxMs, SESSION_MAX_MS)) {
        this.log('info', 'session-max-duration');
        this.stopSession({ reason: 'max-duration' });
        return;
      }
      if (!this.mic || !this.mic.isOpen()) {
        // a dead microphone track must be reported, never silently ignored
        this.#setError(ERR.MIC_UNAVAILABLE, true, 'stream-lost');
        this.stopSession({ reason: 'mic-lost' });
        return;
      }
      const last = this.engine?.lastActivity || this.session.startedAt;
      if (this.now() - last > DEAD_ENGINE_MS && this.mic.speaking) {
        this.log('warn', 'engine-watchdog-restart', { idleMs: this.now() - last });
        this.restartEngine('watchdog');
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  #stopWatchdog() {
    if (this.watchdog) {
      this.timers.stopEvery(this.watchdog);
      this.watchdog = null;
    }
  }

  #setState(state, detail = '') {
    if (this.currentState === state && !detail) return;
    this.currentState = state;
    this.emit({ kind: 'state', state, detail, session: this.sessionSnapshot() });
  }

  #setError(code, fatal = false, detail = '') {
    const message = ERR_MESSAGE_FA[code] || ERR_MESSAGE_FA[ERR.INTERNAL];
    this.currentState = stateForError(code);
    this.lastError = { code, message, fatal, detail, at: this.now() };
    this.emit({ kind: 'error', code, message, fatal, detail, state: this.currentState });
    this.log(fatal ? 'error' : 'warn', `error:${code}`, detail);
  }

  sessionSnapshot() {
    return {
      active: this.session.active,
      state: this.session.active ? this.state : STATE.IDLE,
      lang: this.session.lang,
      restarts: this.session.restarts,
      startedAt: this.session.startedAt,
      engine: this.engine?.id || this.settings.recognition?.engine,
      tabId: this.session.tabId,
      frameId: this.session.frameId,
      mic: this.micState,
      stats: { ...this.stats },
      lastDetection: this.lastDetection,
      lastError: this.lastError || null
    };
  }

  #emitSession() {
    this.emit({ kind: 'session', session: this.sessionSnapshot() });
  }

  log(level, message, data) {
    if (!this.settings.debug?.enabled && level === 'debug') return;
    const entry = { at: this.now(), level, message, data: sanitizeLogData(data) };
    this.debugLog.push(entry);
    if (this.debugLog.length > 400) this.debugLog.shift();
    this.emit({ kind: 'log', ...entry });
  }

  async diagnostics() {
    const engineCaps = this.engine?.capabilities || null;
    const { engineCatalog } = await import('../engines/factory.js');
    let catalog = [];
    try { catalog = await engineCatalog(this.settings); } catch { catalog = []; }
    return {
      state: this.session.active ? this.state : STATE.IDLE,
      mic: { state: this.micState, error: this.micError, devices: this.devices, level: this.mic?.level ?? 0 },
      session: this.sessionSnapshot(),
      engine: engineCaps,
      engineCatalog: catalog,
      stats: { ...this.stats },
      logs: this.settings.debug?.enabled ? this.debugLog.slice(-200) : [],
      pipeline: {
        committed: this.pipeline?.committedText?.length || 0,
        lastMeta: this.pipeline?.lastMeta || null
      },
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
      at: this.now()
    };
  }
}

function sanitizeLogData(data) {
  if (data === undefined || data === null) return null;
  if (typeof data === 'string') return data.slice(0, 500);
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return String(data).slice(0, 500);
  }
}
