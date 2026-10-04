/**
 * Options page — schema driven so every setting has exactly one definition.
 * Sections: welcome, language, recognition, engines, text, commands, dictionary,
 * shortcuts, history, privacy, debug, about.
 */
import { api, subscribe } from '../ui/api.js';
import { $, el, clear, toast, copyToClipboard, debounce, formatDate, formatTime, STATE_LABEL_FA } from '../ui/dom.js';
import { LANGUAGES, ENGINES, DICTIONARY_LIMIT_MAX, HISTORY_LIMIT_MAX } from '../common/constants.js';

const nav = $('#nav');
const sectionTitle = $('#section-title');
const sectionBody = $('#section-body');
const alerts = $('#alerts');
const statePill = $('#state-pill');
const stateLabel = $('#state-label');

let settings = null;
let diagnostics = null;
let liveLogs = [];

const SECTIONS = [
  { id: 'welcome', title: 'شروع سریع', icon: '🚀' },
  { id: 'language', title: 'زبان', icon: '🌐' },
  { id: 'recognition', title: 'تشخیص گفتار', icon: '🎙️' },
  { id: 'engines', title: 'موتورها (Web Speech / Whisper)', icon: '⚙️' },
  { id: 'text', title: 'پردازش متن', icon: '✍️' },
  { id: 'commands', title: 'دستورهای صوتی', icon: '🗣️' },
  { id: 'dictionary', title: 'واژه‌نامه و اصلاحات', icon: '📚' },
  { id: 'shortcuts', title: 'کلیدهای میانبر', icon: '⌨️' },
  { id: 'history', title: 'تاریخچه', icon: '🗂️' },
  { id: 'privacy', title: 'حریم خصوصی', icon: '🔒' },
  { id: 'debug', title: 'دیباگ و عیب‌یابی', icon: '🐞' },
  { id: 'about', title: 'درباره و پشتیبانی', icon: 'ℹ️' }
];

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

const langOptions = () => LANGUAGES.filter((l) => l.code !== 'auto').map((l) => [l.code, `${l.labelFa} — ${l.code}`]);

const SCHEMA = {
  language: [
    {
      title: 'حالت زبان',
      note: 'حالت پیش‌فرض «تشخیص خودکار» است: افزونه زبان گفتار را از روی متن تشخیص می‌دهد و در صورت نیاز جلسه تشخیص را با زبان جدید ادامه می‌دهد. برای گفتار مخلوط فارسی/انگلیسی، حالت خودکار بهترین نتیجه را می‌دهد.',
      fields: [
        { path: 'language.mode', type: 'select', label: 'حالت زبان', options: [['auto', 'تشخیص خودکار (پیشنهادی)'], ['manual', 'انتخاب دستی زبان']] },
        { path: 'language.manualLang', type: 'select', label: 'زبان دستی', options: langOptions() },
        { path: 'language.fallbackLang', type: 'select', label: 'زبان پیش‌فرض آغاز جلسه', options: langOptions() },
        { path: 'language.autoDetect', type: 'switch', label: 'تشخیص خودکار زبان فعال باشد', hint: 'هنگام تغییر زبان گفتار، جلسه با زبان جدید ادامه پیدا می‌کند.' },
        { path: 'language.stickyWithinSession', type: 'switch', label: 'مقاومت در برابر تغییر سریع زبان', hint: 'برای تغییر زبان، دو تشخیص پیوسته یا اطمینان بالا لازم است.' },
        { path: 'language.switchConfidence', type: 'range', min: 0.3, max: 0.9, step: 0.05, label: 'حد اطمینان لازم برای تغییر زبان', suffix: '' },
        { path: 'language.minWordsForSwitch', type: 'number', min: 1, max: 8, label: 'حداقل تعداد کلمات برای تغییر زبان' }
      ]
    },
    {
      title: 'گفتار مخلوط (Code-Switching)',
      note: 'Web Speech API در هر جلسه فقط یک زبان را می‌فهمد؛ افزونه هنگام تشخیص زبان از یک ماژول امتیازدهی و در حالت «دو موتوره» از دو جلسه هم‌زمان استفاده می‌کند. اگر بیشتر اوقات فارسی را با اصطلاحات انگلیسی قاطی می‌کنید، موتور Whisper دقیق‌ترین گزینه است.',
      fields: [
        { path: 'language.dualEngine', type: 'switch', label: 'فعال‌سازی حالت دو موتوره (آزمایشی)', hint: 'دو جلسه Web Speech هم‌زمان (فارسی + انگلیسی) و انتخاب بهترین نتیجه. مصرف CPU/شبکه بیشتر است.' },
        { path: 'text.preserveEnglishWords', type: 'switch', label: 'حفظ اصطلاحات فنی به انگلیسی', hint: '«ری‌اکت» → React، «لاراول» → Laravel، «ای پی آی» → API' },
        { path: 'text.englishizeGenericTerms', type: 'switch', label: 'تبدیل واژه‌های عمومی هم به انگلیسی', hint: 'مثال: «دیتابیس» → Database. به‌صورت پیش‌فرض خاموش است تا فارسی طبیعی بماند.' }
      ]
    }
  ],

  recognition: [
    {
      title: 'رفتار جلسه',
      fields: [
        { path: 'recognition.continuous', type: 'switch', label: 'حالت پیوسته (Continuous)', hint: 'ضبط تا زمانی که متوقف کنید ادامه می‌یابد.' },
        { path: 'recognition.interimResults', type: 'switch', label: 'نمایش متن موقت (Interim)', hint: 'متن در حال شکل‌گیری به‌صورت زنده نشان داده می‌شود.' },
        { path: 'recognition.autoRestart', type: 'switch', label: 'شروع خودکار پس از قطع شدن', hint: 'Chrome جلسه تشخیص را خودکار پایان می‌دهد؛ افزونه آن را دوباره راه‌اندازی می‌کند.' },
        { path: 'recognition.maxRestarts', type: 'number', min: 0, max: 100, label: 'حداکثر تعداد راه‌اندازی مجدد' },
        { path: 'recognition.restartDelayMs', type: 'number', min: 0, max: 5000, step: 50, label: 'تأخیر راه‌اندازی مجدد (میلی‌ثانیه)' },
        { path: 'recognition.noSpeechRestartDelayMs', type: 'number', min: 0, max: 10000, step: 100, label: 'تأخیر پس از سکوت (میلی‌ثانیه)' },
        { path: 'recognition.silenceFinalizeMs', type: 'number', min: 500, max: 10000, step: 100, label: 'ثبت جمله پس از این مدت سکوت (میلی‌ثانیه)', hint: 'مانع از بین رفتن کلمات در صحبت طولانی می‌شود.' },
        { path: 'recognition.maxSessionMinutes', type: 'number', min: 1, max: 480, label: 'حداکثر طول یک جلسه (دقیقه)' }
      ]
    },
    {
      title: 'دستگاه (On-device)',
      note: 'Chrome می‌تواند تشخیص را روی دستگاه انجام دهد، اما بسته‌های زبان آن در حال حاضر شامل فارسی نمی‌شود (فهرست رسمی: de, en, es, fr, hi, id, it, ja, ko, pl, pt, ru, th, tr, vi, zh).',
      fields: [
        { path: 'recognition.processLocally', type: 'switch', label: 'پردازش محلی در صورت پشتیبانی زبان', hint: 'برای زبان‌های بدون بسته زبان، خودکار به حالت آنلاین برمی‌گردد.' }
      ],
      custom: 'onDevice'
    }
  ],

  engines: [
    { custom: 'engines' },
    {
      title: 'سرور Whisper (اختیاری)',
      note: 'هر سرور سازگار با OpenAI (نمونه: whisper.cpp server, faster-whisper, vLLM) با endpoint نوع /v1/audio/transcriptions پشتیبانی می‌شود. می‌توانید آدرس محلی مثل http://127.0.0.1:8080/v1/audio/transcriptions بدهید تا صدا از دستگاه خارج نشود.',
      fields: [
        { path: 'whisper.enabled', type: 'switch', label: 'استفاده از موتور Whisper' },
        { path: 'whisper.endpoint', type: 'text', label: 'آدرس سرویس (Endpoint)', dir: 'ltr', placeholder: 'https://api.openai.com/v1/audio/transcriptions' },
        { path: 'whisper.apiKey', type: 'password', label: 'کلید API (اختیاری برای سرور محلی)', dir: 'ltr' },
        { path: 'whisper.model', type: 'text', label: 'نام مدل', dir: 'ltr', placeholder: 'whisper-1' },
        { path: 'whisper.chunkSeconds', type: 'number', min: 2, max: 30, label: 'حداکثر طول هر قطعه (ثانیه)' },
        { path: 'whisper.timeoutMs', type: 'number', min: 2000, max: 120000, step: 500, label: 'مهلت پاسخ سرور (میلی‌ثانیه)' },
        { path: 'whisper.vadThreshold', type: 'range', min: 0.003, max: 0.08, step: 0.001, label: 'آستانه حساسیت میکروفون (VAD)' },
        { path: 'whisper.preferForMixedLanguage', type: 'switch', label: 'ترجیح Whisper برای گفتار مخلوط' },
        { path: 'whisper.prompt', type: 'textarea', label: 'متن راهنما (Prompt) — واژه‌های فنی اینجا خودکار اضافه می‌شوند', dir: 'auto' }
      ]
    }
  ],

  text: [
    {
      title: 'نرمال‌سازی فارسی',
      fields: [
        { path: 'text.normalize', type: 'switch', label: 'اصلاح فاصله‌ها و نرمال‌سازی متن' },
        { path: 'text.persianChars', type: 'switch', label: 'یکسان‌سازی حروف فارسی (ي → ی، ك → ک)' },
        { path: 'text.persianHalfSpace', type: 'switch', label: 'اصلاح نیم‌فاصله (می‌کنم، کتاب‌ها، می‌شود)' },
        { path: 'text.persianDigits', type: 'select', label: 'ارقام', options: [['persian', 'فارسی (۲۵)'], ['english', 'انگلیسی (25)'], ['keep', 'بدون تغییر']] },
        { path: 'text.autoCapitalize', type: 'switch', label: 'حروف بزرگ انگلیسی در ابتدای جمله' },
        { path: 'text.fuzzyMatch', type: 'switch', label: 'تصحیح خطاهای تلفظی نزدیک', hint: 'مثال: «لارول» → Laravel' }
      ]
    },
    {
      title: 'علائم نگارشی و اعداد',
      fields: [
        { path: 'text.punctuation.enabled', type: 'switch', label: 'علائم نگارشی هوشمند' },
        { path: 'text.punctuation.level', type: 'select', label: 'سطح هوشمندی', options: [['safe', 'ایمن — فقط پایان جمله و علامت سؤال'], ['balanced', 'متعادل — ویرگول در جمله‌های بنددار'], ['aggressive', 'تهاجمی — ویرگول‌گذاری بیشتر']] },
        { path: 'text.numbers.enabled', type: 'switch', label: 'تبدیل اعداد گفتاری به رقم' },
        { path: 'text.numbers.expandScales', type: 'switch', label: 'تبدیل کامل مقیاس‌ها', hint: '«بیست و پنج میلیون» → ۲۵٬۰۰۰٬۰۰۰ (به‌جای «۲۵ میلیون»)' }
      ]
    }
  ],

  commands: [
    {
      title: 'دستورهای صوتی',
      fields: [
        { path: 'commands.enabled', type: 'switch', label: 'فعال بودن دستورهای صوتی' },
        { path: 'commands.strict', type: 'switch', label: 'حالت سخت‌گیرانه', hint: 'دستور فقط وقتی اجرا می‌شود که تمام جمله یک دستور باشد.' },
        { path: 'commands.allowTrailing', type: 'switch', label: 'اجازه دستور در انتهای جمله', hint: 'مثال: «سلام این یک تست است، خط جدید»' }
      ]
    },
    { custom: 'commands' }
  ],

  dictionary: [
    {
      title: 'واژه‌های اختصاصی',
      note: 'هر واژه می‌تواند چند شکل فارسی (تلفظ) و چند شکل انگلیسی داشته باشد. واژه‌های نوع «خاص» همیشه با املای لاتین نوشته می‌شوند.',
      custom: 'terms'
    },
    {
      title: 'قواعد جایگزینی',
      note: 'برای اصلاحات دلخواه: «reactjs» → «React.js». حالت «regex» فقط با الگوهای ساده پیشنهاد می‌شود.',
      custom: 'rules'
    },
    { custom: 'importExport' }
  ],

  shortcuts: [{ custom: 'shortcuts' }],
  history: [{ custom: 'history' }],
  privacy: [{ custom: 'privacy' }],
  debug: [{ custom: 'debug' }, {
    title: 'تنظیمات دیباگ',
    fields: [
      { path: 'debug.enabled', type: 'switch', label: 'حالت دولوپر' },
      { path: 'debug.verbose', type: 'switch', label: 'ثبت متن‌ها در لاگ (ناشناس‌سازی خاموش)' },
      { path: 'debug.keepLogs', type: 'switch', label: 'نگه‌داشتن لاگ‌ها' },
      { path: 'debug.logLimit', type: 'number', min: 50, max: 600, label: 'حداکثر تعداد رکورد لاگ' }
    ]
  }],
  about: [{ custom: 'about' }],
  welcome: [{ custom: 'welcome' }]
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const getPath = (obj, path) => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);

function setPath(obj, path, value) {
  const keys = path.split('.');
  const out = { ...obj };
  let cursor = out;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) cursor[key] = value;
    else {
      cursor[key] = { ...(cursor[key] || {}) };
      cursor = cursor[key];
    }
  });
  return out;
}

const savePatch = debounce(async (patch, message = 'ذخیره شد') => {
  const res = await api.setSettings(patch);
  if (res.ok) {
    settings = res.settings;
    toast(message, 'ok', 1600);
  } else {
    toast('ذخیره تنظیمات ناموفق بود.', 'error');
  }
}, 260);

const persist = (patch, message) => {
  settings = patch(settings);
  renderStats(statePill, stateLabel);
  savePatch(patch(settings), message);
};

function field(fieldDef) {
  const value = getPath(settings, fieldDef.path);
  const wrapper = el('label', { class: 'field' });
  wrapper.appendChild(el('span', { text: fieldDef.label }));

  let control;
  switch (fieldDef.type) {
    case 'switch': {
      wrapper.className = 'switch';
      clear(wrapper);
      control = el('input', { type: 'checkbox' });
      control.checked = value !== false;
      control.addEventListener('change', () => persist((s) => setPath(s, fieldDef.path, control.checked)));
      wrapper.append(control, el('span', {}, [document.createTextNode(fieldDef.label), fieldDef.hint ? el('small', { text: fieldDef.hint }) : null]));
      return wrapper;
    }
    case 'select': {
      control = el('select');
      for (const [optValue, optLabel] of fieldDef.options) {
        const option = el('option', { value: optValue, text: optLabel });
        if (String(value) === String(optValue)) option.selected = true;
        control.appendChild(option);
      }
      control.addEventListener('change', () => persist((s) => setPath(s, fieldDef.path, control.value)));
      break;
    }
    case 'number': {
      control = el('input', { type: 'number', min: fieldDef.min, max: fieldDef.max, step: fieldDef.step || 1 });
      control.value = value ?? '';
      control.addEventListener('change', () => persist((s) => setPath(s, fieldDef.path, Number(control.value))));
      break;
    }
    case 'range': {
      control = el('input', { type: 'range', min: fieldDef.min, max: fieldDef.max, step: fieldDef.step || 0.01 });
      control.value = value ?? fieldDef.min;
      const readout = el('span', { class: 'hint', text: String(value) });
      control.addEventListener('input', () => { readout.textContent = control.value; });
      control.addEventListener('change', () => persist((s) => setPath(s, fieldDef.path, Number(control.value))));
      wrapper.append(control, readout);
      if (fieldDef.hint) wrapper.appendChild(el('small', { text: fieldDef.hint }));
      return wrapper;
    }
    case 'password':
    case 'text': {
      control = el('input', { type: fieldDef.type === 'password' ? 'password' : 'text', dir: fieldDef.dir || 'auto', placeholder: fieldDef.placeholder || '' });
      control.value = value ?? '';
      control.addEventListener('change', () => persist((s) => setPath(s, fieldDef.path, control.value)));
      break;
    }
    case 'textarea': {
      control = el('textarea', { dir: fieldDef.dir || 'auto' });
      control.value = value ?? '';
      control.addEventListener('change', () => persist((s) => setPath(s, fieldDef.path, control.value)));
      break;
    }
    default:
      control = el('input', { type: 'text' });
  }
  wrapper.appendChild(control);
  if (fieldDef.hint) wrapper.appendChild(el('small', { text: fieldDef.hint }));
  return wrapper;
}

function block(blockDef) {
  const card = el('section', { class: 'card' });
  if (blockDef.title) card.appendChild(el('h2', { text: blockDef.title }));
  if (blockDef.note) card.appendChild(el('p', { class: 'hint', text: blockDef.note }));
  if (blockDef.custom) {
    const builder = CUSTOM[blockDef.custom];
    if (builder) card.appendChild(builder());
  }
  if (blockDef.fields) {
    const grid = el('div', { class: 'field-grid' });
    for (const f of blockDef.fields) grid.appendChild(field(f));
    card.appendChild(grid);
  }
  return card;
}

/* ------------------------------------------------------------------ *
 * Custom sections
 * ------------------------------------------------------------------ */

const CUSTOM = {
  onDevice() {
    const wrap = el('div', { class: 'vt-col' });
    const row = el('div', { class: 'vt-row wrap' });
    const result = el('div', { class: 'hint' });
    const btn = el('button', { class: 'small', text: 'بررسی بسته‌های زبان روی دستگاه' });
    btn.addEventListener('click', async () => {
      result.textContent = 'در حال بررسی…';
      const langs = ['fa-IR', 'en-US', 'ar-SA', 'de-DE'];
      const res = await api.onDeviceCheck(langs);
      result.textContent = `وضعیت: ${res.status || 'نامشخص'} — زبان‌های بررسی‌شده: ${langs.join(', ')}`;
    });
    row.append(btn);
    wrap.append(row, result);
    return wrap;
  },

  engines() {
    const wrap = el('div', { class: 'vt-col' });
    const grid = el('div', { class: 'grid' });
    wrap.appendChild(el('p', { class: 'hint', text: 'موتور فعال را انتخاب کنید. موتورهای غیرفعال با دلیل مشخص می‌شوند و در آینده بدون تغییر معماری افزوده می‌شوند.' }));
    grid.className = 'vt-grid';
    wrap.appendChild(grid);
    const entries = diagnostics?.offscreen?.engineCatalog || diagnostics?.engineCatalog || [];
    if (!entries.length) {
      grid.appendChild(el('div', { class: 'hint', text: 'در حال بررسی موتورها…' }));
      api.engineCatalog().then((res) => {
        if (res.ok && res.catalog?.length) {
          diagnostics = { ...(diagnostics || {}), offscreen: { ...(diagnostics?.offscreen || {}), engineCatalog: res.catalog } };
          render();
        } else {
          clear(grid);
          grid.appendChild(el('div', { class: 'hint', text: 'وضعیت موتورها در دسترس نیست. صفحه را دوباره باز کنید.' }));
        }
      });
    }
    for (const entry of entries) {
      const card = el('div', { class: `engine-card${settings.recognition.engine === entry.id ? ' selected' : ''}` });
      card.appendChild(el('h3', { text: entry.label }));
      card.appendChild(el('div', { class: `badge ${entry.available ? 'good' : entry.reason === 'not-implemented' ? 'muted' : 'warn'}`, text: entry.available ? 'در دسترس' : `غیرفعال (${entry.reason})` }));
      const list = el('ul');
      for (const note of entry.notes || []) list.appendChild(el('li', { text: note }));
      card.appendChild(list);
      const btn = el('button', { class: 'small', text: settings.recognition.engine === entry.id ? 'موتور فعال' : 'انتخاب این موتور' });
      btn.disabled = !entry.available || settings.recognition.engine === entry.id;
      btn.addEventListener('click', () => {
        persist((s) => setPath(s, 'recognition.engine', entry.id), 'موتور تغییر کرد');
        render();
      });
      card.appendChild(btn);
      grid.appendChild(card);
    }
    if (!grid.children.length) grid.appendChild(el('div', { class: 'hint', text: 'برای مشاهده وضعیت موتورها، صفحه را دوباره باز کنید یا دیباگ را اجرا کنید.' }));
    return wrap;
  },

  commands() {
    const wrap = el('div', { class: 'vt-col' });
    const table = el('table');
    table.innerHTML = '<thead><tr><th>دستور</th><th>عبارت‌ها</th><th>نتیجه</th></tr></thead>';
    const tbody = el('tbody');
    const list = window.__VT_COMMANDS__ || [];
    for (const cmd of list) {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'nowrap', text: cmd.id }));
      tr.appendChild(el('td', { text: [...cmd.fa, ...cmd.en].join(' • '), dir: 'auto' }));
      tr.appendChild(el('td', { text: describeAction(cmd.action) }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  },

  terms() {
    const wrap = el('div', { class: 'vt-col' });
    const toolbar = el('div', { class: 'vt-row wrap' });
    const count = el('span', { class: 'hint', text: `${settings.dictionary.terms.length} واژه سفارشی (حداکثر ${DICTIONARY_LIMIT_MAX})` });
    const add = el('button', { class: 'small primary', text: '+ افزودن واژه' });
    add.addEventListener('click', () => {
      const terms = [...settings.dictionary.terms, { term: '', kind: 'proper', category: 'custom', fa: [], en: [] }];
      persist((s) => setPath(s, 'dictionary.terms', terms));
      render();
    });
    toolbar.append(add, count);
    wrap.appendChild(toolbar);

    const list = el('div', { class: 'vt-col' });
    settings.dictionary.terms.forEach((term, index) => {
      const card = el('div', { class: 'engine-card' });
      const grid = el('div', { class: 'field-grid' });
      const termInput = el('input', { type: 'text', dir: 'ltr', value: term.term, placeholder: 'React' });
      termInput.addEventListener('change', () => {
        const terms = settings.dictionary.terms.map((t, i) => (i === index ? { ...t, term: termInput.value } : t));
        persist((s) => setPath(s, 'dictionary.terms', terms));
      });
      grid.appendChild(el('label', { class: 'field' }, [el('span', { text: 'املای صحیح (لاتین)' }), termInput]));

      const kindSelect = el('select');
      for (const [value, label] of [['proper', 'خاص (همیشه لاتین)'], ['generic', 'عمومی (اختیاری)']]) {
        const option = el('option', { value, text: label });
        if (term.kind === value) option.selected = true;
        kindSelect.appendChild(option);
      }
      kindSelect.addEventListener('change', () => {
        const terms = settings.dictionary.terms.map((t, i) => (i === index ? { ...t, kind: kindSelect.value } : t));
        persist((s) => setPath(s, 'dictionary.terms', terms));
      });
      grid.appendChild(el('label', { class: 'field' }, [el('span', { text: 'نوع' }), kindSelect]));

      const faInput = el('input', { type: 'text', dir: 'auto', value: (term.fa || []).join('، '), placeholder: 'ری‌اکت، ری اکت' });
      faInput.addEventListener('change', () => {
        const fa = faInput.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
        const terms = settings.dictionary.terms.map((t, i) => (i === index ? { ...t, fa } : t));
        persist((s) => setPath(s, 'dictionary.terms', terms));
      });
      grid.appendChild(el('label', { class: 'field' }, [el('span', { text: 'شکل‌های فارسی (با کاما جدا کنید)' }), faInput]));

      const enInput = el('input', { type: 'text', dir: 'ltr', value: (term.en || []).join(', '), placeholder: 'reactjs, react js' });
      enInput.addEventListener('change', () => {
        const en = enInput.value.split(',').map((s) => s.trim()).filter(Boolean);
        const terms = settings.dictionary.terms.map((t, i) => (i === index ? { ...t, en } : t));
        persist((s) => setPath(s, 'dictionary.terms', terms));
      });
      grid.appendChild(el('label', { class: 'field' }, [el('span', { text: 'شکل‌های انگلیسی' }), enInput]));

      const remove = el('button', { class: 'small danger', text: 'حذف' });
      remove.addEventListener('click', () => {
        const terms = settings.dictionary.terms.filter((t, i) => i !== index);
        persist((s) => setPath(s, 'dictionary.terms', terms));
        render();
      });
      card.append(grid, remove);
      list.appendChild(card);
    });
    wrap.appendChild(list);
    return wrap;
  },

  rules() {
    const wrap = el('div', { class: 'vt-col' });
    const add = el('button', { class: 'small primary', text: '+ افزودن قاعده' });
    add.addEventListener('click', () => {
      const rules = [...settings.dictionary.rules, { pattern: '', replacement: '', mode: 'word', caseSensitive: false, enabled: true }];
      persist((s) => setPath(s, 'dictionary.rules', rules));
      render();
    });
    wrap.appendChild(el('div', { class: 'vt-row' }, [add]));
    settings.dictionary.rules.forEach((rule, index) => {
      const card = el('div', { class: 'engine-card' });
      const grid = el('div', { class: 'field-grid' });
      const pattern = el('input', { type: 'text', dir: 'auto', value: rule.pattern, placeholder: 'reactjs' });
      pattern.addEventListener('change', () => updateRule(index, { pattern: pattern.value }));
      grid.appendChild(el('label', { class: 'field' }, [el('span', { text: 'الگو' }), pattern]));

      const replacement = el('input', { type: 'text', dir: 'auto', value: rule.replacement, placeholder: 'React.js' });
      replacement.addEventListener('change', () => updateRule(index, { replacement: replacement.value }));
      grid.appendChild(el('label', { class: 'field' }, [el('span', { text: 'جایگزین' }), replacement]));

      const mode = el('select');
      for (const [value, label] of [['word', 'کلمه کامل'], ['substring', 'بخشی از متن'], ['compact', 'با فاصله انعطاف‌پذیر'], ['regex', 'Regex (پیشرفته)']]) {
        const option = el('option', { value, text: label });
        if (rule.mode === value) option.selected = true;
        mode.appendChild(option);
      }
      mode.addEventListener('change', () => updateRule(index, { mode: mode.value }));
      grid.appendChild(el('label', { class: 'field' }, [el('span', { text: 'حالت' }), mode]));

      const controls = el('div', { class: 'vt-row wrap' });
      const enabled = el('label', { class: 'switch' });
      const enabledInput = el('input', { type: 'checkbox' });
      enabledInput.checked = rule.enabled !== false;
      enabledInput.addEventListener('change', () => updateRule(index, { enabled: enabledInput.checked }));
      enabled.append(enabledInput, el('span', { text: 'فعال' }));

      const remove = el('button', { class: 'small danger', text: 'حذف' });
      remove.addEventListener('click', () => {
        const rules = settings.dictionary.rules.filter((r, i) => i !== index);
        persist((s) => setPath(s, 'dictionary.rules', rules));
        render();
      });
      controls.append(enabled, remove);
      card.append(grid, controls);
      wrap.appendChild(card);
    });
    if (!settings.dictionary.rules.length) wrap.appendChild(el('p', { class: 'hint', text: 'هنوز قاعده‌ای اضافه نشده است.' }));
    return wrap;
  },

  importExport() {
    const wrap = el('div', { class: 'vt-col' });
    const row = el('div', { class: 'vt-row wrap' });
    const exportBtn = el('button', { class: 'small', text: 'دریافت فایل پشتیبان تنظیمات' });
    exportBtn.addEventListener('click', async () => {
      const res = await api.exportSettings();
      if (!res.ok) return toast('خروجی گرفتن ناموفق بود.', 'error');
      const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: 'voicetype-pro-settings.json' });
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return toast('فایل پشتیبان ساخته شد.', 'ok');
    });

    const importInput = el('input', { type: 'file', accept: 'application/json' });
    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const res = await api.importSettings(payload);
        if (res.ok) { settings = res.settings; render(); toast('تنظیمات بازیابی شد.', 'ok'); }
        else toast('فایل معتبر نیست.', 'error');
      } catch (err) {
        toast('خواندن فایل ناموفق بود.', 'error');
      }
    });

    row.append(exportBtn, importInput);
    wrap.append(row, el('p', { class: 'hint', text: 'فایل پشتیبان شامل واژه‌نامه، قواعد و همه تنظیمات است (کلید API در آن ذخیره می‌شود؛ با احتیاط به اشتراک بگذارید).' }));
    return wrap;
  },

  shortcuts() {
    const wrap = el('div', { class: 'vt-col' });
    const list = el('div', { class: 'kbd-list' });
    const names = {
      'toggle-dictation': 'شروع / توقف واژه‌نگاری',
      'cancel-dictation': 'لغو جلسه جاری',
      'insert-last-transcript': 'درج آخرین متن',
      'toggle-floating-ui': 'نمایش / پنهان‌کردن نشانگر شناور'
    };
    const shortcuts = diagnostics?.serviceWorker?.commands || [];
    for (const [id, label] of Object.entries(names)) {
      const found = shortcuts.find((s) => s.name === id);
      const row = el('div', { class: 'kbd-row' });
      row.append(el('span', { text: label }), el('code', { text: found?.shortcut || 'ثبت نشده' }));
      list.appendChild(row);
    }
    const btn = el('button', { class: 'small', text: 'باز کردن صفحه میانبرهای Chrome' });
    btn.addEventListener('click', () => api.openShortcuts());
    wrap.append(list, btn, el('p', { class: 'hint', text: 'اگر میانبر پیشنهادی با برنامه دیگری تداخل داشت، از صفحه بالا آن را تغییر دهید. افزونه پس از تغییر، بلافاصله از میانبر جدید استفاده می‌کند.' }));
    return wrap;
  },

  history() {
    const wrap = el('div', { class: 'vt-col' });
    const controls = el('div', { class: 'vt-row wrap' });
    const enabled = el('label', { class: 'switch' });
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = settings.history.enabled !== false;
    checkbox.addEventListener('change', async () => {
      persist((s) => setPath(s, 'history.enabled', checkbox.checked));
      await loadHistory();
      render();
    });
    enabled.append(checkbox, el('span', { text: 'ذخیره تاریخچه' }));

    const limit = el('input', { type: 'number', min: 0, max: HISTORY_LIMIT_MAX, value: settings.history.limit });
    limit.style.maxWidth = '120px';
    limit.addEventListener('change', () => persist((s) => setPath(s, 'history.limit', Number(limit.value))));

    const clearBtn = el('button', { class: 'small danger', text: 'پاک کردن همه' });
    const listHost = el('div', { class: 'list scroll' });
    clearBtn.addEventListener('click', async () => {
      await api.clearHistory();
      await loadHistory();
      toast('تاریخچه پاک شد.', 'ok');
    });
    controls.append(enabled, el('span', { class: 'hint', text: 'حداکثر تعداد:' }), limit, clearBtn);
    wrap.append(controls, listHost);

    loadHistory();
    async function loadHistory() {
      const res = await api.history();
      clear(listHost);
      if (!res.ok || !res.history.length) {
        listHost.appendChild(el('p', { class: 'hint', text: 'تاریخچه خالی است.' }));
        return;
      }
      for (const entry of res.history) {
        const item = el('div', { class: 'item' });
        const meta = el('div', { class: 'meta' });
        meta.append(
          el('span', { text: `${formatDate(entry.at)} ${formatTime(entry.at)}` }),
          el('span', { class: 'badge muted', text: entry.lang || '—' }),
          el('span', { class: 'badge muted', text: entry.engine || '—' }),
          el('span', { text: `${entry.chars} کاراکتر` })
        );
        const text = el('div', { class: 'text', text: entry.text });
        const actions = el('div', { class: 'vt-row' });
        const copy = el('button', { class: 'small ghost', text: 'کپی' });
        copy.addEventListener('click', async () => {
          const done = await copyToClipboard(entry.text);
          toast(done ? 'کپی شد.' : 'کپی ناموفق بود.', done ? 'ok' : 'error');
        });
        actions.appendChild(copy);
        item.append(meta, text, actions);
        listHost.appendChild(item);
      }
    }
    return wrap;
  },

  privacy() {
    const wrap = el('div', { class: 'vt-col' });
    const engine = settings.recognition.engine;
    const items = [];
    const local = engine === ENGINES.WEBSPEECH && settings.recognition.processLocally;
    items.push({
      title: 'صدا کجا پردازش می‌شود؟',
      value: engine === ENGINES.HTTP_WHISPER
        ? (settings.whisper.endpoint ? `روی سرور انتخابی شما (${settings.whisper.endpoint})` : 'سروری تنظیم نشده است')
        : engine === ENGINES.LOCAL_AI
          ? 'روی همین دستگاه (موتور محلی — هنوز پیاده‌سازی نشده)'
          : local ? 'روی همین دستگاه (بسته‌های زبان Chrome، در صورت پشتیبانی زبان)'
            : 'در سرویس تشخیص گفتار Google (رفتار استاندارد Web Speech API)'
    });
    items.push({
      title: 'آیا افزونه صدا را ذخیره می‌کند؟',
      value: 'خیر. صدا هرگز ذخیره یا به سرور توسعه‌دهنده ارسال نمی‌شود. فقط وقتی موتور Whisper فعال باشد، قطعه‌های صوتی به سرویس خودِ شما فرستاده می‌شود.'
    });
    items.push({
      title: 'متن تبدیل‌شده ذخیره می‌شود؟',
      value: settings.history.enabled
        ? `بله، فقط در حافظه محلی مرورگر (حداکثر ${settings.history.limit} مورد) و قابل پاک کردن است.`
        : 'خیر، تاریخچه غیرفعال است.'
    });
    items.push({
      title: 'اطلاعات صفحه جمع‌آوری می‌شود؟',
      value: 'خیر. افزونه فقط به فیلد متنی فعال دسترسی دارد تا متن را در محل نشانگر درج کند؛ محتوای صفحه خوانده یا ارسال نمی‌شود.'
    });
    items.push({
      title: 'کلیدهای API',
      value: settings.whisper.apiKey
        ? 'کلید API فقط در chrome.storage.local همین مرورگر نگهداری می‌شود و تنها در درخواست به همان سرویس استفاده می‌گردد.'
        : 'کلید API ثبت نشده است.'
    });
    const dl = el('dl', { class: 'kv' });
    for (const item of items) {
      dl.append(el('dt', { text: item.title }), el('dd', { text: item.value }));
    }
    wrap.appendChild(dl);
    return wrap;
  },

  debug() {
    const wrap = el('div', { class: 'vt-col' });
    const row = el('div', { class: 'vt-row wrap' });
    const dumpBtn = el('button', { class: 'small', text: 'اجرای عیب‌یابی' });
    const copyBtn = el('button', { class: 'small', text: 'کپی گزارش' });
    const clearBtn = el('button', { class: 'small danger', text: 'پاک کردن لاگ‌ها' });
    const pre = el('pre', { class: 'dump', text: 'برای مشاهده وضعیت کامل، «اجرای عیب‌یابی» را بزنید.' });
    const logHost = el('div', { class: 'scroll', id: 'log-host' });
    logHost.style.border = '1px solid var(--vt-border)';
    logHost.style.borderRadius = 'var(--vt-radius-sm)';

    const renderLogs = () => {
      clear(logHost);
      const entries = [...liveLogs].slice(-200).reverse();
      if (!entries.length) logHost.appendChild(el('div', { class: 'hint', text: 'لاگی ثبت نشده است.' }));
      for (const entry of entries) {
        const line = el('div', { class: 'log-line' });
        line.append(
          el('span', { class: 'lvl', text: entry.level || 'info' }),
          el('span', { class: 'msg', text: entry.message || '' }),
          el('span', { class: 'data', text: entry.data ? JSON.stringify(entry.data) : '' })
        );
        logHost.appendChild(line);
      }
    };

    dumpBtn.addEventListener('click', async () => {
      const res = await api.diagnostics();
      diagnostics = res;
      pre.textContent = JSON.stringify(res, null, 2).slice(0, 40000);
    });
    copyBtn.addEventListener('click', async () => {
      const done = await copyToClipboard(pre.textContent || '');
      toast(done ? 'گزارش کپی شد.' : 'کپی ناموفق بود.', done ? 'ok' : 'error');
    });
    clearBtn.addEventListener('click', async () => {
      await api.clearLogs();
      liveLogs = [];
      renderLogs();
    });

    row.append(dumpBtn, copyBtn, clearBtn);
    wrap.append(row, pre, el('h3', { text: 'جریان زنده رویدادها' }), logHost);

    api.logs().then((res) => {
      if (res.ok) { liveLogs = res.logs; renderLogs(); }
    });
    renderLogs();
    return wrap;
  },

  about() {
    const wrap = el('div', { class: 'vt-col' });
    const manifest = chrome.runtime.getManifest();
    const dl = el('dl', { class: 'kv' });
    dl.append(
      el('dt', { text: 'نسخه' }), el('dd', { text: `${manifest.version} (Manifest V${manifest.manifest_version})` }),
      el('dt', { text: 'حداقل نسخه Chrome' }), el('dd', { text: manifest.minimum_chrome_version || '—' }),
      el('dt', { text: 'دسترسی‌ها' }), el('dd', { text: manifest.permissions.join(', ') }),
      el('dt', { text: 'دسترسی سایت‌ها' }), el('dd', { text: 'http://*/* و https://*/* — برای درج متن در فیلدهای متنی همان صفحه' })
    );
    wrap.appendChild(dl);

    const note = el('div', { class: 'alert info' });
    note.innerHTML = 'این افزونه هیچ کد از راه دور اجرا نمی‌کند (بدون inline script، بدون eval، بدون CDN). سیاست امنیتی: <code>script-src \'self\'</code>.';
    wrap.appendChild(note);

    const catalogBtn = el('button', { class: 'small', text: 'مقایسه موتورها' });
    const catalogHost = el('div', { class: 'vt-col' });
    catalogBtn.addEventListener('click', async () => {
      const res = await api.diagnostics();
      clear(catalogHost);
      const catalog = res?.offscreen?.engineCatalog || [];
      for (const entry of catalog) {
        catalogHost.appendChild(el('div', { class: 'engine-card' }, [
          el('h3', { text: entry.label }),
          el('div', { class: `badge ${entry.available ? 'good' : 'muted'}`, text: entry.available ? 'در دسترس' : entry.reason }),
          el('ul', {}, (entry.notes || []).map((n) => el('li', { text: n })))
        ]));
      }
    });
    wrap.append(catalogBtn, catalogHost);
    return wrap;
  },

  welcome() {
    const wrap = el('div', { class: 'vt-col' });
    const checklist = el('ul', { class: 'checklist' });
    const micState = diagnostics?.offscreen?.mic?.state || 'unknown';
    const items = [
      ['دسترسی میکروفون', micState === 'granted' ? '✅' : '⬜', 'با دکمه زیر آزمایش کنید.'],
      ['موتور تشخیص', settings.recognition.engine !== ENGINES.HTTP_WHISPER || settings.whisper.endpoint ? '✅' : '⚠️', 'حالت Web Speech بدون تنظیم اضافه کار می‌کند.'],
      ['تنظیم میانبر', (diagnostics?.serviceWorker?.commands || []).some((c) => c.name === 'toggle-dictation' && c.shortcut) ? '✅' : '⬜', 'میانبر پیشنهادی: Ctrl+Shift+Space'],
      ['تست درج متن', '⬜', 'یک فیلد متنی را باز کنید و میانبر را بزنید.']
    ];
    for (const [title, mark, hint] of items) {
      checklist.appendChild(el('li', {}, [
        el('span', { class: 'mark', text: mark }),
        el('div', {}, [el('strong', { text: title }), el('div', { class: 'hint', text: hint })])
      ]));
    }
    wrap.appendChild(checklist);

    const buttons = el('div', { class: 'vt-row wrap' });
    const micBtn = el('button', { class: 'small primary', text: 'آزمایش میکروفون (۲ ثانیه)' });
    const micResult = el('span', { class: 'hint' });
    micBtn.addEventListener('click', async () => {
      micResult.textContent = 'در حال ضبط… چند کلمه بگویید.';
      const res = await api.micTest(2200);
      micResult.textContent = res.ok
        ? `میکروفون فعال است (اوج سطح صدا: ${Math.round((res.level || 0) * 100)}%)`
        : `مشکل میکروفون: ${res.error || res.state}`;
    });
    const shortcutBtn = el('button', { class: 'small', text: 'تغییر/مشاهده میانبر' });
    shortcutBtn.addEventListener('click', () => api.openShortcuts());
    buttons.append(micBtn, shortcutBtn, micResult);
    wrap.appendChild(buttons);

    const tip = el('div', { class: 'alert ok' });
    tip.textContent = 'پیشنهاد: در «زبان» حالت «تشخیص خودکار» و در «پردازش متن» گزینه «حفظ اصطلاحات فنی به انگلیسی» فعال بماند تا جمله‌های مخلوط فارسی/انگلیسی درست نوشته شوند.';
    wrap.appendChild(tip);
    return wrap;
  }
};

function updateRule(index, patch) {
  const rules = settings.dictionary.rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
  persist((s) => setPath(s, 'dictionary.rules', rules));
}

function describeAction(action) {
  if (!action) return '—';
  if (action.type === 'key') return `${action.key} ×${action.count || 1}`;
  if (action.type === 'text') return `درج «${action.value}»`;
  if (action.type === 'edit') return action.op === 'clearAll' ? 'پاک کردن همه متن' : 'حذف آخرین بخش';
  if (action.type === 'clipboard') return `عملیات ${action.op}`;
  if (action.type === 'control') return 'توقف ضبط';
  if (action.lang) return `تغییر زبان به ${action.lang}`;
  return '—';
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderNav() {
  clear(nav);
  for (const section of SECTIONS) {
    const btn = el('button', { class: location.hash === `#${section.id}` ? 'active' : '' });
    btn.append(el('span', { text: `${section.icon}  ${section.title}` }));
    btn.addEventListener('click', () => {
      location.hash = section.id;
      render();
    });
    nav.appendChild(btn);
  }
}

function renderStats(pillNode, labelNode) {
  api.diagnostics().then((res) => {
    diagnostics = res;
    const session = res?.serviceWorker?.session;
    const state = session?.active ? session.state : 'idle';
    pillNode.querySelector('.dot').className = `dot ${state}`;
    labelNode.textContent = session?.active
      ? `${STATE_LABEL_FA[state] || state} • ${session.lang || ''}`
      : 'آماده';
  });
}

function render() {
  const id = (location.hash || '#welcome').slice(1);
  const section = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  sectionTitle.textContent = `${section.icon}  ${section.title}`;
  clear(sectionBody);
  renderNav();
  for (const blockDef of SCHEMA[section.id] || []) {
    sectionBody.appendChild(block(blockDef));
  }
  renderAlerts();
}

function renderAlerts() {
  clear(alerts);
  if (!diagnostics) return;
  const mic = diagnostics.offscreen?.mic;
  if (mic && mic.state === 'denied') {
    alerts.appendChild(el('div', { class: 'alert error', text: 'دسترسی میکروفون رد شده است. روی آیکن میکروفون در نوار آدرس کلیک کنید و اجازه دسترسی بدهید.' }));
  }
  const err = diagnostics.offscreen?.session?.lastError;
  if (err && err.code) {
    alerts.appendChild(el('div', { class: `alert ${err.fatal ? 'error' : 'warn'}`, text: `${err.message} (${err.code})` }));
  }
}

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

window.addEventListener('hashchange', render);

subscribe((message) => {
  if (message.type === 'ui:update' && message.payload?.kind === 'log') {
    liveLogs.push(message.payload);
    const host = document.getElementById('log-host');
    if (host && liveLogs.length <= 400) {
      const line = el('div', { class: 'log-line' });
      line.append(
        el('span', { class: 'lvl', text: message.payload.level || 'info' }),
        el('span', { class: 'msg', text: message.payload.message || '' }),
        el('span', { class: 'data', text: message.payload.data ? JSON.stringify(message.payload.data) : '' })
      );
      host.prepend(line);
      while (host.children.length > 200) host.lastChild.remove();
    }
  }
});

$('#open-panel').addEventListener('click', () => api.openVoiceConsole());
$('#open-shortcuts').addEventListener('click', () => api.openShortcuts());

(async function init() {
  const manifest = chrome.runtime.getManifest();
  $('#version').textContent = `نسخه ${manifest.version}`;
  const res = await api.getSettings();
  if (res.ok) settings = res.settings;
  else {
    toast('ارتباط با پس‌زمینه برقرار نشد؛ مقادیر پیش‌فرض نمایش داده می‌شود.', 'warn');
    const { DEFAULT_SETTINGS } = await import('../common/settings.js');
    settings = DEFAULT_SETTINGS;
  }
  // commands table for the commands section
  try {
    const commandsModule = await import('../nlp/commands.js');
    window.__VT_COMMANDS__ = commandsModule.COMMANDS;
  } catch { /* optional */ }
  await api.diagnostics().then((r) => { diagnostics = r; });
  render();
  renderStats(statePill, stateLabel);
  setInterval(() => renderStats(statePill, stateLabel), 5000);
}());
