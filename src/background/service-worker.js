/**
 * VoiceType Pro — MV3 service worker.
 *
 * Role: router + state keeper. The session itself lives in the offscreen document (it owns the
 * microphone), so the worker may be suspended at any time without interrupting dictation: on
 * wake-up it re-syncs with the offscreen document instead of trusting stale globals.
 */
import {
  MSG, STATE, ERR, STATE_LABEL_FA, ENGINES
} from '../common/constants.js';
import {
  loadSettings, saveSettings, patchSettings, resetSettings, contentSettings,
  sanitizeSettings, exportSettingsPayload, importSettingsPayload
} from '../common/settings.js';
import { sanitizeIncoming, sendToFrame, broadcastToUi, queryActiveTab, isExtensionPageUrl } from './messaging.js';
import { OFFSCREEN_MESSAGES, ensureOffscreen, closeOffscreen } from './offscreenHost.js';
import {
  addHistoryEntry, getHistory, clearHistory, getLogs, clearLogs, getStats, bumpStats, pruneHistory, persistSession
} from './storage.js';

const OFFSCREEN_IDLE_CLOSE_MS = 2000;

/** Offscreen-only message types (see the guard in the router below). */
const SW_IGNORED_TYPES = new Set([
  MSG.OFF_START, MSG.OFF_STOP, MSG.OFF_ABORT, MSG.OFF_SETTINGS, MSG.OFF_PING,
  MSG.OFF_MIC_TEST, MSG.OFF_MIC_QUERY, MSG.OFF_WHISPER_TEST, MSG.OFF_ON_DEVICE_CHECK,
  MSG.OFF_DIAGNOSTICS
]);

/** Live state. */
const state = {
  session: {
    active: false,
    state: STATE.IDLE,
    lang: null,
    engine: ENGINES.WEBSPEECH,
    mic: 'unknown',
    restarts: 0,
    stats: {},
    lastDetection: null,
    lastError: null,
    startedAt: 0,
    tabId: null,
    frameId: null
  },
  settings: null,
  targets: new Map(),      // tabId -> { frameId, hasEditable, url, at }
  lastTranscript: '',
  lastOps: null,
  lastMeta: null,
  micLevel: 0,
  pendingClose: null
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

async function settings() {
  if (!state.settings) state.settings = await loadSettings();
  return state.settings;
}

async function updateBadge() {
  const active = state.session.active;
  const label = active ? 'REC' : '';
  const color = state.session.state === STATE.ERROR ? '#b3261e'
    : state.session.state === STATE.MIC_DENIED || state.session.state === STATE.MIC_UNAVAILABLE ? '#8f4c00'
      : '#c62828';
  try {
    await chrome.action.setBadgeText({ text: label });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle({
      title: active ? `VoiceType Pro — ${STATE_LABEL_FA[state.session.state] || 'در حال گوش دادن'}` : 'VoiceType Pro — آماده'
    });
  } catch { /* action not ready */ }
}

async function pushStateToUi() {
  const snapshot = await buildStatePayload();
  await broadcastToUi('ui:state', snapshot);
  return snapshot;
}

async function buildStatePayload() {
  const cfg = await settings();
  return {
    session: { ...state.session },
    settings: cfg,
    lastTranscript: state.lastTranscript,
    hasLastOps: Boolean(state.lastOps),
    micLevel: state.micLevel,
    commands: await commandShortcuts(),
    stats: await getStats()
  };
}

async function commandShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    return commands.map((c) => ({ name: c.name, shortcut: c.shortcut, description: c.description }));
  } catch {
    return [];
  }
}

async function sendToTarget(tabId, frameId, message) {
  const target = state.targets.get(tabId);
  const isExtensionPage = Boolean(target && target.isExtensionPage);
  return sendToFrame(tabId, frameId, message, { isExtensionPage });
}

function notifyTarget(message) {
  const tabId = state.session.tabId;
  if (typeof tabId !== 'number') return Promise.resolve({ ok: false, reason: 'no-tab' });
  const frameId = state.session.frameId;
  return sendToTarget(tabId, frameId, message);
}

function toContentConf(cfg) {
  return { type: MSG.CS_CONF, conf: contentSettings(cfg) };
}

async function broadcastConf() {
  const cfg = await settings();
  const message = toContentConf(cfg);
  for (const tabId of state.targets.keys()) {
    await sendToFrame(tabId, state.targets.get(tabId).frameId, message);
  }
  await notifyTarget(message);
  // keep every open tab's floating UI in sync (cheap: one message per known tab)
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => tab.id ? chrome.tabs.sendMessage(tab.id, message).catch(() => {}) : null));
  } catch { /* noop */ }
}

/** Pick the frame that should receive the text. */
async function resolveInsertTarget() {
  const active = await queryActiveTab();
  const sessionTabId = state.session.tabId;
  const activeTarget = active && state.targets.get(active.id);
  if (activeTarget && activeTarget.hasEditable) {
    return { tabId: active.id, frameId: activeTarget.frameId, reason: 'active-focused' };
  }
  if (typeof sessionTabId === 'number') {
    const known = state.targets.get(sessionTabId);
    if (known && known.hasEditable) return { tabId: sessionTabId, frameId: known.frameId, reason: 'session-step' };
    try {
      const tab = await chrome.tabs.get(sessionTabId);
      if (tab && tab.id) return { tabId: tab.id, frameId: 0, reason: 'session-tab' };
    } catch { /* tab closed */ }
  }
  if (active && active.id) {
    return { tabId: active.id, frameId: activeTarget?.frameId ?? 0, reason: 'active-tab' };
  }
  return null;
}

/** Inject the content script into a tab that was loaded before the extension was installed. */
async function ensureContentScript(tabId) {
  try {
    const cfg = await settings();
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: false }, files: ['src/content/content.css'] }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: [
        'src/content/00-namespace.js',
        'src/content/10-bridge.js',
        'src/content/20-tracker.js',
        'src/content/30-inserter.js',
        'src/content/40-hotkeys.js',
        'src/content/50-floating.js',
        'src/content/99-main.js'
      ]
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await sendToFrame(tabId, 0, toContentConf(cfg));
    return true;
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Session control
 * ------------------------------------------------------------------ */

async function toggleDictation() {
  if (state.session.active) return stopDictation();
  return startDictation();
}

async function startDictation({ fromCommand = false } = {}) {
  const cfg = await settings();
  const active = await queryActiveTab();
  if (!active || typeof active.id !== 'number') return { ok: false, reason: 'no-active-tab' };

  // make sure the page can receive instructions (also covers pre-install tabs / SPA reloads)
  let target = state.targets.get(active.id);
  if (!target) {
    await ensureContentScript(active.id);
    target = state.targets.get(active.id) || { frameId: 0, hasEditable: false };
  }

  await ensureOffscreen();
  const res = await OFFSCREEN_MESSAGES.start({
    settings: cfg,
    tabId: active.id,
    frameId: target.frameId ?? 0,
    lang: cfg.language.mode === 'manual' ? cfg.language.manualLang : undefined
  });

  if (!res || res.ok !== true) {
    const reason = res?.reason || 'engine-start-failed';
    const code = reason === 'mic-denied' ? ERR.MIC_DENIED
      : reason === 'mic-busy' ? ERR.MIC_BUSY
        : reason === 'no-endpoint' ? ERR.WHISPER_CONFIG
          : reason === 'unsupported' ? ERR.UNSUPPORTED
            : ERR.INTERNAL;
    await notifyTarget({ type: MSG.CS_TOAST, code, fatal: true });
    state.session.active = false;
    await pushStateToUi();
    return { ok: false, reason, code };
  }

  state.session.active = true;
  state.session.tabId = active.id;
  state.session.frameId = target.frameId ?? 0;
  state.session.lang = res.lang || cfg.language.fallbackLang;
  state.session.engine = res.engine || cfg.recognition.engine;
  state.session.startedAt = Date.now();
  state.session.restarts = 0;
  state.session.state = STATE.LISTENING;

  await chrome.alarms.create('vt-health', { periodInMinutes: 1 }).catch(() => {});
  await notifyTarget({ type: MSG.CS_STATE, state: state.session.state, session: { ...state.session } });
  await updateBadge();
  await bumpStats({ sessions: 1 });
  await persistSession({ active: true, tabId: state.session.tabId, startedAt: state.session.startedAt });
  await pushStateToUi();
  return { ok: true, lang: state.session.lang };
}

async function stopDictation({ abort = false, reason = 'user' } = {}) {
  if (!state.session.active) {
    await OFFSCREEN_MESSAGES.abort().catch(() => {});
    state.session.state = STATE.IDLE;
    await updateBadge();
    return { ok: true, alreadyStopped: true };
  }
  await OFFSCREEN_MESSAGES.stop({ abort, reason });
  await finishSession(reason);
  return { ok: true };
}

async function finishSession(reason) {
  const dictationMs = state.session.startedAt ? Date.now() - state.session.startedAt : 0;
  state.session.active = false;
  state.session.state = STATE.IDLE;
  state.session.frameId = null;
  state.session.startedAt = 0;
  await chrome.alarms.clear('vt-health').catch(() => {});
  if (dictationMs > 0) await bumpStats({ dictationMs });
  await persistSession({ active: false, at: Date.now(), reason });
  await updateBadge();
  await broadcastToUi('ui:session-end', { reason });
  await pushStateToUi();
  scheduleOffscreenClose();
}

function scheduleOffscreenClose() {
  if (state.pendingClose) clearTimeout(state.pendingClose);
  state.pendingClose = setTimeout(async () => {
    state.pendingClose = null;
    if (state.session.active) return;
    await closeOffscreen();
  }, OFFSCREEN_IDLE_CLOSE_MS);
}

/** Re-attach to a still-running session after the service worker was suspended. */
async function restoreSession() {
  const ping = await OFFSCREEN_MESSAGES.ping();
  if (!ping || ping.ok !== true) return false;
  const diag = await OFFSCREEN_MESSAGES.diagnostics();
  if (!diag || !diag.session?.active) return false;
  state.session = { ...state.session, ...diag.session, active: true };
  await updateBadge();
  return true;
}

/* ------------------------------------------------------------------ *
 * Offscreen events
 * ------------------------------------------------------------------ */

async function handleOffscreenEvent(payload) {
  if (!payload || typeof payload !== 'object') return;
  const cfg = await settings();

  switch (payload.kind) {
    case 'state': {
      state.session.state = payload.state;
      state.session.active = payload.state !== STATE.IDLE ? (payload.session?.active ?? state.session.active) : false;
      if (payload.session) Object.assign(state.session, payload.session, { state: payload.state });
      await updateBadge();
      await notifyTarget({ type: MSG.CS_STATE, state: payload.state, session: { ...state.session } });
      await broadcastToUi('ui:update', { kind: 'state', state: state.session });
      break;
    }
    case 'interim': {
      if (!cfg.ui.showInterim) break;
      await notifyTarget({ type: MSG.CS_INTERIM, tail: payload.tail, lang: payload.lang });
      await broadcastToUi('ui:update', { kind: 'interim', tail: payload.tail, lang: payload.lang });
      break;
    }
    case 'ops': {
      await handleOps(payload);
      break;
    }
    case 'lang': {
      state.session.lang = payload.lang;
      state.session.lastDetection = payload.detected || null;
      await broadcastToUi('ui:update', { kind: 'lang', lang: payload.lang, detected: payload.detected });
      break;
    }
    case 'lang-switch': {
      await bumpStats({ languageSwitches: 1 });
      await broadcastToUi('ui:update', { kind: 'lang-switch', lang: payload.lang });
      break;
    }
    case 'transcript': {
      state.lastTranscript = payload.text;
      state.lastMeta = payload.meta || null;
      const entry = await addHistoryEntry({
        text: payload.text,
        lang: payload.meta?.lang,
        engine: payload.meta?.engine || state.session.engine,
        meta: payload.meta
      }, cfg);
      await bumpStats({ chars: payload.text.length, finals: 1 });
      if (entry) await broadcastToUi('ui:update', { kind: 'history', entry });
      break;
    }
    case 'mic': {
      state.session.mic = payload.state;
      await broadcastToUi('ui:update', { kind: 'mic', state: payload.state, error: payload.error, devices: payload.devices, test: payload.test });
      break;
    }
    case 'mic-level': {
      state.micLevel = payload.level;
      await broadcastToUi('ui:update', { kind: 'mic-level', level: payload.level });
      break;
    }
    case 'session': {
      if (payload.session) Object.assign(state.session, payload.session);
      await updateBadge();
      await broadcastToUi('ui:update', { kind: 'session', session: state.session });
      break;
    }
    case 'restart': {
      state.session.restarts = payload.count;
      await broadcastToUi('ui:update', { kind: 'restart', count: payload.count, delay: payload.delay });
      break;
    }
    case 'error': {
      state.session.lastError = { code: payload.code, message: payload.message, fatal: payload.fatal, at: Date.now() };
      if (payload.fatal) state.session.state = payload.state || STATE.ERROR;
      await bumpStats({ errors: 1 });
      await notifyTarget({ type: MSG.CS_TOAST, code: payload.code, message: payload.message, fatal: payload.fatal });
      await broadcastToUi('ui:update', { kind: 'error', ...payload });
      await updateBadge();
      break;
    }
    case 'log': {
      await appendLogSafe(payload, cfg);
      await broadcastToUi('ui:update', { kind: 'log', ...payload });
      break;
    }
    default:
      break;
  }
}

async function appendLogSafe(payload, cfg) {
  const { appendLog } = await import('./storage.js');
  await appendLog({
    at: new Date().toISOString(),
    level: payload.level,
    message: payload.message,
    data: payload.data
  }, cfg);
}

async function handleOps(payload) {
  const target = await resolveInsertTarget();
  if (!target) {
    await broadcastToUi('ui:update', { kind: 'error', code: ERR.NO_TARGET, message: 'هیچ فیلد متنی فعالی پیدا نشد.', fatal: false });
    return;
  }
  // keep the session's route in sync with wherever the user actually is
  state.session.tabId = target.tabId;
  state.session.frameId = target.frameId;

  const message = {
    type: MSG.CS_INSERT,
    ops: payload.ops,
    meta: {
      lang: payload.meta?.lang,
      detected: payload.meta?.detected,
      commandMatches: payload.meta?.commandMatches || []
    }
  };
  let res = await sendToTarget(target.tabId, target.frameId, message);
  if (!res.ok && (res.reason === 'no-content-script')) {
    const injected = await ensureContentScript(target.tabId);
    if (injected) res = await sendToTarget(target.tabId, target.frameId, message);
  }
  if (!res.ok) {
    // last resort: main frame
    res = await sendToFrame(target.tabId, 0, message, {
      isExtensionPage: Boolean(state.targets.get(target.tabId)?.isExtensionPage)
    });
  }
  state.lastOps = payload.ops;
  if (payload.meta?.commandMatches?.length) {
    await broadcastToUi('ui:update', { kind: 'commands', matches: payload.meta.commandMatches });
  }
  if (!res.ok) {
    await broadcastToUi('ui:update', { kind: 'error', code: ERR.NO_TARGET, message: 'درج متن در این صفحه ممکن نشد.', fatal: false });
  }
}

/* ------------------------------------------------------------------ *
 * Commands + context menu
 * ------------------------------------------------------------------ */

chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'toggle-dictation':
      await toggleDictation();
      break;
    case 'cancel-dictation':
      await OFFSCREEN_MESSAGES.abort().catch(() => {});
      await finishSession('cancelled');
      break;
    case 'insert-last-transcript':
      await insertLastTranscript();
      break;
    case 'toggle-floating-ui': {
      const cfg = await settings();
      const next = await patchSettings({ ui: { floatingHidden: !cfg.ui.floatingHidden } });
      state.settings = next;
      await broadcastConf();
      break;
    }
    default:
      break;
  }
});

async function insertLastTranscript() {
  if (!state.lastTranscript) return { ok: false, reason: 'empty' };
  const target = await resolveInsertTarget();
  if (!target) return { ok: false, reason: 'no-target' };
  const res = await sendToTarget(target.tabId, target.frameId, {
    type: MSG.CS_INSERT,
    ops: [{ type: 'text', value: state.lastTranscript }],
    meta: { lang: state.session.lang }
  });
  return res;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  state.settings = await loadSettings();
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: 'vt-start-stop', title: 'شروع / توقف واژه‌نگاری صوتی', contexts: ['editable'] });
    chrome.contextMenus.create({ id: 'vt-insert-last', title: 'درج آخرین متن تبدیل‌شده', contexts: ['editable'] });
    chrome.contextMenus.create({ id: 'vt-options', title: 'تنظیمات VoiceType Pro', contexts: ['action'] });
  } catch { /* context menu unavailable */ }
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#welcome') }).catch(() => {});
  }
  await updateBadge();
});

chrome.contextMenus?.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'vt-start-stop') await toggleDictation();
  else if (info.menuItemId === 'vt-insert-last') await insertLastTranscript();
  else if (info.menuItemId === 'vt-options') await chrome.runtime.openOptionsPage();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'vt-health') return;
  if (!state.session.active) { await chrome.alarms.clear('vt-health').catch(() => {}); return; }
  const alive = await restoreSession();
  if (!alive) {
    state.session.active = false;
    state.session.state = STATE.IDLE;
    await updateBadge();
    await pushStateToUi();
  }
});

/* ------------------------------------------------------------------ *
 * Tab / window lifecycle
 * ------------------------------------------------------------------ */

chrome.tabs.onRemoved.addListener(async (tabId) => {
  state.targets.delete(tabId);
  if (state.session.tabId === tabId && state.session.active) {
    // the page the user dictates into is gone: keep the session (they may continue elsewhere)
    const active = await queryActiveTab();
    if (active && typeof active.id === 'number') {
      state.session.tabId = active.id;
      state.session.frameId = 0;
    } else {
      await stopDictation({ reason: 'tab-closed' });
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (state.session.active) {
    const known = state.targets.get(tabId);
    await sendToFrame(tabId, known?.frameId ?? 0, { type: MSG.CS_PING }).then((res) => {
      if (!res.ok) return ensureContentScript(tabId);
      return null;
    }).catch(() => {});
  }
});

chrome.windows?.onFocusChanged?.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || !state.session.active) return;
  const active = await queryActiveTab();
  if (active && typeof active.id === 'number') {
    const known = state.targets.get(active.id);
    if (known) {
      state.session.tabId = active.id;
      state.session.frameId = known.frameId;
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const known = state.targets.get(tabId);
  if (known) state.targets.delete(tabId);
  if (state.session.active && state.session.tabId === tabId) {
    // navigation drops the injected UI; re-attach so dictation keeps working
    await ensureContentScript(tabId);
  }
});

/* ------------------------------------------------------------------ *
 * Message router
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  // Defence in depth: only accept messages that originate from this very extension
  // (our own pages *and* our own content scripts carry the same runtime id).
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const message = sanitizeIncoming(rawMessage);
  if (!message) return false;

  // Messages addressed *to the offscreen document* must not be answered here: `sendMessage`
  // resolves with the first responder, so an "unhandled" reply from this listener could
  // preempt the real answer. Only the offscreen document owns these types.
  if (SW_IGNORED_TYPES.has(message.type)) return false;

  (async () => {
    switch (message.type) {
      /* ---------- state & settings ---------- */
      case MSG.PING:
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version, alive: true });
        return;
      case MSG.GET_STATE:
        sendResponse({ ok: true, state: await buildStatePayload() });
        return;
      case MSG.GET_SETTINGS:
        sendResponse({ ok: true, settings: await settings() });
        return;
      case MSG.SET_SETTINGS: {
        // Always a deep patch against the current settings: the popup, the options page and the
        // content script (floating position / minimize) all send partial objects.
        const next = await patchSettings(message.settings || {});
        state.settings = next;
        await OFFSCREEN_MESSAGES.settings(next);
        await broadcastConf();
        await pushStateToUi();
        sendResponse({ ok: true, settings: next });
        return;
      }
      case MSG.RESET_SETTINGS: {
        const next = await resetSettings();
        state.settings = next;
        await OFFSCREEN_MESSAGES.settings(next);
        await broadcastConf();
        sendResponse({ ok: true, settings: next });
        return;
      }
      case MSG.EXPORT_SETTINGS:
        sendResponse({ ok: true, payload: exportSettingsPayload(await settings()) });
        return;
      case MSG.IMPORT_SETTINGS: {
        try {
          const next = await saveSettings(importSettingsPayload(message.payload));
          state.settings = next;
          await OFFSCREEN_MESSAGES.settings(next);
          await broadcastConf();
          sendResponse({ ok: true, settings: next });
        } catch (err) {
          sendResponse({ ok: false, reason: 'invalid-payload' });
        }
        return;
      }

      /* ---------- dictation control ---------- */
      case MSG.START_DICTATION:
        sendResponse(await startDictation({ fromCommand: Boolean(message.fromCommand) }));
        return;
      case MSG.STOP_DICTATION:
        sendResponse(await stopDictation({ reason: 'user' }));
        return;
      case MSG.CANCEL_DICTATION:
        await OFFSCREEN_MESSAGES.abort().catch(() => {});
        await finishSession('cancelled');
        sendResponse({ ok: true });
        return;
      case MSG.TOGGLE_DICTATION:
        sendResponse(await toggleDictation());
        return;
      case MSG.INSERT_LAST:
        sendResponse(await insertLastTranscript());
        return;
      case MSG.COPY_LAST: {
        if (!state.lastTranscript) { sendResponse({ ok: false, reason: 'empty' }); return; }
        const target = await resolveInsertTarget();
        if (!target) { sendResponse({ ok: false, reason: 'no-target' }); return; }
        sendResponse(await sendToTarget(target.tabId, target.frameId, {
          type: MSG.CS_EXEC,
          op: 'copyText',
          text: state.lastTranscript
        }));
        return;
      }

      /* ---------- data ---------- */
      case MSG.GET_HISTORY:
        sendResponse({ ok: true, history: await getHistory(), stats: await getStats() });
        return;
      case MSG.CLEAR_HISTORY:
        await clearHistory();
        sendResponse({ ok: true });
        return;
      case MSG.GET_LOGS:
        sendResponse({ ok: true, logs: await getLogs() });
        return;
      case MSG.CLEAR_LOGS:
        await clearLogs();
        sendResponse({ ok: true });
        return;
      case MSG.ENGINE_CATALOG: {
        const diag = await OFFSCREEN_MESSAGES.catalog();
        if (!state.session.active) scheduleOffscreenClose();
        sendResponse({ ok: true, catalog: diag?.engineCatalog || [] });
        return;
      }
      case MSG.DIAGNOSTICS: {
        const diag = await OFFSCREEN_MESSAGES.diagnostics();
        sendResponse({
          ok: true,
          offscreen: diag,
          serviceWorker: {
            session: { ...state.session },
            targets: [...state.targets.entries()].map(([tabId, t]) => ({ tabId, ...t })),
            manifest: chrome.runtime.getManifest().version,
            commands: await commandShortcuts(),
            stats: await getStats(),
            settingsSummary: {
              engine: (await settings()).recognition.engine,
              languageMode: (await settings()).language.mode,
              debug: (await settings()).debug.enabled
            }
          }
        });
        if (!state.session.active) scheduleOffscreenClose();
        return;
      }

      /* ---------- microphone ---------- */
      case MSG.MIC_QUERY:
        sendResponse({ ok: true, ...(await OFFSCREEN_MESSAGES.micQuery()) });
        if (!state.session.active) scheduleOffscreenClose();
        return;
      case MSG.MIC_REQUEST: {
        const res = await OFFSCREEN_MESSAGES.micTest(600);
        sendResponse({ ok: Boolean(res?.ok), ...res });
        if (!state.session.active) scheduleOffscreenClose();
        return;
      }
      case MSG.MIC_TEST: {
        const res = await OFFSCREEN_MESSAGES.micTest(Math.max(1000, Math.min(5000, Number(message.durationMs) || 2000)));
        sendResponse({ ok: Boolean(res?.ok), ...res });
        if (!state.session.active) scheduleOffscreenClose();
        return;
      }

      /* ---------- engine probes ---------- */
      case MSG.ON_DEVICE_CHECK:
        sendResponse({ ok: true, ...(await OFFSCREEN_MESSAGES.onDevice(message.langs || ['en-US'])) });
        if (!state.session.active) scheduleOffscreenClose();
        return;
      case MSG.WHISPER_TEST: {
        const probe = await OFFSCREEN_MESSAGES.whisperProbe();
        if (!state.session.active) scheduleOffscreenClose();
        sendResponse({ ok: true, ...probe });
        return;
      }

      /* ---------- UI navigation ---------- */
      case MSG.OPEN_OPTIONS:
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      case MSG.OPEN_SHORTCUTS:
        await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {});
        sendResponse({ ok: true });
        return;
      case MSG.OPEN_VOICE_CONSOLE:
        await chrome.tabs.create({ url: chrome.runtime.getURL('src/panel/panel.html') }).catch(() => {});
        sendResponse({ ok: true });
        return;

      /* ---------- content script ---------- */
      case MSG.CS_READY:
      case MSG.CS_FOCUS: {
        if (sender.tab && typeof sender.tab.id === 'number') {
          const hasEditable = message.hasEditable !== false;
          const url = message.url || sender.tab.url || '';
          state.targets.set(sender.tab.id, {
            frameId: sender.frameId ?? 0,
            hasEditable,
            isExtensionPage: isExtensionPageUrl(url),
            url,
            at: Date.now()
          });
          if (state.session.active && hasEditable) {
            // follow the user's cursor: the last focused editable wins
            state.session.tabId = sender.tab.id;
            state.session.frameId = sender.frameId ?? 0;
          }
          if (message.type === MSG.CS_READY) {
            const cfg = await settings();
            sendResponse({ ok: true, conf: contentSettings(cfg), state: state.session.state, active: state.session.active });
            return;
          }
        }
        sendResponse({ ok: true });
        return;
      }
      case MSG.CS_EDIT_RESULT: {
        if (message.text !== undefined && message.replaceCommitted) {
          state.lastTranscript = '';
        }
        sendResponse({ ok: true });
        return;
      }
      case MSG.CS_LOG: {
        await appendLogSafe({ level: message.level || 'info', message: message.message, data: message.data }, await settings());
        sendResponse({ ok: true });
        return;
      }
      case MSG.OFF_EVENT:
        await handleOffscreenEvent(message.payload);
        sendResponse({ ok: true });
        return;
      case MSG.OFF_READY:
        if (state.pendingClose) { clearTimeout(state.pendingClose); state.pendingClose = null; }
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, reason: 'unhandled' });
    }
  })().catch((err) => {
    try { sendResponse({ ok: false, reason: 'internal-error', detail: String(err && err.message) }); } catch { /* closed */ }
  });

  return true;
});

chrome.runtime.onStartup.addListener(async () => {
  state.settings = await loadSettings();
  await pruneHistory(state.settings);
  await restoreSession();
  await updateBadge();
});

/* Keep the floating UI config fresh for the session that is already running. */
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes['vt.settings.v1']) return;
  state.settings = sanitizeSettings(changes['vt.settings.v1'].newValue || {});
  await OFFSCREEN_MESSAGES.settings(state.settings);
  await broadcastConf();
  await broadcastToUi('ui:update', { kind: 'settings', settings: state.settings });
});

// warm start
(async () => {
  state.settings = await loadSettings();
  await updateBadge();
  const alive = await restoreSession();
  if (!alive) await closeOffscreen();
})().catch(() => {});

export { startDictation, stopDictation, toggleDictation, handleOffscreenEvent, state };
