/**
 * Offscreen document host: create/close + request forwarding with a health check.
 *
 * MV3 constraint: the service worker has no DOM, so `getUserMedia` and `SpeechRecognition`
 * can only live in an offscreen document (or a real tab). The document is created on the first
 * dictation start and closed when the session ends, so the extension costs nothing while idle.
 */
import { MSG } from '../common/constants.js';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const REASONS = ['USER_MEDIA'];
const REQUEST_TIMEOUT_MS = 25000;

let creating = null;

async function hasDocument() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getContexts) return false;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    });
    return contexts.length > 0;
  } catch (err) {
    return false;
  }
}

export async function ensureOffscreen() {
  if (await hasDocument()) return true;
  if (creating) { await creating; return true; }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: REASONS,
    justification: 'Captures the microphone and runs speech recognition for voice typing.'
  }).catch((err) => {
    // "Only a single offscreen document may be created" race is fine
    if (!/single offscreen/i.test(String(err && err.message))) throw err;
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
  return true;
}

export async function closeOffscreen() {
  try {
    if (await hasDocument()) await chrome.offscreen.closeDocument();
  } catch (err) {
    // document already gone
  }
}

async function sendOnce(type, payload = {}) {
  return Promise.race([
    chrome.runtime.sendMessage({ type, ...payload }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), REQUEST_TIMEOUT_MS))
  ]);
}

/**
 * Send a request to the offscreen controller, creating the document when needed.
 * @returns {Promise<object>}
 */
export async function requestOffscreen(type, payload = {}, { create = true, retry = true } = {}) {
  if (create) await ensureOffscreen();
  try {
    const res = await sendOnce(type, payload);
    if (res && res.reason === 'timeout' && retry) {
      // the document may have been torn down between calls: recreate once and retry
      await ensureOffscreen();
      return await sendOnce(type, payload);
    }
    return res || { ok: false, reason: 'no-response' };
  } catch (err) {
    if (retry) {
      await ensureOffscreen();
      return await sendOnce(type, payload).catch(() => ({ ok: false, reason: 'unreachable' }));
    }
    return { ok: false, reason: 'unreachable' };
  }
}

export const OFFSCREEN_MESSAGES = Object.freeze({
  start: (payload) => requestOffscreen(MSG.OFF_START, payload, { retry: false }),
  stop: (payload = {}) => requestOffscreen(MSG.OFF_STOP, payload, { create: false }),
  abort: () => requestOffscreen(MSG.OFF_ABORT, {}, { create: false, retry: false }),
  settings: (settings) => requestOffscreen(MSG.OFF_SETTINGS, { settings }, { create: false, retry: false }),
  micQuery: () => requestOffscreen(MSG.OFF_MIC_QUERY, {}),
  micTest: (durationMs) => requestOffscreen(MSG.OFF_MIC_TEST, { durationMs }),
  onDevice: (langs) => requestOffscreen(MSG.OFF_ON_DEVICE_CHECK, { langs }, { create: false }),
  diagnostics: () => requestOffscreen(MSG.OFF_DIAGNOSTICS, {}, { create: true, retry: false }),
  catalog: () => requestOffscreen(MSG.OFF_DIAGNOSTICS, {}, { create: true, retry: true }),
  whisperProbe: () => requestOffscreen(MSG.OFF_WHISPER_TEST, {}, { create: true, retry: false }),
  ping: () => requestOffscreen(MSG.OFF_PING, {}, { create: false, retry: false })
});
