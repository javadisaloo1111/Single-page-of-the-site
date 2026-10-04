/**
 * Smart punctuation / capitalization.
 *
 * Levels
 *   safe        – only cleans duplicated punctuation and decides the FINAL mark (؟ . !).
 *   balanced    – adds a comma before clause conjunctions when the preceding clause is
 *                 clearly a clause (>= 4 words and contains a verb).
 *   aggressive  – also separates leading discourse markers («خب،» «راستش،») and adds a
 *                 comma before «و» in long clauses.
 *
 * Everything here is heuristic and therefore optional in Settings.
 */
import { scriptDominant } from './persian.js';

const FA_QUESTION_WORDS = ['آیا', 'مگه', 'چرا', 'چطور', 'چطوری', 'کی', 'کجا', 'چی', 'چند', 'چقدر', 'کدام', 'کدوم', 'چگونه', 'می‌شه', 'میشه'];
const EN_QUESTION_WORDS = ['what', 'where', 'when', 'why', 'how', 'who', 'which', 'whose', 'is', 'are', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will'];

const FA_VERB_HINTS = ['است', 'هست', 'نیست', 'شد', 'شده', 'شود', 'کن', 'کنم', 'کند', 'کرد', 'کردم', 'کنیم', 'کنید', 'دارم', 'دارد', 'داریم', 'بود', 'بودم', 'میشه', 'می‌شه', 'می‌کنم', 'میکنم', 'می‌خوام', 'می‌خواهم', 'میخوام', 'بده', 'بگیر', 'برو', 'بیا', 'بزن', 'بساز', 'نوشتم', 'گفتم', 'رفتم', 'اومدم', 'باید', 'نمی‌شه', 'نمیشه', 'می‌تونم', 'میتونم'];
const FA_VERB_ENDINGS = /(م|ی|د|ند|یم|ید)$/;
const EN_VERB_HINTS = ['is', 'are', 'was', 'were', 'be', 'am', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'can', 'should', 'could', 'would', 'make', 'made', 'write', 'wrote', 'build', 'built', 'need', 'needs', 'want', 'wants', 'go', 'goes', 'went', 'fix', 'fixed'];

const FA_CLAUSE_MARKERS = ['اما', 'ولی', 'بنابراین', 'پس', 'چون', 'زیرا', 'اگرچه', 'درحالی‌که', 'در حالی که', 'با این حال'];
const FA_DISCOURSE_MARKERS = ['خب', 'ببین', 'راستش', 'در واقع', 'حقیقتش', 'خلاصه', 'بنابراین'];
const EN_CLAUSE_MARKERS = ['but', 'because', 'however', 'although', 'so', 'therefore', 'which', 'while'];

const TERMINAL = /[.!?؟…]/;

/** Remove duplicated / misplaced punctuation characters. */
export function cleanupPunctuation(text) {
  let out = String(text ?? '');
  out = out.replace(/([.!?؟…])[.!?؟…]+/g, '$1');
  out = out.replace(/([،,؛;])\s*\1+/g, '$1');
  out = out.replace(/\s+([،؛؟!.:…,;])/g, '$1');
  out = out.replace(/([،؛,;:])(?=[^\s\d])/g, '$1 ');
  out = out.replace(/\.\s*\./g, '.');
  return out;
}

function isQuestion(tokens, lang) {
  const words = tokens.slice(0, 4).map((w) => w.replace(/[\u200c]/g, ''));
  if (lang === 'fa-IR' || lang === 'ar-SA') {
    return words.some((w) => FA_QUESTION_WORDS.includes(w) || FA_QUESTION_WORDS.includes(w.replace(/[؟?]/g, '')));
  }
  const lower = tokens.map((w) => w.toLowerCase());
  return EN_QUESTION_WORDS.includes(lower[0]) && !EN_VERB_HINTS.slice(0, 3).includes(lower[0]);
}

function looksLikeSentence(tokens, lang) {
  if (tokens.length < 3) return false;
  const clean = tokens.map((w) => w.replace(/[،؛؟!.,:…]/g, ''));
  if (lang === 'fa-IR' || lang === 'ar-SA') {
    return clean.some((w) => FA_VERB_HINTS.includes(w) || (w.length > 2 && FA_VERB_ENDINGS.test(w)));
  }
  const lower = clean.map((w) => w.toLowerCase());
  return lower.some((w) => EN_VERB_HINTS.includes(w)) || lower.length >= 4;
}

function isExclamation(tokens) {
  const first = String(tokens[0] || '').replace(/[!.]/g, '');
  return ['چه', 'چقدر', 'عالی', 'آفرین', 'ایول', 'باریکلا', 'واو'].includes(first);
}

function addCommas(text, lang, level) {
  const markers = (lang === 'fa-IR' || lang === 'ar-SA') ? FA_CLAUSE_MARKERS : EN_CLAUSE_MARKERS;
  const comma = (lang === 'fa-IR' || lang === 'ar-SA') ? '،' : ',';
  let out = text;
  for (const marker of markers) {
    const re = new RegExp(`\\s+(${marker})\\s+`, 'g');
    out = out.replace(re, (match, word, offset) => {
      const before = out.slice(0, offset).trim();
      const beforeWords = before.split(/\s+/).filter(Boolean);
      if (beforeWords.length < 4) return match;
      if (!looksLikeSentence(beforeWords, lang)) return match;
      if (/[،,؛;:]$/.test(before)) return match;
      return `${comma} ${word} `;
    });
  }
  if (level === 'aggressive') {
    const discourse = (lang === 'fa-IR' || lang === 'ar-SA') ? FA_DISCOURSE_MARKERS : ['however', 'actually'];
    for (const marker of discourse) {
      const re = new RegExp(`^${marker}\\s+`, 'i');
      out = out.replace(re, (m) => `${marker}${comma} `);
    }
  }
  return out;
}

function capitalizeSentences(text) {
  const parts = text.split(/([.!?…؟]\s+)/);
  let expectUpper = true;
  const out = parts.map((part) => {
    if (/^[.!?…؟]\s+$/.test(part)) { expectUpper = true; return part; }
    if (!part) return part;
    if (expectUpper) {
      expectUpper = false;
      return part.replace(/^([a-z])/, (m) => m.toUpperCase()).replace(/^i\b/, 'I');
    }
    return part;
  });
  return out.join('').replace(/\bi\b/g, 'I');
}

/**
 * @param {string} text
 * @param {{lang?:string, level?:'safe'|'balanced'|'aggressive', enabled?:boolean,
 *          autoCapitalize?:boolean, terminal?:boolean}} options
 */
export function smartPunctuate(text, options = {}) {
  const {
    lang = 'fa-IR',
    level = 'safe',
    enabled = true,
    autoCapitalize = true,
    terminal = true
  } = options;

  let out = String(text ?? '').trim();
  if (!enabled) return out;
  if (!out) return out;

  out = cleanupPunctuation(out);
  const tokens = out.split(/\s+/).filter(Boolean);
  const lang_ = (lang === 'auto' || !lang) ? (scriptDominant(out) === 'en' ? 'en-US' : 'fa-IR') : lang;

  if (level !== 'safe') out = addCommas(out, lang_, level);

  if (terminal && !TERMINAL.test(out) && !/[،؛:,]$/.test(out)) {
    if (isQuestion(tokens, lang_)) out += (lang_ === 'fa-IR' || lang_ === 'ar-SA') ? '؟' : '?';
    else if (isExclamation(tokens)) out += '!';
    else if (looksLikeSentence(tokens, lang_)) out += '.';
  }

  if (autoCapitalize && (lang_ === 'en-US' || lang_ === 'en-GB')) out = capitalizeSentences(out);
  else if (autoCapitalize) out = out.replace(/\bi\b/g, 'I');

  return cleanupPunctuation(out).replace(/\s{2,}/g, ' ').trim();
}

/** Split a transcript into sentences (used by «delete last» and history preview). */
export function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?؟…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
