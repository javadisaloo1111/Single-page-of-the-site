/**
 * Tokenizer with source spans.
 * Keeps separators so the pipeline can rebuild text without losing whitespace,
 * and provides a script classification per token (latin / persian / arabic / digit / punct).
 */

const PERSIAN_RANGE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RANGE = /[A-Za-z\u00C0-\u024F]/;
const DIGIT_RANGE = /[0-9\u0660-\u0669\u06F0-\u06F9]/;

export const TOKEN = Object.freeze({
  WORD: 'word',
  SPACE: 'space',
  PUNCT: 'punct',
  OTHER: 'other'
});

export function scriptOf(char) {
  if (PERSIAN_RANGE.test(char)) return 'persian';
  if (LATIN_RANGE.test(char)) return 'latin';
  if (DIGIT_RANGE.test(char)) return 'digit';
  return 'other';
}

/**
 * @param {string} text
 * @returns {Array<{value:string,start:number,end:number,type:string,script:string}>}
 */
export function tokenize(text) {
  const out = [];
  if (typeof text !== 'string' || text.length === 0) return out;
  let i = 0;
  let buf = '';
  let type = null;
  let start = 0;
  let script = 'other';

  const flush = (end) => {
    if (!buf) return;
    out.push({ value: buf, start, end, type, script });
    buf = '';
  };

  for (i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const chScript = scriptOf(ch);
    const isJoiner = ch === '\u200C' || ch === '\u200D'; // ZWNJ / ZWJ stay inside the word
    let nextType;
    if (/\s/.test(ch)) nextType = TOKEN.SPACE;
    else if (isJoiner && type === TOKEN.WORD) nextType = TOKEN.WORD;
    else if (/[\p{P}\p{S}]/u.test(ch)) nextType = TOKEN.PUNCT;
    else if (chScript !== 'other') nextType = TOKEN.WORD;
    else nextType = TOKEN.OTHER;

    // A word token may mix scripts (e.g. "Next.js" or "میکنم") — that is intended.
    const continueMixedWord = type === TOKEN.WORD && nextType === TOKEN.WORD;

    if (type === null) {
      type = nextType; start = i; buf = ch; script = chScript;
    } else if (nextType === type || continueMixedWord) {
      buf += ch;
      if (!isJoiner && continueMixedWord && script !== chScript && chScript !== 'other') script = 'mixed';
    } else {
      flush(i);
      type = nextType; start = i; buf = ch; script = chScript;
    }
  }
  flush(text.length);
  return out;
}

/** Word tokens only. */
export function words(text) {
  return tokenize(text).filter((t) => t.type === TOKEN.WORD);
}

/** True when the string has any Persian/Arabic script character. */
export function hasPersianScript(text) {
  return PERSIAN_RANGE.test(String(text || ''));
}

export function hasLatinScript(text) {
  return LATIN_RANGE.test(String(text || ''));
}

/** Ratio of latin letters among all letters (0..1). */
export function latinRatio(text) {
  let latin = 0;
  let total = 0;
  for (const ch of String(text || '')) {
    const s = scriptOf(ch);
    if (s === 'latin') { latin += 1; total += 1; } else if (s === 'persian') { total += 1; }
  }
  return total === 0 ? 0 : latin / total;
}
