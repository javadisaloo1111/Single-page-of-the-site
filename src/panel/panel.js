/**
 * Voice Console — a first-class dictation surface inside the extension itself.
 *
 * It registers its own tab with the service worker as an insertion target, so it exercises the
 * exact same insertion pipeline as a web page while giving the user a place to test, review and
 * edit transcripts, see detected languages per segment and watch the debug stream.
 */
import { api, subscribe } from '../ui/api.js';
import { $, el, clear, toast, copyToClipboard, STATE_LABEL_FA, formatDuration } from '../ui/dom.js';
import { COMMANDS } from '../nlp/commands.js';
import { MSG } from '../common/constants.js';

const dom = {
  toggle: $('#toggle'),
  cancel: $('#cancel'),
  clear: $('#clear'),
  copy: $('#copy'),
  target: $('#target'),
  interim: $('#interim'),
  level: $('#level'),
  langBadge: $('#lang-badge'),
  engineBadge: $('#engine-badge'),
  statePill: $('#state-pill'),
  stateLabel: $('#state-label'),
  sessionKv: $('#session-kv'),
  detectedTags: $('#detected-tags'),
  segments: $('#segments'),
  alerts: $('#alerts'),
  debugHost: $('#debug-host'),
  commandPalette: $('#command-palette')
};

let myTabId = null;
let session = { state: 'idle', active: false };
let interimText = '';
let segments = [];
const detectedLanguages = new Map();

/* ------------------------------ messaging ------------------------------ */

function handleInsert(message) {
  const ops = Array.isArray(message.ops) ? message.ops : [];
  const host = dom.target;
  let touched = false;
  for (const op of ops) {
    if (op.type === 'text') {
      const start = host.selectionStart ?? host.value.length;
      const end = host.selectionEnd ?? start;
      host.value = host.value.slice(0, start) + op.value + host.value.slice(end);
      const caret = start + op.value.length;
      host.setSelectionRange(caret, caret);
      touched = true;
    } else if (op.type === 'key' && op.key === 'Enter') {
      const start = host.selectionStart ?? host.value.length;
      const end = host.selectionEnd ?? start;
      host.value = `${host.value.slice(0, start)}${'\n'.repeat(op.count || 1)}${host.value.slice(end)}`;
      host.setSelectionRange(start + (op.count || 1), start + (op.count || 1));
      touched = true;
    } else if (op.type === 'edit' && op.op === 'clearAll') {
      host.value = '';
    } else if (op.type === 'edit' && op.op === 'deleteLast') {
      host.value = host.value.replace(/[^\s]*\s*$/, '');
    } else if (op.type === 'clipboard' && op.op === 'copy') {
      copyToClipboard(host.value);
      toast('متن کادر کپی شد.', 'ok', 1800);
    }
  }
  if (touched) {
    const lastAdded = ops.filter((o) => o.type === 'text').map((o) => o.value).join(' ');
    if (lastAdded.trim()) {
      segments.unshift({ text: lastAdded.trim(), lang: message.meta?.lang || '—', at: new Date().toISOString(), mixed: message.meta?.detected?.mixed });
      segments = segments.slice(0, 60);
      renderSegments();
    }
  }
  return { ok: true };
}

function handleState(message) {
  session = { ...session, ...(message.session || {}), state: message.state };
  renderState();
}

function handleConf(message) {
  if (!message.conf) return;
  // mirror the on-page UI configuration (interim preview can be switched off)
  panelConf = message.conf;
  dom.target.placeholder = 'این کادر هدف واژه‌نگاری است. روی آن کلیک کنید و صحبت کنید…';
}
let panelConf = null;

function handleExec(message) {
  if (message.op === 'copyText') {
    copyToClipboard(message.text || dom.target.value).then((ok) => toast(ok ? 'کپی شد.' : 'کپی ناموفق بود.', ok ? 'ok' : 'error'));
    return { ok: true };
  }
  return { ok: false };
}

const CONTENT_MESSAGES = new Set([
  MSG.CS_CONF, MSG.CS_STATE, MSG.CS_INTERIM, MSG.CS_INSERT, MSG.CS_EXEC, MSG.CS_TOAST
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  if (!CONTENT_MESSAGES.has(message.type)) return false;
  if (message.targetTabId !== undefined && message.targetTabId !== myTabId) return false;

  switch (message.type) {
    case MSG.CS_INSERT:
      sendResponse(handleInsert(message));
      return false;
    case MSG.CS_STATE:
      handleState(message);
      sendResponse({ ok: true });
      return false;
    case MSG.CS_INTERIM:
      interimText = message.tail || '';
      renderInterim();
      sendResponse({ ok: true });
      return false;
    case MSG.CS_CONF:
      handleConf(message);
      sendResponse({ ok: true });
      return false;
    case MSG.CS_EXEC:
      sendResponse(handleExec(message));
      return false;
    case MSG.CS_TOAST:
      if (message.message) toast(message.message, message.fatal ? 'error' : 'info');
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

/* ------------------------------ rendering ------------------------------ */

function renderState() {
  const state = session.active ? (session.state || 'listening') : (session.state || 'idle');
  dom.statePill.querySelector('.dot').className = `dot ${state}`;
  dom.stateLabel.textContent = `${STATE_LABEL_FA[state] || state}${session.lang ? ` • ${session.lang}` : ''}`;
  dom.toggle.textContent = session.active ? 'توقف واژه‌نگاری' : 'شروع واژه‌نگاری';
  dom.toggle.classList.toggle('listening', Boolean(session.active));
  dom.engineBadge.textContent = session.engine || '—';
  const detection = session.lastDetection;
  dom.langBadge.textContent = detection
    ? `${detection.lang} (${Math.round((detection.confidence || 0) * 100)}%)${detection.mixed ? ' مخلوط' : ''}`
    : 'Auto';
  dom.langBadge.className = `badge ${detection?.mixed ? 'warn' : ''}`;

  const stats = session.stats || {};
  const rows = [
    ['وضعیت', STATE_LABEL_FA[state] || state],
    ['مدت جلسه', session.active && session.startedAt ? formatDuration(Date.now() - session.startedAt) : '—'],
    ['تعداد بخش‌ها', String(stats.finals || 0)],
    ['راه‌اندازی مجدد', String(session.restarts || stats.restarts || 0)],
    ['کاراکترهای نوشته‌شده', String(stats.chars || 0)],
    ['تغییر زبان', String(stats.switches || 0)],
    ['خطاها', String(stats.errors || 0)]
  ];
  clear(dom.sessionKv);
  for (const [key, value] of rows) {
    dom.sessionKv.append(el('dt', { text: key }), el('dd', { text: value }));
  }

  clear(dom.alerts);
  if (session.lastError && session.lastError.message) {
    dom.alerts.appendChild(el('div', { class: `alert ${session.lastError.fatal ? 'error' : 'warn'}`, text: `${session.lastError.message} (${session.lastError.code})` }));
  }
}

function renderInterim() {
  clear(dom.interim);
  if (!interimText || panelConf?.showInterim === false) {
    dom.interim.appendChild(el('span', { class: 'hint', text: '—' }));
    return;
  }
  dom.interim.appendChild(document.createTextNode(interimText));
}

function renderSegments() {
  clear(dom.segments);
  if (!segments.length) {
    dom.segments.appendChild(el('p', { class: 'hint', text: 'هنوز بخشی ثبت نشده است.' }));
    return;
  }
  for (const segment of segments) {
    const item = el('div', { class: 'item' });
    const meta = el('div', { class: 'meta' });
    meta.append(
      el('span', { text: new Date(segment.at).toLocaleTimeString('fa-IR') }),
      el('span', { class: 'badge muted', text: segment.lang || '—' }),
      segment.mixed ? el('span', { class: 'badge warn', text: 'گفتار مخلوط' }) : null
    );
    item.append(meta, el('div', { class: 'text', text: segment.text }));
    dom.segments.appendChild(item);

    if (segment.lang && segment.lang !== '—') {
      const key = String(segment.lang);
      detectedLanguages.set(key, (detectedLanguages.get(key) || 0) + 1);
    }
  }
  renderDetectedTags();
}

function renderDetectedTags() {
  clear(dom.detectedTags);
  if (!detectedLanguages.size) {
    dom.detectedTags.appendChild(el('span', { class: 'hint', text: 'در انتظار گفتار…' }));
    return;
  }
  for (const [lang, count] of [...detectedLanguages.entries()].sort((a, b) => b[1] - a[1])) {
    dom.detectedTags.appendChild(el('span', { class: 'chip', text: `${lang} × ${count}` }));
  }
}

function renderCommandPalette() {
  const demoIds = ['newline', 'paragraph', 'p-comma', 'p-period', 'p-question', 'undo', 'redo', 'copy', 'paste', 'clear-all', 'delete-last'];
  clear(dom.commandPalette);
  for (const id of demoIds) {
    const command = COMMANDS.find((c) => c.id === id);
    if (!command) continue;
    const chip = el('span', { class: 'chip', text: command.fa[0] });
    chip.title = `دستور صوتی: ${command.fa.join(' / ')} — نتیجه: ${describe(command)}`;
    chip.addEventListener('click', () => {
      if (command.action?.type === 'text') insertLocal(command.action.value);
      else if (command.action?.type === 'key') insertLocal('\n'.repeat(command.action.count || 1));
      else if (command.action?.type === 'edit' && command.action.op === 'clearAll') { dom.target.value = ''; }
      else toast(`این دستور فقط با صدا اجرا می‌شود: «${command.fa[0]}»`, 'info');
    });
    dom.commandPalette.appendChild(chip);
  }
}

function describe(command) {
  const action = command.action || {};
  if (action.type === 'text') return `درج «${action.value}»`;
  if (action.type === 'key') return `${action.count || 1} بار ${action.key}`;
  if (action.type === 'edit') return action.op;
  if (action.type === 'clipboard') return action.op;
  return '—';
}

function insertLocal(text) {
  const host = dom.target;
  const start = host.selectionStart ?? host.value.length;
  host.value = host.value.slice(0, start) + text + host.value.slice(host.selectionEnd ?? start);
  host.setSelectionRange(start + text.length, start + text.length);
  host.focus();
}

/* ------------------------------ interactions ------------------------------ */

dom.toggle.addEventListener('click', async () => {
  const res = await api.toggle();
  if (!res.ok) toast(`شروع نشد: ${res.reason}`, 'error');
  setTimeout(refresh, 300);
});

dom.cancel.addEventListener('click', async () => { await api.cancel(); setTimeout(refresh, 200); });
dom.clear.addEventListener('click', () => { dom.target.value = ''; });
dom.copy.addEventListener('click', async () => {
  const ok = await copyToClipboard(dom.target.value);
  toast(ok ? 'کپی شد.' : 'کپی ناموفق بود.', ok ? 'ok' : 'error');
});
$('#toggle-debug').addEventListener('click', () => dom.debugHost.classList.toggle('hidden'));

dom.target.addEventListener('focus', () => announceTarget());
dom.target.addEventListener('click', () => announceTarget());

async function announceTarget() {
  await chrome.runtime.sendMessage({
    type: MSG.CS_READY,
    hasEditable: true,
    url: chrome.runtime.getURL('src/panel/panel.html')
  });
}

subscribe((message) => {
  if (message.type === 'ui:update') {
    const payload = message.payload;
    if (payload.kind === 'mic-level') { dom.level.style.width = `${Math.min(100, Math.round(payload.level * 100))}%`; return; }
    if (payload.kind === 'log') {
      const line = el('div', { class: 'log-line' });
      line.append(
        el('span', { class: 'lvl', text: payload.level || 'info' }),
        el('span', { class: 'msg', text: payload.message || '' }),
        el('span', { class: 'data', text: payload.data ? JSON.stringify(payload.data) : '' })
      );
      dom.debugHost.prepend(line);
      while (dom.debugHost.children.length > 200) dom.debugHost.lastChild.remove();
      return;
    }
    if (payload.kind === 'interim') { interimText = payload.tail || ''; renderInterim(); return; }
    if (payload.state) session = { ...session, ...payload.state };
    if (payload.session) session = { ...session, ...payload.session };
    renderState();
  }
  if (message.type === 'ui:state') {
    session = message.payload.session || session;
    renderState();
  }
  if (message.type === 'ui:session-end') {
    session.active = false;
    session.state = 'idle';
    interimText = '';
    renderState();
    renderInterim();
  }
});

async function refresh() {
  const res = await api.getState();
  if (res.ok) {
    session = res.state.session;
    renderState();
  }
}

(async function init() {
  try {
    const tab = await chrome.tabs.getCurrent();
    myTabId = tab?.id ?? null;
  } catch { myTabId = null; }
  renderCommandPalette();
  renderInterim();
  renderSegments();
  await refresh();
  await announceTarget();
  setInterval(() => { if (session.active) renderState(); }, 1000);
}());
