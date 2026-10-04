/**
 * NLP / accuracy test-suite.
 * The most important tests here are the ones taken verbatim from the project brief:
 * mixed Persian+English dictation must keep every English technical word in Latin script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePersian, fixHalfSpace, normalizeSpacing, toPersianDigits, toEnglishDigits, joinChunks, scriptDominant } from '../src/nlp/persian.js';
import { numbersToDigits, isNumberWord } from '../src/nlp/numbers.js';
import { applyCodeSwitch, buildTermIndex, applyCustomRules, looksUnsafeRegex } from '../src/nlp/codeSwitch.js';
import { detectLanguage, detectSegments, shouldSwitchLanguage } from '../src/nlp/languageDetect.js';
import { smartPunctuate, cleanupPunctuation } from '../src/nlp/punctuation.js';
import { parseVoiceCommands, buildCommandIndex } from '../src/nlp/commands.js';
import { Reconciler, normalizeForCompare, stripLeadingWords } from '../src/nlp/dedupe.js';
import { TextPipeline } from '../src/nlp/pipeline.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/common/settings.js';

const pipelineFor = (overrides = {}) => {
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...overrides });
  const pipeline = new TextPipeline({ getSettings: () => settings });
  return { pipeline, settings };
};

/* ---------------------------------------------------------------- *
 * 1. The flagship scenario: Persian + English technical terms
 * ---------------------------------------------------------------- */

test('keeps English technical words inside a Persian sentence (transliteration → Latin)', () => {
  const { pipeline } = pipelineFor();
  const input = 'من با ری‌اکت و نکست جی اس کار می‌کنم و ای پی آی رو به لاراول وصل کردم';
  const { text } = pipeline.processFinal(input, { lang: 'fa-IR' });
  assert.ok(text.includes('React'), `expected React in: ${text}`);
  assert.ok(text.includes('Next.js'), `expected Next.js in: ${text}`);
  assert.ok(text.includes('API'), `expected API in: ${text}`);
  assert.ok(text.includes('Laravel'), `expected Laravel in: ${text}`);
  assert.ok(!text.includes('ری‌اکت'));
  assert.ok(!text.includes('لاراول'));
  assert.ok(text.includes('کار می‌کنم'), `half-space expected in: ${text}`);
});

test('does not transliterate English words that are already Latin', () => {
  const { pipeline } = pipelineFor();
  const input = 'سلام من امروز روی پروژه Next.js کار کردم و مشکل authentication رو حل کردم';
  const { text } = pipeline.processFinal(input, { lang: 'fa-IR' });
  assert.ok(text.includes('Next.js'));
  assert.ok(text.includes('authentication'));
  assert.ok(text.startsWith('سلام'));
});

test('lower-cased Latin technical words are re-cased to their canonical spelling', () => {
  const { pipeline } = pipelineFor();
  const { text } = pipeline.processFinal('من با react و laravel و api کار کردم', { lang: 'fa-IR' });
  assert.ok(text.includes('React'));
  assert.ok(text.includes('Laravel'));
  assert.ok(text.includes('API'));
});

test('the brief example sentence round-trips without Persianisation', () => {
  const { pipeline } = pipelineFor();
  const input = 'سلام، من امروز می‌خوام پروژه React رو کامل کنم، بعد Backend رو با Laravel می‌نویسم و API رو به Frontend وصل می‌کنم';
  const { text } = pipeline.processFinal(input, { lang: 'fa-IR' });
  for (const word of ['React', 'Backend', 'Laravel', 'API', 'Frontend']) {
    assert.ok(text.includes(word), `expected ${word} in: ${text}`);
  }
});

test('joining-multi-word transliterations of joined spellings', () => {
  const index = buildTermIndex([]);
  const res = applyCodeSwitch('برو تو گیتهاب و کلادفلر رو ببین', { index });
  assert.ok(res.text.includes('GitHub'), res.text);
  assert.ok(res.text.includes('Cloudflare'), res.text);
});

test('generic terms stay Persian unless the user opts in', () => {
  const index = buildTermIndex([]);
  const off = applyCodeSwitch('سرور و دیتابیس رو چک کن', { index, englishizeGenericTerms: false });
  assert.ok(off.text.includes('سرور'));
  const on = applyCodeSwitch('سرور و دیتابیس رو چک کن', { index, englishizeGenericTerms: true });
  assert.ok(/[Ss]erver/.test(on.text), on.text);
  assert.ok(/[Dd]atabase/.test(on.text), on.text);
});

/* ---------------------------------------------------------------- *
 * 2. Persian normalization + half-space
 * ---------------------------------------------------------------- */

test('normalizes Arabic letter variants to Persian forms', () => {
  assert.equal(normalizePersian('كتاب من يك'), 'کتاب من یک');
  assert.equal(normalizePersian('سلام، خوبي؟'), 'سلام، خوبی؟');
});

test('half-space correction for می/نمی prefixes and plurals', () => {
  assert.equal(fixHalfSpace('میخواهم'), 'می‌خواهم');
  assert.equal(fixHalfSpace('نمیتوانم'), 'نمی‌توانم');
  assert.equal(fixHalfSpace('کتابها'), 'کتاب‌ها');
  assert.equal(fixHalfSpace('کتابهای من'), 'کتاب‌های من');
  assert.equal(fixHalfSpace('بهترین'), 'بهترین');
});

test('half-space never damages protected words', () => {
  for (const word of ['تنها', 'بیشتر', 'کمتر', 'بهتر', 'میزان', 'دختر', 'میلیون', 'تمام']) {
    assert.equal(fixHalfSpace(word), word, `protected word changed: ${word}`);
  }
});

test('persian/english digit conversion', () => {
  assert.equal(toPersianDigits('25'), '۲۵');
  assert.equal(toEnglishDigits('۲۵'), '25');
  assert.equal(toEnglishDigits('٢٥'), '25');
});

test('spacing normalization', () => {
  assert.equal(normalizeSpacing('سلام   دنیا  ،  خوبی ؟'), 'سلام دنیا، خوبی؟');
  assert.equal(joinChunks('سلام', 'دنیا'), 'سلام دنیا');
  assert.equal(joinChunks('سلام ', 'دنیا'), 'سلام دنیا');
  assert.equal(joinChunks('سلام', '،'), 'سلام،');
  assert.equal(scriptDominant('hello world'), 'en');
  assert.equal(scriptDominant('سلام دنیا'), 'fa');
});

/* ---------------------------------------------------------------- *
 * 3. Numbers
 * ---------------------------------------------------------------- */

test('spoken Persian numbers become digits and keep the scale word', () => {
  assert.equal(numbersToDigits('بیست و پنج میلیون تومان').text, '۲۵ میلیون تومان');
  assert.equal(numbersToDigits('سه تا کتاب خریدم').text, '۳ تا کتاب خریدم');
  assert.equal(numbersToDigits('صد و بیست و سه').text, '۱۲۳');
});

test('digits mode controls the numeral system', () => {
  assert.equal(numbersToDigits('بیست و پنج', { mode: 'english' }).text, '25');
  assert.equal(numbersToDigits('بیست و پنج', { mode: 'persian' }).text, '۲۵');
  assert.equal(numbersToDigits('25', { mode: 'keep' }).text, '25');
});

test('decimal dictation: «نسخه دو نقطه پنج» → ۲.۵', () => {
  assert.equal(numbersToDigits('نسخه دو نقطه پنج').text, 'نسخه ۲.۵');
  assert.equal(numbersToDigits('نسخه دو نقطه پنج React', { mode: 'english' }).text, 'نسخه 2.5 React');
});

test('expanded scale mode produces full digits', () => {
  assert.equal(numbersToDigits('دو میلیون و پانصد هزار تومان').text, '۲٬۵۰۰٬۰۰۰ تومان');
  assert.equal(numbersToDigits('بیست و پنج میلیون', { expandScales: true }).text, '۲۵٬۰۰۰٬۰۰۰');
});

test('english spoken numbers', () => {
  assert.equal(numbersToDigits('twenty five dollars', { mode: 'english' }).text, '25 dollars');
});

test('isNumberWord guards', () => {
  assert.ok(isNumberWord('پنج'));
  assert.ok(!isNumberWord('کتاب'));
});

/* ---------------------------------------------------------------- *
 * 4. Language detection
 * ---------------------------------------------------------------- */

test('detects Persian, English and Arabic', () => {
  assert.equal(detectLanguage('سلام من امروز می‌خواهم یک پروژه بسازم').lang, 'fa-IR');
  assert.equal(detectLanguage('hello today I want to build a new project').lang, 'en-US');
  assert.equal(detectLanguage('مرحبا كيف حالك اليوم في العمل').lang, 'ar-SA');
});

test('detects code-switching inside Persian', () => {
  const res = detectLanguage('سلام من امروز روی پروژه Next.js کار کردم');
  assert.equal(res.lang, 'fa-IR');
  assert.equal(res.mixed, true);
  assert.ok(res.latinWordCount >= 1);
});

test('segment-level language detection', () => {
  const segments = detectSegments('سلام من با React کار کردم');
  const langs = segments.map((s) => s.lang);
  assert.ok(langs.includes('fa'));
  assert.ok(langs.includes('en'));
  assert.ok(segments.some((s) => s.text.includes('React')));
});

test('language switching decisions respect confidence and manual mode', () => {
  const settings = sanitizeSettings({});
  const strong = { lang: 'en-US', confidence: 0.9, wordCount: 5 };
  assert.equal(shouldSwitchLanguage('fa-IR', strong, settings), true);
  assert.equal(shouldSwitchLanguage('fa-IR', { ...strong, confidence: 0.2 }, settings), false);
  assert.equal(shouldSwitchLanguage('fa-IR', strong, sanitizeSettings({ language: { mode: 'manual' } })), false);
});

/* ---------------------------------------------------------------- *
 * 5. Voice commands
 * ---------------------------------------------------------------- */

test('whole-utterance command', () => {
  const { ops } = parseVoiceCommands('خط جدید', { lang: 'fa-IR' });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'key');
  assert.equal(ops[0].key, 'Enter');
  assert.equal(ops[0].count, 1);
});

test('paragraph command inserts two newlines', () => {
  const { ops } = parseVoiceCommands('پاراگراف جدید', { lang: 'fa-IR' });
  assert.equal(ops[0].count, 2);
});

test('trailing command is extracted but text is kept', () => {
  const { ops } = parseVoiceCommands('سلام این یک تست است پاک کن', { lang: 'fa-IR' });
  assert.equal(ops.length, 2);
  assert.equal(ops[0].type, 'text');
  assert.equal(ops[0].value.trim(), 'سلام این یک تست است');
  assert.equal(ops[1].type, 'edit');
  assert.equal(ops[1].op, 'deleteLast');
});

test('normal speech containing a command word in the middle is untouched', () => {
  const text = 'لطفاً کپی کن رو بذار توی پوشه';
  const { ops } = parseVoiceCommands(text, { lang: 'fa-IR' });
  // «کپی» is not the trailing phrase and «کن» is followed by more words → no command
  assert.ok(ops.every((op) => op.type === 'text'), JSON.stringify(ops));
});

test('punctuation commands work inline', () => {
  const { ops } = parseVoiceCommands('سلام خوبی علامت سوال امروز چطوری علامت سوال', { lang: 'fa-IR' });
  const texts = ops.filter((o) => o.type === 'text').map((o) => o.value).join('');
  assert.ok(texts.includes('؟'), texts);
  assert.ok(texts.includes('خوبی'));
});

test('english aliases are understood', () => {
  const { ops } = parseVoiceCommands('new line', { lang: 'en-US' });
  assert.equal(ops[0].type, 'key');
  const copy = parseVoiceCommands('copy', { lang: 'en-US' });
  assert.equal(copy.ops[0].op, 'copy');
});

test('strict mode disables inline/trailing matching', () => {
  const { ops } = parseVoiceCommands('سلام این یک تست است پاک کن', { strict: true, lang: 'fa-IR' });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'text');
});

test('command index is conflict-free', () => {
  const index = buildCommandIndex();
  const seen = new Map();
  for (const [key, entry] of index.map) {
    assert.ok(!seen.has(key) || seen.get(key) === entry.command.id, `conflicting alias: ${key}`);
    seen.set(key, entry.command.id);
  }
});

test('language switching commands', () => {
  const { ops } = parseVoiceCommands('زبان انگلیسی', { lang: 'fa-IR' });
  assert.equal(ops[0].type, 'lang');
  assert.equal(ops[0].lang, 'en-US');
});

/* ---------------------------------------------------------------- *
 * 6. Smart punctuation
 * ---------------------------------------------------------------- */

test('cleanup removes duplicated punctuation', () => {
  assert.equal(cleanupPunctuation('سلام .....'), 'سلام.');
  assert.equal(cleanupPunctuation('خوبی ؟؟'), 'خوبی؟');
});

test('smart punctuation adds a question mark when the sentence asks something', () => {
  const out = smartPunctuate('سلام خوبی امروز چطوری', { lang: 'fa-IR' });
  assert.ok(out.endsWith('؟'), out);
});

test('smart punctuation adds a full stop to a statement without one', () => {
  const out = smartPunctuate('من امروز یک پروژه جدید ساختم', { lang: 'fa-IR' });
  assert.ok(out.endsWith('.'), out);
});

test('english sentences get capitalised', () => {
  const out = smartPunctuate('hello world this is a test', { lang: 'en-US' });
  assert.ok(out.startsWith('Hello'), out);
  assert.ok(out.endsWith('.'), out);
});

test('punctuation can be disabled', () => {
  const out = smartPunctuate('سلام خوبی امروز چطوری', { lang: 'fa-IR', enabled: false });
  assert.equal(out, 'سلام خوبی امروز چطوری');
});

/* ---------------------------------------------------------------- *
 * 7. De-duplication / reconciliation
 * ---------------------------------------------------------------- */

test('identical finals are dropped', () => {
  const r = new Reconciler();
  r.commitFinal('سلام');
  const second = r.commitFinal('سلام');
  assert.equal(second.duplicate, true);
  assert.equal(r.committedText, 'سلام');
});

test('overlapping finals are merged, not duplicated', () => {
  const r = new Reconciler();
  r.commitFinal('سلام من امروز');
  const res = r.commitFinal('امروز رفتم بازار');
  assert.equal(r.committedText, 'سلام من امروز رفتم بازار');
  assert.equal(res.overlap, 1);
});

test('a single repeated function word is not treated as an engine repeat', () => {
  const r = new Reconciler();
  r.commitFinal('من رفتم به بازار');
  r.commitFinal('به خانه برگشتم');
  assert.equal(r.committedText, 'من رفتم به بازار به خانه برگشتم');
});

test('compound words keep their punctuation (Next.js stays Next.js)', () => {
  const index = buildTermIndex([]);
  assert.equal(applyCodeSwitch('پروژه Next.js من', { index }).text, 'پروژه Next.js من');
  assert.equal(applyCodeSwitch('با node.js کار می‌کنم', { index }).text, 'با node.js کار می‌کنم');
  // `go` and `api` are known terms; as compound members they must stay untouched
  assert.equal(applyCodeSwitch('فایل go.mod را باز کن', { index }).text, 'فایل go.mod را باز کن');
  assert.equal(applyCodeSwitch('به api.example.com وصل شو', { index }).text, 'به api.example.com وصل شو');
  assert.equal(applyCodeSwitch('فایل user-id.txt را بخوان', { index }).text, 'فایل user-id.txt را بخوان');
});

test('compound members are not rewritten even when the member is a user term', () => {
  const index = buildTermIndex([{ term: 'API', kind: 'proper', fa: [], en: ['api'] }]);
  // standalone "api" is canonicalised …
  assert.equal(applyCodeSwitch('api را صدا بزن', { index }).text, 'API را صدا بزن');
  // … but inside a hostname it must not be
  assert.equal(applyCodeSwitch('به api.service.ir وصل شو', { index }).text, 'به api.service.ir وصل شو');
});

test('interim results only expose the uncommitted tail', () => {
  const r = new Reconciler();
  r.commitFinal('سلام من');
  const tail = r.setInterim('سلام من امروز رفتم');
  assert.equal(tail, 'امروز رفتم');
});

test('stripLeadingWords keeps the remainder verbatim', () => {
  assert.equal(stripLeadingWords('سلام من امروز', 2), 'امروز');
  assert.equal(stripLeadingWords('سلام', 1), '');
});

test('normalizeForCompare ignores punctuation/ZWNJ/case', () => {
  assert.equal(normalizeForCompare('سلام، دنیا!'), normalizeForCompare('سلام  دنیا'));
  assert.equal(normalizeForCompare('میکنم'), normalizeForCompare('می‌کنم'));
});

/* ---------------------------------------------------------------- *
 * 8. Full pipeline behaviour
 * ---------------------------------------------------------------- */

test('pipeline produces the documented mixed-language output', () => {
  const { pipeline } = pipelineFor();
  const { text, meta } = pipeline.processFinal('سلام من امروز روی پروژه نکست جی اس کار کردم و مشکل اتنتیکیشن رو حل کردم', {});
  assert.equal(meta.lang, 'fa-IR');
  assert.ok(text.includes('Next.js'), text);
});

test('pipeline keeps user dictionary rules', () => {
  const { pipeline } = pipelineFor({
    dictionary: { rules: [{ pattern: 'ری اکت', replacement: 'ReactJS', mode: 'word' }] }
  });
  const { text } = pipeline.processFinal('من با ری اکت کار می‌کنم', { lang: 'fa-IR' });
  assert.ok(text.includes('ReactJS'), text);
});

test('pipeline emits a key op for a trailing command', () => {
  const { pipeline } = pipelineFor();
  const { ops } = pipeline.processFinal('متن تست خط جدید', { lang: 'fa-IR' });
  assert.equal(ops[ops.length - 1].type, 'key');
});

test('pipeline does not duplicate repeated finals', () => {
  const { pipeline } = pipelineFor();
  const a = pipeline.processFinal('سلام دنیا', { lang: 'fa-IR' });
  const b = pipeline.processFinal('سلام دنیا', { lang: 'fa-IR' });
  assert.ok(a.text.length > 0);
  assert.equal(b.text, '');
  assert.equal(b.duplicate, true);
});

test('pipeline interim preview does not mutate committed text', () => {
  const { pipeline } = pipelineFor();
  pipeline.processFinal('سلام من', { lang: 'fa-IR' });
  const before = pipeline.committedText;
  pipeline.processInterim('سلام من امروز', { lang: 'fa-IR' });
  assert.equal(pipeline.committedText, before);
});

/* ---------------------------------------------------------------- *
 * 9. Custom dictionary safety
 * ---------------------------------------------------------------- */

test('unsafe user regexes are rejected', () => {
  assert.equal(looksUnsafeRegex('(a+)+$'), true);
  assert.equal(looksUnsafeRegex('^(hello)'), false);
  const res = applyCustomRules('aaaa', [{ pattern: '(a+)+$', replacement: 'x', mode: 'regex' }]);
  assert.equal(res.text, 'aaaa');
});

test('custom rules support word/substring/compact/regex modes', () => {
  const word = applyCustomRules('فانکشن getUser رو ببین', [{ pattern: 'فانکشن', replacement: 'function', mode: 'word' }]);
  assert.ok(word.text.includes('function'));
  const compact = applyCustomRules('گیت هاب', [{ pattern: 'گیت هاب', replacement: 'GitHub', mode: 'compact' }]);
  assert.ok(compact.text.includes('GitHub'), compact.text);
  const regex = applyCustomRules('user id 12', [{ pattern: 'id (\\d+)', replacement: 'ID-$1', mode: 'regex' }]);
  assert.equal(regex.text, 'user ID-12');
});

test('settings sanitization clamps hostile input', () => {
  const s = sanitizeSettings({
    history: { limit: 999999 },
    recognition: { maxRestarts: -5 },
    text: { persianDigits: 'klingon' },
    dictionary: { rules: [{ pattern: 'x'.repeat(500), replacement: 'y' }] }
  });
  assert.ok(s.history.limit <= 1000);
  assert.equal(s.recognition.maxRestarts, 0);
  assert.equal(s.text.persianDigits, 'persian');
  assert.equal(s.dictionary.rules[0].pattern.length, 200);
});
