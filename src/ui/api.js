/**
 * Typed access to the service worker from every extension page.
 * All calls resolve — a failing background never leaves the UI stuck.
 */
import { MSG } from '../common/constants.js';

async function send(type, payload = {}) {
  try {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    return res || { ok: false, reason: 'no-response' };
  } catch (err) {
    return { ok: false, reason: 'background-unreachable', detail: String(err && err.message) };
  }
}

export const api = {
  ping: () => send(MSG.PING),
  getState: () => send(MSG.GET_STATE),
  getSettings: () => send(MSG.GET_SETTINGS),
  setSettings: (settings) => send(MSG.SET_SETTINGS, { settings }),
  resetSettings: () => send(MSG.RESET_SETTINGS),
  exportSettings: () => send(MSG.EXPORT_SETTINGS),
  importSettings: (payload) => send(MSG.IMPORT_SETTINGS, { payload }),

  start: () => send(MSG.START_DICTATION),
  stop: () => send(MSG.STOP_DICTATION),
  toggle: () => send(MSG.TOGGLE_DICTATION),
  cancel: () => send(MSG.CANCEL_DICTATION),
  insertLast: () => send(MSG.INSERT_LAST),
  copyLast: () => send(MSG.COPY_LAST),

  history: () => send(MSG.GET_HISTORY),
  clearHistory: () => send(MSG.CLEAR_HISTORY),
  logs: () => send(MSG.GET_LOGS),
  clearLogs: () => send(MSG.CLEAR_LOGS),
  diagnostics: () => send(MSG.DIAGNOSTICS),
  engineCatalog: () => send(MSG.ENGINE_CATALOG),

  micQuery: () => send(MSG.MIC_QUERY),
  micRequest: () => send(MSG.MIC_REQUEST),
  micTest: (durationMs) => send(MSG.MIC_TEST, { durationMs }),
  onDeviceCheck: (langs) => send(MSG.ON_DEVICE_CHECK, { langs }),

  openOptions: () => send(MSG.OPEN_OPTIONS),
  openShortcuts: () => send(MSG.OPEN_SHORTCUTS),
  openVoiceConsole: () => send(MSG.OPEN_VOICE_CONSOLE)
};

/**
 * Subscribe to background broadcasts (`ui:state`, `ui:update`, `ui:session-end`).
 * @returns {Function} unsubscribe
 */
export function subscribe(handler) {
  const listener = (message) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type.startsWith('ui:')) handler(message);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
