/**
 * Voice commands (Persian + English aliases).
 *
 * Safety rules that stop normal speech from turning into commands:
 *   1. `kind: 'action'` commands only fire when they are the WHOLE utterance or the
 *      TRAILING sequence of it (e.g. «... متن من، خط جدید»).
 *   2. punctuation commands may appear inline, but the number module already consumed
 *      decimal phrases such as «دو نقطه پنج» before this runs.
 *   3. Aliases shorter than 3 characters are never matched inline.
 *   4. `settings.voiceCommands.strict` forces whole-utterance matching only.
 */
import { normalizeForMatch } from './persian.js';
import { tokenize, TOKEN } from './tokenize.js';

const K = (s) => normalizeForMatch(s).replace(/\s+/g, ' ').trim();

/**
 * @typedef {{id:string, kind:'action'|'punctuation'|'lang', fa:string[], en:string[], action?:object}} CommandDef
 * @type {CommandDef[]}
 */
export const COMMANDS = [
  // ---------- structural ----------
  { id: 'paragraph', kind: 'action', fa: ['پاراگراف جدید', 'پاراگراف بعدی', 'پاراگراف'], en: ['new paragraph', 'next paragraph'], action: { type: 'key', key: 'Enter', count: 2 } },
  { id: 'newline', kind: 'action', fa: ['خط جدید', 'خط بعدی', 'خط بعد', 'برو خط بعد'], en: ['new line', 'next line', 'line break'], action: { type: 'key', key: 'Enter', count: 1 } },
  { id: 'tab', kind: 'action', fa: ['تب', 'تب جدید'], en: ['tab key'], action: { type: 'key', key: 'Tab', count: 1 } },
  { id: 'space', kind: 'action', fa: ['فاصله'], en: ['space'], action: { type: 'text', value: ' ' } },
  { id: 'backspace', kind: 'action', fa: ['بک اسپیس', 'حذف حرف'], en: ['backspace'], action: { type: 'key', key: 'Backspace', count: 1 } },

  // ---------- editing ----------
  { id: 'clear-all', kind: 'action', fa: ['همه رو پاک کن', 'همه را پاک کن', 'همه چیز رو پاک کن', 'کل متن رو پاک کن', 'همه رو حذف کن'], en: ['clear all', 'delete everything', 'clear everything'], action: { type: 'edit', op: 'clearAll' } },
  { id: 'delete-last', kind: 'action', fa: ['پاک کن', 'حذف کن', 'آخرین رو پاک کن', 'اینو پاک کن', 'این رو پاک کن'], en: ['delete last', 'delete that', 'remove that'], action: { type: 'edit', op: 'deleteLast' } },
  { id: 'undo', kind: 'action', fa: ['برگرد', 'آندو', 'لغو کن', 'عقب برو'], en: ['undo', 'undo that'], action: { type: 'clipboard', op: 'undo' } },
  { id: 'redo', kind: 'action', fa: ['دوباره انجام بده', 'ریدو', 'از نو انجام بده'], en: ['redo', 'redo that'], action: { type: 'clipboard', op: 'redo' } },
  { id: 'copy', kind: 'action', fa: ['کپی کن', 'کپی'], en: ['copy', 'copy that'], action: { type: 'clipboard', op: 'copy' } },
  { id: 'paste', kind: 'action', fa: ['بچسبون', 'پیست کن', 'پیست', 'چسبوندن'], en: ['paste', 'paste that'], action: { type: 'clipboard', op: 'paste' } },
  { id: 'select-all', kind: 'action', fa: ['همه رو انتخاب کن', 'انتخاب همه'], en: ['select all'], action: { type: 'clipboard', op: 'selectAll' } },
  { id: 'stop-dictation', kind: 'action', fa: ['ضبط رو متوقف کن', 'توقف ضبط', 'ضبط را متوقف کن'], en: ['stop dictation', 'stop recording'], action: { type: 'control', op: 'stop' } },

  // ---------- punctuation ----------
  { id: 'p-period', kind: 'punctuation', fa: ['نقطه'], en: ['period', 'full stop'], action: { type: 'text', value: '.', intent: 'terminal' } },
  { id: 'p-comma', kind: 'punctuation', fa: ['ویرگول', 'کاما'], en: ['comma'], action: { type: 'text', value: ',', intent: 'punctuation' } },
  { id: 'p-question', kind: 'punctuation', fa: ['علامت سوال', 'علامت سؤال'], en: ['question mark'], action: { type: 'text', value: '?', intent: 'terminal' } },
  { id: 'p-bang', kind: 'punctuation', fa: ['علامت تعجب'], en: ['exclamation mark', 'exclamation point'], action: { type: 'text', value: '!', intent: 'terminal' } },
  { id: 'p-colon', kind: 'punctuation', fa: ['دو نقطه', 'کولن'], en: ['colon'], action: { type: 'text', value: ':', intent: 'punctuation' } },
  { id: 'p-semicolon', kind: 'punctuation', fa: ['نقطه ویرگول', 'سمی کولن'], en: ['semicolon', 'semi colon'], action: { type: 'text', value: ';', intent: 'punctuation' } },
  { id: 'p-ellipsis', kind: 'punctuation', fa: ['سه نقطه'], en: ['ellipsis'], action: { type: 'text', value: '…', intent: 'terminal' } },
  { id: 'p-dash', kind: 'punctuation', fa: ['خط تیره', 'دش'], en: ['dash', 'hyphen'], action: { type: 'text', value: '-', intent: 'punctuation' } },
  { id: 'p-underline', kind: 'punctuation', fa: ['آندرلاین', 'زیر خط'], en: ['underscore'], action: { type: 'text', value: '_', intent: 'punctuation' } },
  { id: 'p-slash', kind: 'punctuation', fa: ['اسلش'], en: ['slash', 'forward slash'], action: { type: 'text', value: '/', intent: 'punctuation' } },
  { id: 'p-at', kind: 'punctuation', fa: ['ات ساین', 'اِت'], en: ['at sign'], action: { type: 'text', value: '@', intent: 'punctuation' } },
  { id: 'p-hash', kind: 'punctuation', fa: ['هشتگ'], en: ['hashtag', 'hash sign'], action: { type: 'text', value: '#', intent: 'punctuation' } },
  { id: 'p-star', kind: 'punctuation', fa: ['ستاره'], en: ['asterisk', 'star sign'], action: { type: 'text', value: '*', intent: 'punctuation' } },
  { id: 'p-plus', kind: 'punctuation', fa: ['پلاس'], en: ['plus sign'], action: { type: 'text', value: '+', intent: 'punctuation' } },
  { id: 'p-equals', kind: 'punctuation', fa: ['مساوی'], en: ['equals sign'], action: { type: 'text', value: '=', intent: 'punctuation' } },
  { id: 'p-percent', kind: 'punctuation', fa: ['درصد'], en: ['percent sign'], action: { type: 'text', value: '%', intent: 'punctuation' } },
  { id: 'p-paren-open', kind: 'punctuation', fa: ['پرانتز باز'], en: ['open parenthesis'], action: { type: 'text', value: '(', intent: 'punctuation' } },
  { id: 'p-paren-close', kind: 'punctuation', fa: ['پرانتز بسته'], en: ['close parenthesis'], action: { type: 'text', value: ')', intent: 'punctuation' } },
  { id: 'p-quote', kind: 'punctuation', fa: ['گیومه', 'نقل قول'], en: ['quotation mark', 'quote'], action: { type: 'text', value: '"', intent: 'punctuation' } },
  { id: 'p-amp', kind: 'punctuation', fa: ['امپرسند'], en: ['ampersand'], action: { type: 'text', value: '&', intent: 'punctuation' } },
  { id: 'p-equal-equal', kind: 'punctuation', fa: ['مساوی مساوی'], en: ['double equals'], action: { type: 'text', value: '==', intent: 'punctuation' } },
  { id: 'p-arrow', kind: 'punctuation', fa: ['فلش', 'اِرو'], en: ['arrow'], action: { type: 'text', value: '->', intent: 'punctuation' } },

  // ---------- language switching ----------
  { id: 'lang-auto', kind: 'lang', fa: ['تشخیص خودکار زبان', 'حالت خودکار'], en: ['auto language', 'automatic language'], action: { lang: 'auto' } },
  { id: 'lang-fa', kind: 'lang', fa: ['زبان فارسی', 'حالت فارسی'], en: ['switch to persian', 'persian language'], action: { lang: 'fa-IR' } },
  { id: 'lang-en', kind: 'lang', fa: ['زبان انگلیسی', 'حالت انگلیسی'], en: ['switch to english', 'english language'], action: { lang: 'en-US' } },
  { id: 'lang-ar', kind: 'lang', fa: ['زبان عربی', 'حالت عربی'], en: ['switch to arabic', 'arabic language'], action: { lang: 'ar-SA' } }
];

/** Alias index: normalized phrase -> command (longest phrases win). */
export function buildCommandIndex(commands = COMMANDS) {
  /** @type {Map<string, {words:string[], command:CommandDef, alias:string}>} */
  const map = new Map();
  const entries = [];
  for (const cmd of commands) {
    for (const alias of [...(cmd.fa || []), ...(cmd.en || [])]) {
      const norm = K(alias);
      if (!norm) continue;
      const words = norm.split(' ');
      entries.push({ key: norm, words, command: cmd, alias });
    }
  }
  entries.sort((a, b) => b.words.length - a.words.length);
  for (const entry of entries) {
    if (!map.has(entry.key)) map.set(entry.key, entry);
  }
  return { map, maxWords: entries.reduce((m, e) => Math.max(m, e.words.length), 0) };
}

let cachedIndex = null;
function defaultCommandIndex() {
  if (!cachedIndex) cachedIndex = buildCommandIndex();
  return cachedIndex;
}

/**
 * Parse voice commands out of a transcript.
 *
 * @param {string} text
 * @param {{enabled?:boolean, strict?:boolean, allowTrailing?:boolean, lang?:string,
 *          allowedIds?:string[], index?:object}} options
 * @returns {{ops:Array<{type:string,value?:any,...}>, matches:Array<{id:string,matched:string}>}}
 */
export function parseVoiceCommands(text, options = {}) {
  const {
    enabled = true,
    strict = false,
    allowTrailing = true,
    lang = 'fa-IR',
    allowedIds = null,
    index = defaultCommandIndex()
  } = options;

  const source = String(text ?? '');
  const plain = { ops: source ? [{ type: 'text', value: source }] : [], matches: [] };
  if (!enabled || !source.trim()) return plain;

  const tokens = tokenize(source);
  const wordIdx = tokens.map((t, i) => (t.type === TOKEN.WORD ? i : -1)).filter((i) => i >= 0);
  const words = wordIdx.map((i) => K(tokens[i].value));
  if (words.length === 0) return plain;

  // ---- collect candidate matches (longest-first at each position) ----
  const matches = [];
  let i = 0;
  while (i < words.length) {
    let matched = null;
    for (let span = Math.min(index.maxWords, words.length - i); span >= 1; span -= 1) {
      const phrase = words.slice(i, i + span).join(' ');
      const entry = index.map.get(phrase);
      if (!entry) continue;
      if (allowedIds && !allowedIds.includes(entry.command.id)) continue;
      matched = { entry, startWord: i, span };
      break;
    }
    if (matched) {
      matches.push(matched);
      i += matched.span;
    } else {
      i += 1;
    }
  }
  if (matches.length === 0) return plain;

  // ---- filter unsafe matches ----
  const lastWordIndex = words.length - 1;
  const filtered = matches.filter((m, idx) => {
    const { command } = m.entry;
    const isWholeUtterance = m.startWord === 0 && m.span === words.length;
    if (isWholeUtterance) return true;
    if (strict) return false;
    const endsUtterance = m.startWord + m.span - 1 === lastWordIndex;
    if (command.kind === 'punctuation' && command.action.intent === 'punctuation') {
      // inline punctuation is fine ("... تست ات ساین دامین"), but a 1-char alias must be word-like
      return m.entry.alias.length >= 3;
    }
    if (command.kind === 'action' || command.kind === 'lang' || command.kind === 'punctuation') {
      if (!allowTrailing) return false;
      if (!endsUtterance && !(command.kind === 'punctuation' && idx > 0)) return false;
      // avoid firing from the middle of a longer phrase
      return m.entry.alias.length >= 2;
    }
    return false;
  });
  if (filtered.length === 0) return plain;

  // ---- rebuild the text with matched spans removed, producing ordered ops ----
  const ops = [];
  const consumedMatches = [];
  let cursor = 0; // character cursor in source
  for (const m of filtered) {
    const startTok = tokens[wordIdx[m.startWord]];
    const endTok = tokens[wordIdx[m.startWord + m.span - 1]];
    const start = startTok.start;
    const end = endTok.end;

    let chunk = source.slice(cursor, start);
    // strip the connector whitespace/punctuation that preceded the command
    chunk = chunk.replace(/[\s،]+$/g, '');
    if (chunk.trim()) ops.push({ type: 'text', value: chunk.trimStart() });

    ops.push(buildActionOp(m.entry.command, lang));
    consumedMatches.push({ id: m.entry.command.id, matched: m.entry.alias });
    cursor = end;
  }
  const tail = source.slice(cursor).replace(/^[\s،]+/g, '');
  if (tail.trim()) ops.push({ type: 'text', value: tail });

  return { ops: mergeTextOps(ops), matches: consumedMatches };
}

function buildActionOp(command, lang) {
  const action = command.action || {};
  if (action.type === 'text') {
    let value = action.value;
    if (value === ',' ) value = lang === 'fa-IR' || lang === 'ar-SA' ? '،' : ',';
    else if (value === '?') value = lang === 'fa-IR' || lang === 'ar-SA' ? '؟' : '?';
    else if (value === ';') value = lang === 'fa-IR' || lang === 'ar-SA' ? '؛' : ';';
    else if (value === '%') value = lang === 'fa-IR' ? '٪' : '%';
    return { type: 'text', value, commandId: command.id, kind: 'punctuation' };
  }
  if (action.type === 'key') return { type: 'key', key: action.key, count: action.count || 1, commandId: command.id };
  if (action.type === 'edit') return { type: 'edit', op: action.op, commandId: command.id };
  if (action.type === 'clipboard') return { type: 'clipboard', op: action.op, commandId: command.id };
  if (action.type === 'control') return { type: 'control', op: action.op, commandId: command.id };
  if (action.lang) return { type: 'lang', lang: action.lang, commandId: command.id };
  return { type: 'noop', commandId: command.id };
}

function mergeTextOps(ops) {
  const out = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (op.type === 'text' && prev && prev.type === 'text') {
      const needsSpace = !/[\s]$/.test(prev.value) && !/^[،؛؟!.:…)\]]/.test(op.value);
      prev.value += `${needsSpace ? ' ' : ''}${op.value}`;
    } else {
      out.push({ ...op });
    }
  }
  return out;
}
