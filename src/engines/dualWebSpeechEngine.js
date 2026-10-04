/**
 * DualWebSpeechEngine (experimental) — two Web Speech sessions with different languages.
 *
 * Chrome can only listen in one language at a time, which is the root cause of
 * "code-switching" errors. Running a Persian session and an English session side by side and
 * keeping the transcript whose script profile matches the utterance is a pragmatic
 * improvement, at the cost of double CPU/network usage. It is off by default and labelled
 * experimental in Settings, while the Whisper engine is the recommended path for
 * heavy mixed-language dictation.
 */
import { SpeechEngine } from './base.js';
import { WebSpeechEngine } from './webSpeechEngine.js';
import { arbitrate } from './arbitration.js';
import { detectLanguage } from '../nlp/languageDetect.js';
import { ENGINES, STATE } from '../common/constants.js';

const ARBITRATION_WINDOW_MS = 1200;

export class DualWebSpeechEngine extends SpeechEngine {
  constructor(options) {
    super(options);
    this.id = ENGINES.WEBSPEECH_DUAL;
    this.primaryLang = options.langs?.[0] || 'fa-IR';
    this.secondaryLang = options.langs?.[1] || 'en-US';
    this.pending = [];
    this.timer = null;
    this.primary = new WebSpeechEngine({
      ...options,
      id: ENGINES.WEBSPEECH_DUAL,
      lang: this.primaryLang,
      onEvent: (event) => this.#forward(event, this.primaryLang)
    });
    this.secondary = new WebSpeechEngine({
      ...options,
      id: ENGINES.WEBSPEECH_DUAL,
      lang: this.secondaryLang,
      onEvent: (event) => this.#forward(event, this.secondaryLang)
    });
  }

  get capabilities() {
    return { ...this.primary.capabilities, id: this.id, label: 'Dual Web Speech', multiLanguage: true, experimental: true };
  }

  static async probe() {
    return WebSpeechEngine.supported ? { available: true, reason: 'ok' } : { available: false, reason: 'no-web-speech-api' };
  }

  async start() {
    const [a, b] = await Promise.all([this.primary.start(), this.secondary.start()]);
    this.running = a || b;
    this.setState(this.running ? STATE.LISTENING : STATE.ERROR, 'dual-start');
    return this.running;
  }

  #forward(event, lang) {
    switch (event.type) {
      case 'interim':
        this.emit({ ...event, lang, engine: this.id });
        break;
      case 'final':
        this.pending.push({ text: event.transcript, lang, at: Date.now(), engine: this.id });
        this.#scheduleArbitration();
        break;
      case 'state':
        // only propagate meaningful states; STARTING/LISTENING churn from both engines is noisy
        if (event.state === STATE.SPEECH || event.state === STATE.ERROR) this.emit({ ...event, lang });
        break;
      case 'error':
        this.emit(event);
        break;
      case 'log':
        this.emit(event);
        break;
      case 'end':
        break;
      default:
        break;
    }
  }

  #scheduleArbitration() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.#flushPending();
      } catch (err) {
        this.log('error', 'arbitration-failed', String(err));
      }
    }, ARBITRATION_WINDOW_MS);
  }

  #flushPending() {
    const candidates = this.pending.splice(0);
    if (candidates.length === 0) return;
    const detected = detectLanguage(candidates.map((c) => c.text).join(' '));
    const { winner } = arbitrate(candidates, { detectedLang: detected.lang });
    if (!winner) return;
    this.lastDecision = {
      expected: detected.lang,
      winner: winner.lang,
      candidates: candidates.map((c) => ({ lang: c.lang, text: c.text }))
    };
    this.emit({
      type: 'final',
      transcript: winner.text,
      lang: winner.lang,
      detected: detected.lang,
      segment: true,
      dual: true
    });
  }

  requestFinalize() {
    return this.primary.requestFinalize() || this.secondary.requestFinalize();
  }

  async stop({ flush = true } = {}) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await Promise.all([this.primary.stop({ flush }), this.secondary.stop({ flush })]);
    try { this.#flushPending(); } catch { /* noop */ }
    this.running = false;
    this.emit({ type: 'flush' });
  }

  abort() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.primary.abort();
    this.secondary.abort();
    this.pending = [];
    this.running = false;
  }

  async setLang(lang) {
    // In dual mode the pair itself covers the languages: promote the requested one to primary.
    if (!lang || lang === 'auto') return false;
    if (lang === this.primaryLang) return true;
    this.secondaryLang = this.primaryLang;
    this.primaryLang = lang;
    await this.primary.setLang(this.primaryLang);
    await this.secondary.setLang(this.secondaryLang);
    return true;
  }

  onAudioLevel(level, speaking) {
    this.primary.onAudioLevel(level, speaking);
    this.secondary.onAudioLevel(level, speaking);
  }

  async destroy() {
    await this.primary.destroy();
    await this.secondary.destroy();
    this.destroyed = true;
    this.running = false;
  }
}
