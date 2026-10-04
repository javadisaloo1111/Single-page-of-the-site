/** Popup: at-a-glance status, one-click control, quick toggles. */
import { api, subscribe } from '../ui/api.js';
import { $, el, clear, toast, copyToClipboard, STATE_LABEL_FA, formatDuration } from '../ui/dom.js';
import { LANGUAGES } from '../common/constants.js';

const dom = {
  version: $('#version'),
  statePill: $('#state-pill'),
  stateLabel: $('#state-label'),
  micBadge: $('#mic-badge'),
  engineBadge: $('#engine-badge'),
  langBadge: $('#lang-badge'),
  level: $('#level'),
  transcript: $('#transcript'),
  toggle: $('#toggle'),
  cancel: $('#cancel'),
  insertLast: $('#insert-last'),
  copyLast: $('#copy-last'),
  langSelect: $('#lang-select'),
  detected: $('#detected'),
  stats: $('#stats'),
  historyCount: $('#history-count'),
  alerts: $('#alerts'),
  shortcutHint: $('#shortcut-hint'),
  privacyList: $('#privacy-list'),
  options: {
    preserve: $('#opt-preserve'),
    punctuation: $('#opt-punctuation'),
    commands: $('#opt-commands'),
    floating: $('#opt-floating')
  }
};

let settings = null;
let session = { state: 'idle', active: false };
let lastTranscript = '';
let interimText = '';

function renderState() {
  const state = session.active ? (session.state || 'listening') : (session.state === 'idle' ? 'idle' : session.state);
  dom.statePill.className = 'pill';
  dom.statePill.querySelector('.dot').className = `dot ${state}`;
  dom.stateLabel.textContent = STATE_LABEL_FA[state] || state;
  dom.toggle.textContent = session.active ? 'توقف واژه‌نگاری' : 'شروع واژه‌نگاری';
  dom.toggle.classList.toggle('listening', Boolean(session.active));

  const micLabel = { granted: 'فعال', denied: 'رد شده', unavailable: 'در دسترس نیست', busy: 'مشغول', unknown: 'نامشخص', prompt: 'نیازمند اجازه' };
  const micState = session.mic || 'unknown';
  dom.micBadge.textContent = `میکروفون: ${micLabel[micState] || micState}`;
  dom.micBadge.className = `badge ${micState === 'granted' ? 'good' : micState === 'denied' || micState === 'unavailable' ? 'bad' : 'muted'}`;

  dom.engineBadge.textContent = `موتور: ${session.engine === 'http-whisper' ? 'Whisper' : session.engine === 'webspeech-dual' ? 'Dual Web Speech' : session.engine === 'local-ai' ? 'Local AI' : 'Web Speech'}`;

  if (settings) {
    const mode = settings.language.mode === 'manual' ? settings.language.manualLang : 'auto';
    dom.langBadge.textContent = mode === 'auto' ? 'تشخیص خودکار' : mode;
    dom.langBadge.className = `badge ${session.lastDetection?.mixed ? 'warn' : ''}`;
    const detected = session.lastDetection;
    dom.detected.textContent = detected
      ? `${detected.lang} (${Math.round((detected.confidence || 0) * 100)}%)${detected.mixed ? ' — گفتار مخلوط' : ''}`
      : 'در انتظار گفتار';

    dom.options.preserve.checked = settings.text.preserveEnglishWords !== false;
    dom.options.punctuation.checked = settings.text.punctuation?.enabled !== false;
    dom.options.commands.checked = settings.commands?.enabled !== false;
    dom.options.floating.checked = Boolean(settings.ui.floating) && !settings.ui.floatingHidden;
  }

  const stats = session.stats || {};
  if (session.active && session.startedAt) {
    dom.stats.textContent = `${formatDuration(Date.now() - session.startedAt)} • ${stats.finals || 0} بخش`;
  } else if (stats.finals) {
    dom.stats.textContent = `${stats.finals} بخش تبدیل‌شده`;
  } else {
    dom.stats.textContent = '';
  }
  dom.cancel.disabled = !session.active;
}

function renderTranscript() {
  clear(dom.transcript);
  const committed = lastTranscript;
  if (!committed && !interimText) {
    dom.transcript.appendChild(el('span', { class: 'hint', text: 'هنوز متنی تبدیل نشده است.' }));
    return;
  }
  if (committed) dom.transcript.appendChild(document.createTextNode(committed));
  if (interimText) {
    if (committed) dom.transcript.appendChild(document.createTextNode(' '));
    dom.transcript.appendChild(el('span', { class: 'interim', text: interimText }));
  }
}

function renderAlerts() {
  clear(dom.alerts);
  const error = session.lastError;
  if (!error) return;
  const hints = {
    'mic-denied': 'روی آیکن میکروفون در نوار آدرس کلیک کنید و «Allow» را انتخاب کنید، سپس دوباره تلاش کنید.',
    'mic-unavailable': 'اتصال میکروفون یا هدست را بررسی کنید و در تنظیمات ویندوز دستگاه ورودی پیش‌فرض را انتخاب کنید.',
    'mic-busy': 'برنامه دیگری (مانند تماس تصویری) میکروفون را در اختیار دارد؛ آن را ببندید.',
    'recognition-network': 'اینترنت را بررسی کنید. حالت آفلاین فقط با موتور محلی امکان‌پذیر است.',
    'whisper-config': 'در تنظیمات، آدرس سرور Whisper را وارد کنید.'
  };
  const node = el('div', { class: `alert ${error.fatal ? 'error' : 'warn'}` });
  node.appendChild(el('div', { text: error.message || 'خطا' }));
  if (hints[error.code]) node.appendChild(el('div', { class: 'hint', text: hints[error.code] }));
  node.appendChild(el('div', { class: 'hint', text: `کد خطا: ${error.code}` }));
  dom.alerts.appendChild(node);
}

function renderPrivacy() {
  if (!settings) return;
  clear(dom.privacyList);
  const engine = settings.recognition.engine;
  const items = [];
  if (engine === 'webspeech') {
    items.push(settings.recognition.processLocally
      ? '🎧 صدا روی دستگاه پردازش می‌شود (بسته‌های زبان Chrome).'
      : '☁️ صدا برای تشخیص گفتار به سرویس Google ارسال می‌شود (رفتار استاندارد Web Speech API در Chrome).');
  } else if (engine === 'webspeech-dual') {
    items.push('☁️ صدا برای دو جلسه تشخیص گفتار به سرویس Google ارسال می‌شود (حالت آزمایشی).');
  } else if (engine === 'http-whisper') {
    items.push(settings.whisper.endpoint
      ? `☁️ صدا فقط به سرور انتخابی شما ارسال می‌شود: ${settings.whisper.endpoint}`
      : '⚠️ آدرس سرور Whisper تنظیم نشده است.');
  } else if (engine === 'local-ai') {
    items.push('🔒 پردازش کاملاً محلی (این موتور هنوز پیاده‌سازی نشده است).');
  }
  items.push(settings.history.enabled
    ? `🗂️ متن تبدیل‌شده در همین مرورگر ذخیره می‌شود (حداکثر ${settings.history.limit} مورد، قابل پاک کردن).`
    : '🗂️ تاریخچه غیرفعال است؛ متن‌ها ذخیره نمی‌شوند.');
  items.push('🚫 هیچ داده‌ای به سرورهای توسعه‌دهنده افزونه ارسال نمی‌شود.');
  items.push(settings.debug.enabled ? '🐞 حالت دیباگ فعال است و رویدادها به‌صورت محلی ثبت می‌شوند.' : '🐞 حالت دیباگ غیرفعال است.');
  for (const item of items) dom.privacyList.appendChild(el('li', { text: item }));
}

function buildLangSelect() {
  clear(dom.langSelect);
  const auto = el('option', { value: 'auto', text: 'تشخیص خودکار (Auto Detect)' });
  dom.langSelect.appendChild(auto);
  for (const lang of LANGUAGES) {
    if (lang.code === 'auto') continue;
    dom.langSelect.appendChild(el('option', { value: lang.code, text: `${lang.labelFa} — ${lang.code}` }));
  }
}

async function refresh() {
  const res = await api.getState();
  if (res.ok) {
    settings = res.state.settings;
    session = res.state.session;
    lastTranscript = res.state.lastTranscript || '';
    const shortcuts = res.state.commands || [];
    const toggle = shortcuts.find((s) => s.name === 'toggle-dictation');
    dom.shortcutHint.textContent = toggle && toggle.shortcut
      ? `میانبر شروع/توقف: ${toggle.shortcut.replace('MacCtrl', 'Ctrl')}`
      : 'میانبری ثبت نشده — از dکمه «تغییر میانبر» استفاده کنید.';
    dom.historyCount.textContent = String((res.state.stats && res.state.stats.finals) || 0);
    dom.langSelect.value = settings.language.mode === 'manual' ? settings.language.manualLang : 'auto';
  } else {
    toast('ارتباط با پس‌زمینه افزونه برقرار نشد. صفحه را دوباره باز کنید.', 'error');
  }
  renderState();
  renderTranscript();
  renderAlerts();
  renderPrivacy();
}

async function refreshHistoryCount() {
  const res = await api.history();
  if (res.ok) {
    dom.historyCount.textContent = String(res.history.length);
  }
}

/* ------------------------------- interactions ------------------------------- */

dom.toggle.addEventListener('click', async () => {
  const res = await api.toggle();
  if (!res.ok) {
    const messages = {
      'mic-denied': 'دسترسی میکروفون داده نشد. اجازه دسترسی را در نوار آدرس فعال کنید.',
      'no-active-tab': 'پنجره فعالی پیدا نشد.',
      'no-endpoint': 'آدرس سرور Whisper در تنظیمات وارد نشده است.'
    };
    toast(messages[res.reason] || `شروع نشد: ${res.reason}`, 'error');
  }
  await refresh();
});

dom.cancel.addEventListener('click', async () => {
  await api.cancel();
  await refresh();
});

dom.copyLast.addEventListener('click', async () => {
  const res = await api.copyLast();
  if (res.ok) toast('متن کپی شد.', 'ok');
  else toast('برای کپی، ابتدا یک فیلد متنی را فعال کنید.', 'warn');
});

dom.insertLast.addEventListener('click', async () => {
  const res = await api.insertLast();
  if (res.ok) toast('متن درج شد.', 'ok');
  else toast('فیلد متنی فعالی پیدا نشد.', 'warn');
});

dom.langSelect.addEventListener('change', async () => {
  const value = dom.langSelect.value;
  if (value === 'auto') await api.setSettings({ language: { mode: 'auto' } });
  else await api.setSettings({ language: { mode: 'manual', manualLang: value } });
  await refresh();
});

const toggleSetting = (input, patchFn) => async () => {
  await api.setSettings(patchFn(input.checked));
  await refresh();
};
dom.options.preserve.addEventListener('change', toggleSetting(dom.options.preserve, (v) => ({ text: { preserveEnglishWords: v } })));
dom.options.punctuation.addEventListener('change', toggleSetting(dom.options.punctuation, (v) => ({ text: { punctuation: { enabled: v } } })));
dom.options.commands.addEventListener('change', toggleSetting(dom.options.commands, (v) => ({ commands: { enabled: v } })));
dom.options.floating.addEventListener('change', toggleSetting(dom.options.floating, (v) => ({ ui: { floating: v, floatingHidden: !v } })));

$('#open-options').addEventListener('click', () => api.openOptions());
$('#open-panel').addEventListener('click', () => { api.openVoiceConsole(); window.close(); });
$('#open-shortcuts').addEventListener('click', () => api.openShortcuts());
$('#open-history').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#history') }); window.close(); });

subscribe((message) => {
  if (message.type === 'ui:update') {
    const payload = message.payload;
    if (payload.kind === 'mic-level') { dom.level.style.width = `${Math.min(100, Math.round(payload.level * 100))}%`; return; }
    if (payload.kind === 'interim') {
      if (payload.tail) { interimText = payload.tail; renderTranscript(); }
      return;
    }
    if (payload.kind === 'log') return;
    if (payload.state) session = { ...session, ...payload.state };
    if (payload.session) session = { ...session, ...payload.session };
  }
  if (message.type === 'ui:state') {
    session = message.payload.session || session;
    settings = message.payload.settings || settings;
    lastTranscript = message.payload.lastTranscript || lastTranscript;
  }
  if (message.type === 'ui:session-end') {
    interimText = '';
    session.active = false;
    session.state = 'idle';
  }
  renderState();
  renderTranscript();
  renderAlerts();
});

(async function init() {
  buildLangSelect();
  const manifest = chrome.runtime.getManifest();
  dom.version.textContent = `نسخه ${manifest.version} • Manifest V${manifest.manifest_version}`;
  await refresh();
  await refreshHistoryCount();
  // poll the transient session stats (duration / finals) while dictating
  setInterval(() => { if (session.active) renderState(); }, 1000);
}());
