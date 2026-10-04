/**
 * Candidate arbitration for the experimental dual-engine mode.
 *
 * Two recognisers run in parallel with different languages; for every utterance both of them
 * produce a transcript and exactly one must survive. The decision is deliberately based on
 * *observable script statistics* rather than on "feels better":
 *
 *   1. what language does the combined evidence look like?
 *   2. which candidate's script profile matches that language?
 *   3. tie-breaker: the candidate that captured more content.
 *
 * Pure functions → unit tested without a browser.
 */
import { scriptProfile } from './scriptStats.js';

/**
 * @param {{text:string, lang:string, at?:number, engine?:string}} candidate
 * @param {string} expectedLang BCP-47 of the dominant language of the utterance
 */
export function scoreCandidate(candidate, expectedLang) {
  const text = String(candidate?.text || '');
  if (!text.trim()) return -Infinity;
  const profile = scriptProfile(text);
  const base = String(expectedLang || '').slice(0, 2);
  const candidateBase = String(candidate.lang || '').slice(0, 2);

  let score = 0;
  if (base === 'fa' || base === 'ar') {
    score += profile.persianRatio * 3;
    if (profile.persianRatio < 0.25 && text.length > 8) score -= 2.5; // Latin gibberish for Persian speech
    score += Math.min(1, profile.technicalHits / 3) * 0.3;
  } else {
    score += profile.latinRatio * 3;
    if (profile.persianRatio > 0.55) score -= 2.5; // Persian script where English was spoken
  }
  if (candidateBase === base) score += 0.4;
  score += Math.min(1, text.trim().length / 120) * 0.4; // slightly prefer richer transcripts
  return Number(score.toFixed(4));
}

/**
 * @param {Array<{text:string, lang:string, at?:number}>} candidates
 * @param {{detectedLang?:string}} options
 * @returns {{winner:object|null, scored:Array<object>, expectedLang:string}}
 */
export function arbitrate(candidates, options = {}) {
  const list = (candidates || []).filter((c) => c && String(c.text || '').trim());
  if (list.length === 0) return { winner: null, scored: [], expectedLang: options.detectedLang || '' };
  // identical transcripts → keep the first one
  const unique = [];
  const seen = new Set();
  for (const c of list) {
    const key = normalize(c.text);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  const expectedLang = options.detectedLang || detectFromCandidates(unique);
  const scored = unique
    .map((c) => ({ candidate: c, score: scoreCandidate(c, expectedLang) }))
    .sort((a, b) => (b.score - a.score) || (String(b.candidate.text).length - String(a.candidate.text).length));
  return { winner: scored[0]?.candidate || null, scored, expectedLang };
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Very small dominant-language guess used only when the caller has no detection available. */
function detectFromCandidates(candidates) {
  let persian = 0;
  let latin = 0;
  for (const c of candidates) {
    const p = scriptProfile(c.text);
    persian += p.persianChars;
    latin += p.latinChars;
  }
  return persian >= latin ? 'fa-IR' : 'en-US';
}
