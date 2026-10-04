/**
 * Code-switching / mixed-language reconstruction.
 *
 * The recognition engine returns Persian-script transliterations of English technical
 * words ("ری‌اکت", "لاراول", "ای پی آی", "نکست جی اس") mixed into Persian sentences.
 * This module maps those back to the canonical Latin spelling so the produced text keeps
 * the language each word was actually spoken in — the core requirement of the project.
 *
 * It also fixes lower-cased Latin technical words ("react" -> "React", "api" -> "API")
 * and applies the user's custom dictionary.
 */
import { TECHNICAL_TERMS, CASING_HINTS } from './technicalTerms.js';
import { normalizeForMatch, compactKey } from './persian.js';
import { tokenize, TOKEN } from './tokenize.js';
import { levenshtein } from '../common/util.js';

const MAX_SPAN_TOKENS = 4;
const FUZZY_MIN_LEN = 5;

function stripDiacriticsAndJoin(s) {
  return compactKey(s);
}

/** Build a lookup index from the builtin lexicon + user terms. */
export function buildTermIndex(extraTerms = []) {
  const faExact = new Map();   // compactKey(persian alias) -> entry
  const faTokens = new Map();  // compactKey(persian alias) -> token count hint
  const latExact = new Map();  // lowercased latin form      -> entry
  const conflicts = [];

  const add = (entry, source) => {
    const record = { term: entry.term, kind: entry.kind || 'proper', category: entry.category || 'custom', source };
    for (const alias of entry.fa || []) {
      const key = stripDiacriticsAndJoin(alias);
      if (!key || key.length < 2) continue;
      if (faExact.has(key) && faExact.get(key).term !== record.term) {
        conflicts.push({ key, kept: faExact.get(key).term, skipped: record.term });
        continue;
      }
      faExact.set(key, record);
      faTokens.set(key, normalizeForMatch(alias).split(' ').filter(Boolean).length);
    }
    for (const alias of entry.en || []) {
      const key = String(alias).toLowerCase();
      if (!key) continue;
      if (!latExact.has(key)) latExact.set(key, record);
    }
    // The canonical spelling itself is also a latin lookup key.
    latExact.set(String(entry.term).toLowerCase(), record);
  };

  for (const entry of TECHNICAL_TERMS) add(entry, 'builtin');
  for (const entry of extraTerms) {
    if (!entry || !entry.term) continue;
    add({ term: entry.term, kind: entry.kind || 'proper', category: entry.category || 'user', fa: entry.fa || [], en: entry.en || [] }, 'user');
  }

  // fuzzy candidates: compact alias keys long enough to be safely fuzzy matched,
  // bucketed by length so lookups stay O(candidates of same length) instead of O(all).
  const fuzzyByLength = new Map();
  for (const key of faExact.keys()) {
    if (key.length < FUZZY_MIN_LEN) continue;
    const bucket = fuzzyByLength.get(key.length) || [];
    bucket.push(key);
    fuzzyByLength.set(key.length, bucket);
  }
  return { faExact, faTokens, latExact, fuzzyByLength, conflicts };
}

/** Lazily built default index (builtin lexicon only). */
let defaultIndex = null;
export function getDefaultTermIndex() {
  if (!defaultIndex) defaultIndex = buildTermIndex([]);
  return defaultIndex;
}

function isUrlLike(token) {
  return /[@/\\]|^https?:|\.(com|ir|org|net|io|dev|ai|co|me)$/i.test(token);
}

const COMPOUND_JOINERS = new Set(['.', '/', '-', '_', '@', ':', '+', '#']);

/**
 * True when the token is glued to a neighbouring punctuation char without spaces,
 * i.e. it is part of a compound such as `Next.js`, `node.js`, `chrome/extension`,
 * `user-id` or an e-mail/URL. Compound members must never be rewritten on their own.
 */
function isInsideCompound(tokens, index) {
  const prev = tokens[index - 1];
  const next = tokens[index + 1];
  const touchesPrev = prev && prev.type === TOKEN.PUNCT && prev.end === tokens[index].start && COMPOUND_JOINERS.has(prev.value);
  const touchesNext = next && next.type === TOKEN.PUNCT && next.start === tokens[index].end && COMPOUND_JOINERS.has(next.value);
  return Boolean(touchesPrev || touchesNext);
}

/**
 * Rewrite Persian transliterations + Latin casing.
 *
 * @param {string} text
 * @param {{index?:object, preserveEnglishWords?:boolean, englishizeGenericTerms?:boolean,
 *          fuzzyMatch?:boolean, customRules?:Array}} options
 */
export function applyCodeSwitch(text, options = {}) {
  const {
    index = getDefaultTermIndex(),
    preserveEnglishWords = true,
    englishizeGenericTerms = false,
    fuzzyMatch = true,
    customRules = []
  } = options;

  if (!preserveEnglishWords && !englishizeGenericTerms && customRules.length === 0) {
    return { text: String(text ?? ''), replacements: [] };
  }

  let working = String(text ?? '');
  const replacements = [];
  let protectedValues = [];

  // 1) user rules win over builtin behaviour: their output is parked behind sentinels so the
  //    builtin transpiler (ReactJS -> React) cannot undo an explicit user decision.
  if (customRules.length) {
    const res = applyCustomRules(working, customRules, { protect: true });
    working = res.text;
    protectedValues = res.protectedValues;
    replacements.push(...res.replacements);
  }

  // 2) token/span pass over Persian script transliterations + Latin casing
  const tokens = tokenize(working);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type !== TOKEN.WORD) { out.push(tok.value); i += 1; continue; }

    if (tok.script === 'latin') {
      // A token glued to `.`/`/`/`-`/`@` belongs to a compound (`Next.js`, `node.js`,
      // `user-id`, `name@host`): rewriting a member on its own would corrupt the compound.
      const fixed = isInsideCompound(tokens, i)
        ? null
        : fixLatinToken(tok.value, index, { englishizeGenericTerms });
      if (fixed && fixed !== tok.value) {
        replacements.push({ from: tok.value, to: fixed, kind: 'casing' });
        out.push(fixed);
      } else out.push(tok.value);
      i += 1;
      continue;
    }

    if (tok.script === 'persian' && preserveEnglishWords) {
      const match = findPersianTerm(tokens, i, index, { fuzzyMatch, englishizeGenericTerms });
      if (match) {
        replacements.push({ from: match.matched, to: match.entry.term, kind: match.entry.source === 'user' ? 'user' : 'transliteration' });
        out.push(match.entry.term);
        i = match.endIndex;
        continue;
      }
    }

    out.push(tok.value);
    i += 1;
  }

  let result = out.join('');
  if (protectedValues.length) result = restoreProtected(result, protectedValues);
  // Remove the stray space the engine sometimes leaves between a replaced term and punctuation
  result = result.replace(/\s+([،؛؟!.:])/g, '$1');
  return { text: result, replacements };
}

function fixLatinToken(word, index, { englishizeGenericTerms }) {
  if (isUrlLike(word)) return null;
  const lower = word.toLowerCase();
  const entry = index.latExact.get(lower);
  if (entry) {
    if (entry.kind === 'generic' && !englishizeGenericTerms) {
      // still normalise pure-ASCII casing for well-known shortenings (api -> API)
      const hint = CASING_HINTS[lower];
      if (hint && hint.toLowerCase() === lower) return hint;
      return null;
    }
    return entry.term;
  }
  const hint = CASING_HINTS[lower];
  if (hint) return hint;
  return null;
}

/** Longest-span-first lookup of a Persian transliteration starting at `startIndex`. */
function findPersianTerm(tokens, startIndex, index, { fuzzyMatch, englishizeGenericTerms = false }) {
  for (let span = Math.min(MAX_SPAN_TOKENS, 4); span >= 1; span -= 1) {
    const picked = [];
    let cursor = startIndex;
    let endIndex = startIndex;
    while (picked.length < span && cursor < tokens.length) {
      const t = tokens[cursor];
      if (t.type === TOKEN.WORD) {
        if (t.script === 'latin') break; // never swallow Latin words into a Persian span
        if (t.script === 'mixed') break;
        picked.push(t);
        cursor += 1;
        endIndex = cursor;
        continue;
      }
      if (t.type === TOKEN.SPACE) { cursor += 1; continue; }
      break; // punctuation / other symbols end the span
    }
    if (picked.length < span) continue;

    const joined = picked.map((t) => t.value).join(' ');
    const key = stripDiacriticsAndJoin(joined);
    const entry = index.faExact.get(key) || (fuzzyMatch ? fuzzyLookup(key, index, span) : null);
    // generic vocabulary ("سرور", "دیتابیس") is only rewritten when the user opts in —
    // Persian speakers normally write those loanwords in Persian script.
    if (entry && (entry.kind !== 'generic' || englishizeGenericTerms)) {
      return { entry, matched: joined, startIndex, endIndex };
    }
  }
  return null;
}

function fuzzyLookup(key, index, span) {
  if (span !== 1 || key.length < FUZZY_MIN_LEN) return null;
  const maxDist = key.length >= 9 ? 2 : 1;
  let bestEntry = null;
  let bestDist = maxDist + 1;
  for (let len = key.length - maxDist; len <= key.length + maxDist; len += 1) {
    const bucket = index.fuzzyByLength.get(len);
    if (!bucket) continue;
    for (const candidate of bucket) {
      const d = levenshtein(key, candidate, maxDist);
      if (d < bestDist) {
        bestDist = d;
        bestEntry = index.faExact.get(candidate);
        if (d === 1) break;
      }
    }
  }
  return bestEntry;
}

const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';

export function restoreProtected(text, values) {
  return String(text ?? '')
    .replace(/\uE000(\d+)\uE001/g, (m, idx) => values[Number(idx)] ?? '')
    .replace(/[\uE000\uE001]/g, '');
}

/**
 * Apply user dictionary rules.
 * rule = { pattern, replacement, mode:'word'|'substring'|'regex'|'compact', caseSensitive }
 * With `protect: true` the replacement text is written as a sentinel so a later pass cannot
 * rewrite it; call `restoreProtected` afterwards.
 */
export function applyCustomRules(text, rules, { protect = false } = {}) {
  let out = String(text ?? '');
  const replacements = [];
  const protectedValues = [];
  const emit = (match, replacement) => {
    if (match === replacement) return match;
    replacements.push({ from: match, to: replacement, kind: 'user' });
    if (!protect) return replacement;
    protectedValues.push(replacement);
    return `${PH_OPEN}${protectedValues.length - 1}${PH_CLOSE}`;
  };
  for (const rule of rules || []) {
    if (!rule || typeof rule.pattern !== 'string' || typeof rule.replacement !== 'string') continue;
    if (rule.pattern.length === 0 || rule.pattern.length > 200) continue;
    if (rule.enabled === false) continue;
    const mode = rule.mode || 'word';
    try {
      if (mode === 'regex') {
        if (looksUnsafeRegex(rule.pattern)) continue;
        const re = new RegExp(rule.pattern, rule.caseSensitive ? 'gu' : 'giu');
        out = out.replace(re, (...args) => {
          const m = args[0];
          const groups = typeof args[args.length - 1] === 'object' ? args[args.length - 1] : null;
          const replacement = expandReplacement(rule.replacement, m, args.slice(1, groups ? args.length - 2 : args.length - 1), groups);
          return emit(m, replacement);
        });
      } else if (mode === 'substring' || mode === 'compact') {
        const flags = rule.caseSensitive ? 'g' : 'gi';
        const escaped = escapeRegExp(rule.pattern);
        const re = new RegExp(mode === 'compact' ? escaped.replace(/\\?\s+/g, '\\s*') : escaped, flags);
        out = out.replace(re, (m) => emit(m, rule.replacement));
      } else {
        const escaped = escapeRegExp(rule.pattern).replace(/\s+/g, '\\s+');
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, rule.caseSensitive ? 'gu' : 'giu');
        out = out.replace(re, (m, pre, hit) => `${pre}${emit(hit, rule.replacement)}`);
      }
    } catch (err) {
      // never let a bad user rule break dictation
      continue;
    }
  }
  return { text: protect ? out : restoreProtected(out, protectedValues), replacements, protectedValues };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Support $0..$9 group references inside user regex replacements. */
export function expandReplacement(template, match, groups = [], named = null) {
  return String(template)
    .replace(/\$(\d)/g, (m, digit) => {
      const idx = Number(digit);
      if (idx === 0) return match;
      return groups[idx - 1] ?? '';
    })
    .replace(/\$\{([a-zA-Z_$][\w$]*)\}/g, (m, name) => (named && named[name] !== undefined ? String(named[name]) : ''));
}

/** Reject obviously catastrophic regex constructs coming from user input. */
export function looksUnsafeRegex(pattern) {
  if (pattern.length > 200) return true;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return true; // (a+)+ style
  if (/\[[^\]]*\][+*]\+/.test(pattern)) return true;
  if (/\\[1-9]/.test(pattern)) return true;                  // backreferences
  return false;
}
