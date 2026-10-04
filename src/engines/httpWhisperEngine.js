/**
 * HttpWhisperEngine — server/self-hosted Whisper (OpenAI-compatible
 * `/v1/audio/transcriptions`) transcription.
 *
 * Why this exists: Whisper is the only widely available engine that is genuinely good at
 * code-switched speech (Persian with English technical terms) and at keeping each word in the
 * language it was spoken in. Chrome's Web Speech API physically cannot do that in one session.
 *
 * How it works here:
 *   - one MediaStream for the whole session (from MicCapture),
 *   - a voice-activity-detected recorder: a segment is closed on silence
 *     (settings.recognition.silenceFinalizeMs) or when it reaches `whisper.chunkSeconds`,
 *   - each segment is uploaded as multipart/form-data and the returned text is emitted as a
 *     normal `final` event, so all downstream text processing stays identical,
 *   - a `prompt` built from the technical vocabulary biases the model towards React/Laravel/…
 *
 * Privacy: nothing leaves the machine unless the user configures an endpoint, and the
 * endpoint can be a local server (http://localhost:8080/...).
 */
import { SpeechEngine } from './base.js';
import { ENGINES, ERR, ERR_MESSAGE_FA, STATE } from '../common/constants.js';
import { TECHNICAL_TERMS } from '../nlp/technicalTerms.js';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4'
];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch { /* noop */ }
  }
  return '';
}

/** Vocabulary-biased prompt so the model spells technical terms the canonical way. */
export function buildVocabularyPrompt(settings, maxTerms = 90) {
  const custom = (settings?.dictionary?.terms || []).map((t) => t.term);
  const builtin = TECHNICAL_TERMS.filter((t) => t.kind === 'proper').map((t) => t.term);
  const list = [...new Set([...custom, ...builtin])].slice(0, maxTerms);
  const userPrompt = settings?.whisper?.prompt ? `${settings.whisper.prompt} ` : '';
  return `${userPrompt}${list.join(', ')}`.trim();
}

export class HttpWhisperEngine extends SpeechEngine {
  constructor(options) {
    super(options);
    this.id = ENGINES.HTTP_WHISPER;
    this.recorder = null;
    this.chunks = [];
    this.segmentStartedAt = 0;
    this.uploads = 0;
    this.failures = 0;
    this.inFlight = null;
    this.mimeType = pickMimeType();
    this.silenceTimer = null;
    this.lastLevel = 0;
  }

  get capabilities() {
    return {
      id: this.id,
      label: 'Whisper (server)',
      streaming: false,
      interim: false,
      multiLanguage: true,
      offline: Boolean(this.settings?.whisper?.endpoint && /localhost|127\.0\.0\.1|192\.168\./.test(this.settings.whisper.endpoint)),
      perWordLanguage: true,
      finalizeOnDemand: false,
      needsNetwork: true,
      needsApiKey: true
    };
  }

  static async probe(settings) {
    if (typeof MediaRecorder === 'undefined') return { available: false, reason: 'no-media-recorder' };
    if (!settings?.whisper?.endpoint) return { available: false, reason: 'no-endpoint' };
    return { available: true, reason: 'ok' };
  }

  async start() {
    if (this.destroyed) return false;
    const endpoint = this.settings?.whisper?.endpoint;
    if (!endpoint) {
      this.fail(ERR.WHISPER_CONFIG, { fatal: true });
      return false;
    }
    if (!this.mimeType && this.mimeType !== '') {
      this.fail(ERR.UNSUPPORTED, { fatal: true, detail: 'MediaRecorder unsupported' });
      return false;
    }
    if (!this.mic || !this.mic.isOpen()) {
      this.fail(ERR.MIC_UNAVAILABLE, { fatal: true, detail: 'no-stream' });
      return false;
    }
    this.running = true;
    this.setState(STATE.LISTENING, 'whisper-listening');
    this.startSegment();
    return true;
  }

  startSegment() {
    if (!this.running || this.destroyed) return;
    const stream = this.mic?.getMediaStream();
    if (!stream) return;
    try {
      this.chunks = [];
      this.recorder = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    } catch (err) {
      this.fail(ERR.UNSUPPORTED, { fatal: true, detail: String(err) });
      this.running = false;
      return;
    }
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onerror = (event) => {
      this.log('error', 'recorder-error', String(event.error || event));
    };
    this.segmentStartedAt = Date.now();
    try {
      this.recorder.start();
    } catch (err) {
      this.log('warn', 'recorder-start-failed', String(err));
    }
  }

  /** Close the current segment and upload it. */
  async closeSegment({ reason = 'silence' } = {}) {
    if (!this.recorder || this.recorder.state === 'inactive') return;
    const recorder = this.recorder;
    const durationMs = Date.now() - this.segmentStartedAt;
    const done = new Promise((resolve) => {
      recorder.onstop = () => resolve();
      setTimeout(resolve, 1500);
    });
    try { recorder.stop(); } catch { /* noop */ }
    await done;

    const blob = new Blob(this.chunks, { type: this.mimeType || 'audio/webm' });
    this.chunks = [];
    this.recorder = null;

    if (blob.size < 1200 || durationMs < 300) {
      // too short to contain speech — skip the request entirely
      this.startSegment();
      return;
    }
    this.setState(STATE.PROCESSING, `whisper-upload:${reason}`);
    await this.transcribe(blob);
    if (this.running) {
      this.setState(STATE.LISTENING, 'whisper-listening');
      this.startSegment();
    }
  }

  async transcribe(blob) {
    const cfg = this.settings.whisper || {};
    const form = new FormData();
    form.append('file', blob, 'segment.webm');
    form.append('model', cfg.model || 'whisper-1');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const lang = this.lang && this.lang !== 'auto' ? String(this.lang).split('-')[0] : '';
    if (lang) form.append('language', lang);
    const prompt = buildVocabularyPrompt(this.settings);
    if (prompt) form.append('prompt', prompt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs || 25000);
    try {
      const headers = {};
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
      const res = await fetch(cfg.endpoint, { method: 'POST', body: form, headers, signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.failures += 1;
        this.fail(ERR.WHISPER_HTTP, { detail: `${res.status} ${res.statusText} ${text.slice(0, 200)}` });
        return;
      }
      const data = await res.json().catch(() => null);
      const text = extractText(data);
      this.uploads += 1;
      if (!text) return;
      this.emit({ type: 'final', transcript: text, lang: this.lang, segment: true, engine: this.id });
    } catch (err) {
      this.failures += 1;
      if (err && err.name === 'AbortError') {
        this.fail(ERR.ENGINE_TIMEOUT, { detail: 'whisper-timeout' });
      } else {
        this.fail(ERR.WHISPER_NETWORK, { detail: String(err && err.message) });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  onAudioLevel(level, speaking) {
    this.lastLevel = level;
    if (!this.running || !this.recorder || this.recorder.state !== 'recording') return;
    const maxMs = (this.settings?.whisper?.chunkSeconds || 12) * 1000;
    if (Date.now() - this.segmentStartedAt >= maxMs) {
      this.closeSegment({ reason: 'max-length' });
    }
  }

  /** Called by the controller when the VAD reports silence. */
  onSilence() {
    if (this.recorder && this.recorder.state === 'recording') {
      this.closeSegment({ reason: 'silence' });
    }
  }

  async stop({ flush = true } = {}) {
    this.running = false;
    if (flush && this.recorder) await this.closeSegment({ reason: 'stop' });
    else if (this.recorder) {
      try { this.recorder.stop(); } catch { /* noop */ }
      this.recorder = null;
      this.chunks = [];
    }
    this.emit({ type: 'flush' });
  }

  abort() {
    this.running = false;
    try { this.recorder?.stop(); } catch { /* noop */ }
    this.recorder = null;
    this.chunks = [];
  }

  async setLang(lang) {
    this.lang = lang;
    return true; // language is per-request for Whisper
  }

  get errorMessage() {
    return ERR_MESSAGE_FA[ERR.WHISPER_HTTP];
  }
}

export function extractText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.trim();
  if (typeof data.text === 'string') return data.text.trim();
  if (Array.isArray(data.segments)) return data.segments.map((s) => s.text || '').join(' ').trim();
  if (Array.isArray(data.results)) return data.results.map((s) => s.text || s.transcript || '').join(' ').trim();
  if (data.data && typeof data.data.text === 'string') return data.data.text.trim();
  return '';
}
