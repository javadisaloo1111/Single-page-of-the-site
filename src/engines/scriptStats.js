/** Script statistics used by engine arbitration and by the debug panel. */
import { CASING_HINTS, TECHNICAL_TERMS } from '../nlp/technicalTerms.js';
import { normalizeForMatch } from '../nlp/persian.js';

const TERM_KEYS = new Set([
  ...TECHNICAL_TERMS.map((t) => t.term.toLowerCase()),
  ...Object.keys(CASING_HINTS)
]);

export function scriptProfile(text) {
  const src = String(text || '');
  let persianChars = 0;
  let latinChars = 0;
  let other = 0;
  for (const ch of src) {
    if (/\s/.test(ch)) continue;
    if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(ch)) persianChars += 1;
    else if (/[A-Za-z]/.test(ch)) latinChars += 1;
    else other += 1;
  }
  const total = persianChars + latinChars || 1;
  const words = src.split(/\s+/).filter(Boolean);
  let technicalHits = 0;
  for (const word of words) {
    const clean = word.replace(/[^\p{L}\p{N}.+#-]/gu, '');
    if (!clean) continue;
    if (TERM_KEYS.has(clean.toLowerCase())) technicalHits += 1;
  }
  return {
    persianChars,
    latinChars,
    otherChars: other,
    persianRatio: persianChars / total,
    latinRatio: latinChars / total,
    technicalHits,
    words: words.length,
    normalized: normalizeForMatch(src)
  };
}
