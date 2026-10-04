/**
 * Spoken-number → digit conversion (Persian, English, Arabic-Indic digits).
 *
 * Design notes
 *  - The user's example «بیست و پنج میلیون تومان» must become «۲۵ میلیون تومان»:
 *    by default scale words (میلیون/میلیارد/هزار) are preserved and only the numeral
 *    in front of them is converted.  `expandScales: true` instead produces full digits
 *    («۲۵٬۰۰۰٬۰۰۰ تومان»).
 *  - Decimals: «نسخه دو نقطه پنج» → «نسخه ۲.۵».
 */
import { tokenize, TOKEN } from './tokenize.js';
import { toPersianDigits, toEnglishDigits } from './persian.js';

export const NUMBER_MODE = Object.freeze({ PERSIAN: 'persian', ENGLISH: 'english', KEEP: 'keep' });

const FA_ONES = { 'صفر': 0, 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'چار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9 };
const FA_TEENS = { 'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'پانزده': 15, 'شانزده': 16, 'هفده': 17, 'هجده': 18, 'نوزده': 19 };
const FA_TENS = { 'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90 };
const FA_HUNDREDS = { 'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'چارصد': 400, 'پانصد': 500, 'پونصد': 500, 'ششصد': 600, 'شیشصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900 };
const FA_SCALES = { 'هزار': 1000, 'میلیون': 1e6, 'میلیارد': 1e9, 'تریلیون': 1e12 };

const EN_ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const EN_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const EN_SCALES = { thousand: 1000, million: 1e6, billion: 1e9, trillion: 1e12 };

const FA_NUM_WORDS = new Set([...Object.keys(FA_ONES), ...Object.keys(FA_TEENS), ...Object.keys(FA_TENS), ...Object.keys(FA_HUNDREDS)]);
const FA_SCALE_WORDS = new Set(Object.keys(FA_SCALES));
const EN_NUM_WORDS = new Set([...Object.keys(EN_ONES), ...Object.keys(EN_TENS)]);
const EN_SCALE_WORDS = new Set(Object.keys(EN_SCALES));
const DECIMAL_WORDS = new Set(['نقطه', 'اعشار', 'ممیز', 'دات', 'point', 'dot']);

export function isNumberWord(word, { english = true } = {}) {
  const w = String(word || '').toLowerCase();
  return FA_NUM_WORDS.has(w) || FA_SCALE_WORDS.has(w) || (english && (EN_NUM_WORDS.has(w) || EN_SCALE_WORDS.has(w)));
}

function valueOf(word, english) {
  const w = String(word).toLowerCase();
  if (w in FA_ONES) return FA_ONES[w];
  if (w in FA_TEENS) return FA_TEENS[w];
  if (w in FA_TENS) return FA_TENS[w];
  if (w in FA_HUNDREDS) return FA_HUNDREDS[w];
  if (!english) return null;
  if (w in EN_ONES) return EN_ONES[w];
  if (w in EN_TENS) return EN_TENS[w];
  return null;
}

function scaleOf(word, english) {
  const w = String(word).toLowerCase();
  if (w in FA_SCALES) return FA_SCALES[w];
  if (english && w in EN_SCALES) return EN_SCALES[w];
  return null;
}

function isDigitToken(word) {
  return /^[0-9\u06F0-\u06F9\u0660-\u0669]+([.,][0-9]+)?$/.test(word);
}

function digitValue(word) {
  return toEnglishDigits(word);
}

/** Group digits for readability: 25000000 -> "25,000,000" (English) / "۲۵٬۰۰۰٬۰۰۰" (Persian). */
export function formatDigits(value, mode = NUMBER_MODE.PERSIAN) {
  const [intPart, fracPart] = String(value).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, mode === NUMBER_MODE.ENGLISH ? ',' : '\u066C');
  const out = fracPart ? `${grouped}.${fracPart}` : grouped;
  return mode === NUMBER_MODE.PERSIAN ? toPersianDigits(out) : out;
}

/**
 * @param {string} text
 * @param {{mode?:string, expandScales?:boolean, english?:boolean}} options
 * @returns {{text:string, changed:boolean}}
 */
export function numbersToDigits(text, options = {}) {
  const {
    mode = NUMBER_MODE.PERSIAN,
    expandScales = false,
    english = true
  } = options;

  const tokens = tokenize(String(text ?? ''));
  const out = [];
  let i = 0;
  let changed = false;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type !== TOKEN.WORD) { out.push(tok.value); i += 1; continue; }

    const lower = tok.value.toLowerCase();
    const startsNumber = isNumberWord(lower, { english }) || isDigitToken(tok.value);

    if (!startsNumber) { out.push(tok.value); i += 1; continue; }

    // ---- collect a maximal number run: [numeral (و numeral)* (scale (و numeral)*)*] ----
    let j = i;
    let current = 0;
    let total = 0;
    let sawAnyNumber = false;
    let sawScale = false;
    let scaleCount = 0;
    let lastScaleValue = 0;
    const consumed = [];

    while (j < tokens.length) {
      const t = tokens[j];
      if (t.type === TOKEN.SPACE) { consumed.push(j); j += 1; continue; }
      if (t.type !== TOKEN.WORD) break;
      const w = t.value.toLowerCase();

      if (isDigitToken(t.value)) {
        const v = Number(digitValue(t.value));
        if (Number.isFinite(v)) {
          current = current === 0 ? v : current + v; // "دو 3" -> 5 (rare, safe)
          sawAnyNumber = true; consumed.push(j); j += 1; continue;
        }
        break;
      }

      const val = valueOf(w, english);
      if (val !== null) {
        current += val; sawAnyNumber = true; consumed.push(j); j += 1; continue;
      }
      const scale = scaleOf(w, english);
      if (scale !== null && sawAnyNumber) {
        const base = current || 1;
        if (scale <= lastScaleValue && total > 0) {
          // e.g. "دو میلیون و پانصد هزار" — add smaller scale to the running total
          total += base * scale;
        } else {
          total = (total + current) * scale;
        }
        lastScaleValue = scale;
        current = 0;
        sawScale = true;
        scaleCount += 1;
        consumed.push(j); j += 1; continue;
      }
      // filler "و" / "and" is only consumed when another number word follows it
      if (sawAnyNumber && (w === 'و' || w === 'and')) {
        let n = j + 1;
        while (n < tokens.length && tokens[n].type === TOKEN.SPACE) n += 1;
        const next = tokens[n];
        const nextIsNumber = Boolean(next) && next.type === TOKEN.WORD
          && (isNumberWord(next.value.toLowerCase(), { english }) || isDigitToken(next.value));
        if (nextIsNumber) { consumed.push(j); j += 1; continue; }
      }
      if (t.type === TOKEN.SPACE) { consumed.push(j); j += 1; continue; }
      break;
    }

    if (!sawAnyNumber) { out.push(tok.value); i += 1; continue; }

    const finalValue = total + current;

    // ---- decimal continuation:  "دو نقطه پنج" -> 2.5 ----
    let k = j;
    let decimal = '';
    {
      let p = j;
      while (p < tokens.length && tokens[p].type === TOKEN.SPACE) p += 1;
      const dotToken = tokens[p];
      if (dotToken && dotToken.type === TOKEN.WORD && DECIMAL_WORDS.has(dotToken.value.toLowerCase())) {
        let q = p + 1;
        while (q < tokens.length && tokens[q].type === TOKEN.SPACE) q += 1;
        const digitsTok = tokens[q];
        if (digitsTok && digitsTok.type === TOKEN.WORD) {
          const w = digitsTok.value.toLowerCase();
          let dv = null;
          if (isDigitToken(digitsTok.value)) dv = digitValue(digitsTok.value);
          else if (valueOf(w, english) !== null) dv = String(valueOf(w, english));
          if (dv !== null && dv.length <= 4) {
            decimal = dv;
            k = q + 1;
          }
        }
      }
    }

    let rendered;
    if (decimal) {
      const plain = `${finalValue}.${decimal}`;
      rendered = mode === NUMBER_MODE.PERSIAN ? toPersianDigits(plain) : plain;
      changed = true;
    } else if (sawScale && !expandScales && scaleCount === 1) {
      // keep the scale word, convert only the numeral in front of it ("بیست و پنج میلیون" -> "۲۵ میلیون")
      const scaleWord = tokens.slice(i, j).find((t) => t.type === TOKEN.WORD && FA_SCALE_WORDS.has(t.value.toLowerCase()));
      const scaleWordEn = tokens.slice(i, j).find((t) => t.type === TOKEN.WORD && EN_SCALE_WORDS.has(t.value.toLowerCase()));
      const numeralValue = Math.round(finalValue / scaleOf(scaleWord ? scaleWord.value : scaleWordEn.value, english));
      const scaleLabel = scaleWord ? scaleWord.value : scaleWordEn.value;
      const numText = mode === NUMBER_MODE.PERSIAN ? toPersianDigits(String(numeralValue)) : String(numeralValue);
      rendered = `${numText} ${scaleLabel}`;
      changed = true;
    } else {
      rendered = formatDigits(finalValue, mode);
      changed = true;
    }

    // trailing space handling: keep exactly one space after the run if the source had one
    const nextTok = tokens[k];
    out.push(rendered);
    if (nextTok && nextTok.type === TOKEN.WORD) out.push(' ');
    i = k;
  }

  let result = out.join('');
  // collapse the double spaces the loop may create around punctuation/whitespace
  result = result.replace(/ {2,}/g, ' ').replace(/\s+([،؛؟!.:])/g, '$1');
  if (result !== text) changed = true;
  return { text: result, changed };
}
