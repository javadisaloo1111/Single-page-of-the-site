/**
 * Automatic language detection for dictated utterances.
 *
 * Web Speech API accepts only ONE language per recognition session, so this module is what
 * makes "Auto" mode work: it scores the incoming text, picks the dominant language, and
 * reports whether the utterance mixes Latin technical terms into Persian/Arabic
 * (code-switching) so the engine controller can decide to (a) keep the current session,
 * (b) restart with another language, or (c) enable dual-engine mode.
 */
import { normalizeForMatch } from './persian.js';
import { FA_STOPWORDS, EN_STOPWORDS, AR_STOPWORDS } from './technicalTerms.js';
import { tokenize, TOKEN } from './tokenize.js';

const PERSIAN_ONLY_LETTERS = /[پچژگ]/;
const ARABIC_MARKERS = /(ة|ى)/;
const ARABIC_AL = /^ال[\u0600-\u06FF]{2,}/;

const faStop = new Set(FA_STOPWORDS.map(normalizeForMatch));
const enStop = new Set(EN_STOPWORDS);
const arStop = new Set(AR_STOPWORDS.map(normalizeForMatch));

/** Extra language profiles (script + a few high-signal stopwords). */
const OTHER_PROFILES = [
  { lang: 'tr-TR', script: 'latin', stop: new Set(['ve', 'bir', 'bu', 'için', 'ile', 'değil', 'çok', 'var', 'yok', 'ama', 'gibi']) },
  { lang: 'fr-FR', script: 'latin', stop: new Set(['le', 'la', 'les', 'des', 'une', 'est', 'pas', 'pour', 'avec', 'dans', 'sur', 'que', 'qui']) },
  { lang: 'de-DE', script: 'latin', stop: new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'für', 'auf', 'ich', 'wir']) },
  { lang: 'es-ES', script: 'latin', stop: new Set(['el', 'los', 'las', 'una', 'es', 'no', 'para', 'con', 'por', 'que', 'como', 'más']) },
  { lang: 'ru-RU', script: 'cyrillic', stop: new Set(['и', 'в', 'не', 'на', 'что', 'это', 'как', 'для', 'по', 'но', 'он', 'она']) },
  { lang: 'hi-IN', script: 'devanagari', stop: new Set(['और', 'में', 'है', 'का', 'की', 'को', 'यह', 'नहीं', 'हो', 'से']) },
  { lang: 'zh-CN', script: 'han', stop: new Set(['的', '了', '是', '我', '不', '在', '他', '有', '这', '个']) },
  { lang: 'ja-JP', script: 'kana', stop: new Set(['の', 'は', 'を', 'に', 'が', 'です', 'ます', 'した', 'して']) },
  { lang: 'ko-KR', script: 'hangul', stop: new Set(['은', '는', '이', '가', '을', '를', '에', '와', '과', '습니다']) }
];

function charScriptGroup(ch) {
  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(ch)) return 'arabicScript';
  if (/\u0400-\u04FF/.test(ch)) return 'cyrillic';
  if (/[\u0900-\u097F]/.test(ch)) return 'devanagari';
  if (/[\u3040-\u30FF]/.test(ch)) return 'kana';
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(ch)) return 'hangul';
  if (/[\u4E00-\u9FFF]/.test(ch)) return 'han';
  if (/[A-Za-z\u00C0-\u024F]/.test(ch)) return 'latin';
  return 'other';
}

/**
 * @param {string} text
 * @param {{candidates?:string[]}} options
 * @returns {{lang:string, confidence:number, scores:Record<string,number>, mixed:boolean,
 *            latinWordCount:number, persianWordCount:number, arabicWordCount:number,
 *            wordCount:number, changedScriptPossible:boolean}}
 */
export function detectLanguage(text, options = {}) {
  const candidates = options.candidates || ['fa-IR', 'en-US', 'ar-SA'];
  const tokens = tokenize(String(text ?? '')).filter((t) => t.type === TOKEN.WORD);
  const scores = { 'fa-IR': 0, 'en-US': 0, 'ar-SA': 0 };
  for (const p of OTHER_PROFILES) scores[p.lang] = 0;

  let faWords = 0;
  let enWords = 0;
  let arWords = 0;
  const scriptCounts = { arabicScript: 0, latin: 0, cyrillic: 0, devanagari: 0, kana: 0, hangul: 0, han: 0 };

  for (const tok of tokens) {
    const raw = tok.value;
    const lower = raw.toLowerCase();
    const norm = normalizeForMatch(raw);
    const group = charScriptGroup(raw[0] || '');
    if (group in scriptCounts) scriptCounts[group] += 1;

    if (group === 'arabicScript') {
      if (faStop.has(norm)) { scores['fa-IR'] += 3; faWords += 1; continue; }
      if (arStop.has(norm)) { scores['ar-SA'] += 3; arWords += 1; continue; }
      if (PERSIAN_ONLY_LETTERS.test(raw)) { scores['fa-IR'] += 2; faWords += 1; continue; }
      if (ARABIC_MARKERS.test(raw) || ARABIC_AL.test(norm)) { scores['ar-SA'] += 2; arWords += 1; continue; }
      // ambiguous Persian/Arabic script word: micro-signals
      if (/[\u06CC\u06A9]/.test(raw)) { scores['fa-IR'] += 1.2; faWords += 1; }
      else if (ARABIC_AL.test(raw)) { scores['ar-SA'] += 1.5; arWords += 1; }
      else { scores['fa-IR'] += 0.6; scores['ar-SA'] += 0.6; }
      continue;
    }

    if (group === 'latin') {
      enWords += 1;
      if (enStop.has(lower)) scores['en-US'] += 2.5;
      else scores['en-US'] += 0.8;
      for (const p of OTHER_PROFILES) {
        if (p.script === 'latin' && p.stop.has(lower)) scores[p.lang] += 2.5;
      }
      continue;
    }

    for (const p of OTHER_PROFILES) {
      if (p.script === group) {
        scores[p.lang] += 2;
        if (p.stop.has(norm) || p.stop.has(raw)) scores[p.lang] += 3;
      }
    }
  }

  // Narrow to the configured candidate set (+ other profiles only when the script matches)
  const relevant = Object.entries(scores)
    .filter(([lang, score]) => (candidates.includes(lang) || score > 0) && score > 0)
    .sort((a, b) => b[1] - a[1]);

  const wordCount = tokens.length || 1;
  const top = relevant[0] || ['fa-IR', 0];
  const second = relevant[1] || ['en-US', 0];
  const total = relevant.reduce((acc, [, s]) => acc + s, 0) || 1;
  let lang = top[0];
  // With no evidence at all, fall back to the first configured candidate.
  if (top[1] === 0) lang = candidates[0] || 'en-US';

  const margin = top[1] - second[1];
  const confidence = Math.max(0, Math.min(1, (margin / total) * 0.75 + Math.min(1, total / (wordCount * 2)) * 0.25));

  const mixed = (lang === 'fa-IR' || lang === 'ar-SA') && enWords > 0;

  return {
    lang,
    confidence: Number(confidence.toFixed(3)),
    scores,
    mixed,
    latinWordCount: enWords,
    persianWordCount: faWords,
    arabicWordCount: arWords,
    wordCount: tokens.length,
    scriptCounts
  };
}

/**
 * Segment a transcript by language for the UI ("which words were Persian, which English").
 * @returns {Array<{text:string, lang:string}>}
 */
export function detectSegments(text, options = {}) {
  const tokens = tokenize(String(text ?? ''));
  const out = [];
  let buffer = '';
  let current = null;

  const flush = () => {
    if (buffer) out.push({ text: buffer, lang: current });
    buffer = '';
  };

  for (const tok of tokens) {
    if (tok.type === TOKEN.SPACE) { buffer += tok.value; continue; }
    const group = charScriptGroup(tok.value[0] || '');
    let lang = null;
    if (group === 'latin') lang = 'en';
    else if (group === 'arabicScript') {
      const norm = normalizeForMatch(tok.value);
      if (arStop.has(norm) && !faStop.has(norm)) lang = 'ar';
      else lang = 'fa';
    } else lang = current || 'other';

    if (current !== null && lang !== current && !(current === 'fa' && lang === 'fa')) {
      flush();
    }
    current = lang;
    buffer += tok.value;
  }
  flush();
  return out.filter((s) => s.text.trim().length > 0 || s.text.includes('\n'));
}

/** Pick the recognition language to use for the *next* session. */
export function chooseEngineLang(settings, detection, activeLang) {
  const manual = settings.language?.mode === 'manual';
  if (manual) return settings.language.manualLang || 'en-US';
  if (!detection || !settings.language?.autoDetect) return activeLang || settings.language?.fallbackLang || 'en-US';
  return detection.lang;
}

/** Does the new utterance justify switching the active recognition language? */
export function shouldSwitchLanguage(currentLang, detection, settings) {
  if (!currentLang || !detection) return false;
  if (settings.language?.mode === 'manual') return false;
  const minConfidence = Number(settings.language?.switchConfidence ?? 0.55);
  const minWords = Number(settings.language?.minWordsForSwitch ?? 2);
  if (detection.lang === currentLang) return false;
  const sameBase = String(detection.lang).slice(0, 2) === String(currentLang).slice(0, 2);
  if (sameBase) return false;
  if (detection.wordCount < minWords) return false;
  return detection.confidence >= minConfidence;
}
