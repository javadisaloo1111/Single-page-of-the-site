/**
 * Persian/Arabic text normalization + half-space (نیم‌فاصله) correction.
 * Pure functions — no DOM, no chrome APIs — fully unit tested.
 */
import { tokenize, TOKEN, scriptOf } from './tokenize.js';
import { PROTECTED_FA_WORDS } from './technicalTerms.js';

const ZWNJ = '\u200C';
const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g;

export const PUNCT_MAP_TO_FA = Object.freeze({
  ',': '،',
  ';': '؛',
  '?': '؟',
  '%': '٪'
});

const PROTECTED = new Set(PROTECTED_FA_WORDS.map((w) => w.replace(/[\u200c-]/g, '')));

/** Unify Arabic/Persian letter variants and strip diacritics (matching-grade normalization). */
export function normalizeForMatch(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[\u064A\u0649]/g, 'ی')      // ي ى -> ی
    .replace(/[\u0643]/g, 'ک')            // ك -> ک
    .replace(/[\u0623\u0625\u0622]/g, 'ا') // أ إ آ -> ا
    .replace(/[\u0629]/g, 'ه')            // ة -> ه
    .replace(/[\u0640]/g, '')             // tatweel
    /* eslint-disable-next-line no-misleading-character-class -- ZWNJ/ZWJ/LRM/RLM are exactly what we strip */
    .replace(/[\u200C\u200D\u200E\u200F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize for matching AND drop spaces (catches "نکست جی اس" vs "نکستجیاس"). */
export function compactKey(text) {
  return normalizeForMatch(text).replace(/[\s\-_.]/g, '').toLowerCase();
}

/** Light cosmetic normalization applied to the produced transcript. */
export function normalizePersian(text, options = {}) {
  const { fixArabicChars = true, fixPunctuation = true } = options;
  let out = String(text ?? '');
  if (fixArabicChars) {
    out = out
      .replace(/\u064A/g, 'ی')
      .replace(/\u0649/g, 'ی')
      .replace(/\u0643/g, 'ک')
      .replace(/\u0629/g, 'ه');
  }
  if (fixPunctuation) {
    // Only convert punctuation directly attached to a Persian word / surrounded by Persian text.
    out = out.replace(/([\u0600-\u06FF])\s*,\s*/g, '$1، ')
      .replace(/([\u0600-\u06FF])\s*;\s*/g, '$1؛ ')
      .replace(/([\u0600-\u06FF])\s*\?\s*/g, '$1؟ ');
  }
  return out;
}

export function toPersianDigits(text) {
  return String(text ?? '').replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d)));
}

export function toEnglishDigits(text) {
  return String(text ?? '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
    .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
}

const MI_PREFIX = /^(ن?می)([\u0600-\u06FF]{2,})$/;
const VERB_ENDING = /[مدی]$/;

/**
 * Rewrite "میخواهم" -> "می‌خواهم", "کتابها" -> "کتاب‌ها", "بهتر" untouched.
 * Deliberately conservative: it only touches forms it can prove.
 */
export function fixHalfSpace(text, options = {}) {
  const { joinWords = true, applySuffixes = true } = options;
  const tokens = tokenize(String(text ?? ''));
  const out = tokens.map((tok) => {
    if (tok.type !== TOKEN.WORD || tok.script !== 'persian') return tok.value;
    const bare = tok.value.replace(new RegExp(ZWNJ, 'g'), '');
    if (PROTECTED.has(bare)) return tok.value;
    if (tok.value.includes(ZWNJ)) return tok.value;

    let word = tok.value;
    if (joinWords) {
      const mi = MI_PREFIX.exec(bare);
      if (mi && VERB_ENDING.test(mi[2]) && mi[2].length >= 2) {
        word = `${mi[1]}${ZWNJ}${mi[2]}`;
        return word;
      }
    }
    if (applySuffixes) {
      const suffixed = applySuffixRules(word);
      if (suffixed) return suffixed;
    }
    return tok.value;
  });
  return out.join('');
}

function applySuffixRules(word) {
  const suffixes = ['هایی', 'هاست', 'های', 'ها', 'ترین', 'تر'];
  for (const suf of suffixes) {
    if (!word.endsWith(suf)) continue;
    const stem = word.slice(0, word.length - suf.length);
    if (stem.length < 2) continue;
    if (/[\s\u200C]$/.test(stem)) continue;
    if (PROTECTED.has(stem)) continue;
    // "ماهها"/"راهها" stay untouched (aliases of the same letters) — require a stem
    // that is not itself a stopword-like short form.
    if (['ما', 'را', 'با', 'تا', 'آن', 'این', 'چه', 'بە'].includes(stem)) continue;
    return `${stem}${ZWNJ}${suf}`;
  }
  return null;
}

/** Collapse repeated spaces and fix spacing around punctuation (script aware). */
export function normalizeSpacing(text) {
  let out = String(text ?? '').replace(/\s+/g, ' ').trim();
  out = out.replace(/\s+([،؛؟!:.٪%])/g, '$1');           // no space before punctuation
  out = out.replace(/([،؛؟!])(?=[^\s\d])/g, '$1 ');        // one space after punctuation
  out = out.replace(/\s{2,}/g, ' ');
  return out;
}

/** Join a base string with an appended chunk: never duplicate/lose the separator. */
export function joinChunks(base, chunk, separator = ' ') {
  const left = String(base ?? '');
  const right = String(chunk ?? '').trim();
  if (!left) return right;
  if (!right) return left;
  const endsOpen = /[\s\u200C]$/.test(left);
  const needsSpace = !endsOpen && !/^[،؛؟!:.)\]]/.test(right);
  return `${left}${needsSpace ? separator : ''}${right}`;
}

/** Decide which punctuation style the surrounding text uses. */
export function scriptDominant(text) {
  let fa = 0;
  let lat = 0;
  for (const ch of String(text ?? '')) {
    const s = scriptOf(ch);
    if (s === 'persian') fa += 1;
    else if (s === 'latin') lat += 1;
  }
  if (fa === 0 && lat === 0) return 'neutral';
  return fa >= lat ? 'fa' : 'en';
}
