/** Engine factory + capability catalogue used by the UI. */
import { ENGINES, ENGINE_LABEL_FA } from '../common/constants.js';
import { WebSpeechEngine } from './webSpeechEngine.js';
import { DualWebSpeechEngine } from './dualWebSpeechEngine.js';
import { HttpWhisperEngine } from './httpWhisperEngine.js';
import { LocalAiEngine } from './localAiEngine.js';

/**
 * Create the engine requested by the settings.
 * @returns {{engine: object|null, reason: string}}
 */
export function createEngine({ settings, lang, onEvent, mic }) {
  const id = settings?.recognition?.engine || ENGINES.WEBSPEECH;
  const options = { settings, lang, onEvent, mic };

  switch (id) {
    case ENGINES.WEBSPEECH:
      if (!WebSpeechEngine.supported) return { engine: null, reason: 'no-web-speech-api' };
      return { engine: new WebSpeechEngine(options), reason: 'ok' };
    case ENGINES.WEBSPEECH_DUAL: {
      if (!WebSpeechEngine.supported) return { engine: null, reason: 'no-web-speech-api' };
      const candidates = settings.language?.candidates || ['fa-IR', 'en-US'];
      const langs = pickDualLangs(candidates);
      return { engine: new DualWebSpeechEngine({ ...options, langs }), reason: 'ok' };
    }
    case ENGINES.HTTP_WHISPER:
      if (!settings.whisper?.endpoint) return { engine: null, reason: 'no-endpoint' };
      return { engine: new HttpWhisperEngine(options), reason: 'ok' };
    case ENGINES.LOCAL_AI:
      return { engine: null, reason: 'not-implemented' };
    default:
      return { engine: null, reason: 'unknown-engine' };
  }
}

/** Choose the two languages for the dual engine (Persian first when it is a candidate). */
export function pickDualLangs(candidates = []) {
  const list = candidates.filter(Boolean);
  const persian = list.find((c) => c.startsWith('fa')) || 'fa-IR';
  const other = list.find((c) => !c.startsWith('fa')) || 'en-US';
  return [persian, other];
}

/** Full catalogue with live availability, for Settings → Engine. */
export async function engineCatalog(settings) {
  const [web, dual, whisper, local] = await Promise.all([
    WebSpeechEngine.probe(),
    DualWebSpeechEngine.probe(),
    HttpWhisperEngine.probe(settings),
    LocalAiEngine.probe()
  ]);
  const entry = (id, probe, notes = []) => ({
    id,
    label: ENGINE_LABEL_FA[id] || id,
    available: probe.available,
    reason: probe.reason,
    notes
  });
  return [
    entry(ENGINES.WEBSPEECH, web, ['Real-time با نمایش متن موقت', 'زبان هر جلسه یکی است؛ تشخیص خودکار توسط افزونه انجام می‌شود']),
    entry(ENGINES.WEBSPEECH_DUAL, dual, ['آزمایشی: دو جلسه هم‌زمان', 'مصرف CPU/شبکه بیشتر']),
    entry(ENGINES.HTTP_WHISPER, whisper, ['بهترین دقت برای گفتار مخلوط', 'نیازمند سرور سازگار با OpenAI']),
    entry(ENGINES.LOCAL_AI, local, ['در دست توسعه', 'بدون ارسال صدا به بیرون'])
  ];
}
