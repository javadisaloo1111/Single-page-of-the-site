/**
 * Message validation + tab routing helpers.
 *
 * Every inbound message is treated as untrusted input: only known types are accepted, string
 * payloads are length-capped and unknown fields are dropped. Content scripts never receive
 * arbitrary data from other extensions or pages (`externally_connectable` is not declared).
 */
import { MSG, MAX_TEXT_CHUNK } from '../common/constants.js';
import { safeString, isPlainObject } from '../common/util.js';

const ALLOWED_TYPES = new Set(Object.values(MSG));

export function isValidMessage(message) {
  return Boolean(message) && typeof message === 'object' && typeof message.type === 'string' && ALLOWED_TYPES.has(message.type);
}

const MAX_MESSAGE_BYTES = 600_000; // ~600 KB: orders of magnitude above any legitimate payload

export function sanitizeIncoming(message) {
  if (!isValidMessage(message)) return null;
  // Reject oversized payloads before copying them (a broken/hostile sender must not be able to
  // exhaust the service worker's memory).
  try {
    if (JSON.stringify(message).length > MAX_MESSAGE_BYTES) return null;
  } catch {
    return null; // circular / unserialisable payload
  }
  const clean = { type: message.type };
  for (const [key, value] of Object.entries(message)) {
    if (key === 'type') continue;
    if (typeof value === 'string') clean[key] = safeString(value, MAX_TEXT_CHUNK);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) clean[key] = value;
    else if (isPlainObject(value) || Array.isArray(value)) clean[key] = JSON.parse(JSON.stringify(value));
  }
  return clean;
}

export function isFromExtensionPage(sender) {
  if (!sender) return false;
  const url = sender.url || sender.tab?.url || '';
  return typeof url === 'string' && url.startsWith('chrome-extension://');
}

export function isExtensionPageUrl(url) {
  return typeof url === 'string' && url.startsWith('chrome-extension://');
}

/**
 * Send a message to a specific frame of a tab, tolerating tabs that were closed or navigated.
 * Extension pages (the Voice Console) receive the message through the runtime channel with a
 * `targetTabId` field, because `tabs.sendMessage` only reaches content scripts.
 * @returns {Promise<object>}
 */
export async function sendToFrame(tabId, frameId, message, { isExtensionPage = false } = {}) {
  if (typeof tabId !== 'number') return { ok: false, reason: 'no-target-tab' };
  if (isExtensionPage) {
    try {
      const res = await chrome.runtime.sendMessage({ ...message, targetTabId: tabId });
      return res || { ok: true };
    } catch (err) {
      return { ok: false, reason: 'extension-page-unreachable' };
    }
  }
  const options = typeof frameId === 'number' ? { frameId } : undefined;
  try {
    const res = await chrome.tabs.sendMessage(tabId, message, options);
    return res || { ok: true };
  } catch (err) {
    const reason = /Receiving end does not exist/i.test(String(err && err.message))
      ? 'no-content-script'
      : 'send-failed';
    return { ok: false, reason };
  }
}

/** Send to every frame of a tab (used for state broadcasts). Ignores failures. */
export async function broadcastToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch { /* no receiver */ }
}

/** Broadcast to extension pages (popup / options / voice console). Failures are expected. */
export async function broadcastToUi(type, payload) {
  try {
    await chrome.runtime.sendMessage({ type, payload });
  } catch { /* no UI open */ }
}

export async function queryActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] || null;
  } catch (err) {
    return null;
  }
}
