/**
 * Offscreen document entry point: message glue around VoiceController.
 * The document is created on demand by the service worker and closed as soon as the session
 * ends, so no microphone or CPU is held while the extension is idle.
 */
import { MSG, STATE } from '../common/constants.js';
import { loadSettings, sanitizeSettings } from '../common/settings.js';
import { VoiceController } from './controller.js';

let controller = null;
let settings = null;

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => {});
}

function emit(payload) {
  // never let a failing message channel break the session
  send({ type: MSG.OFF_EVENT, payload }).catch(() => {});
}

async function getSettings() {
  if (!settings) settings = await loadSettings();
  return settings;
}

async function ensureController() {
  if (!controller) {
    settings = await getSettings();
    controller = new VoiceController({
      settings,
      emit,
      now: () => Date.now()
    });
    await controller.init();
  }
  return controller;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  if (!message.type.startsWith('off:')) return false;

  (async () => {
    const ctl = await ensureController();
    switch (message.type) {
      case MSG.OFF_PING:
        sendResponse({ ok: true, state: ctl.state });
        return;
      case MSG.OFF_START: {
        if (message.settings) {
          settings = sanitizeSettings(message.settings);
          ctl.updateSettings(settings);
        }
        const result = await ctl.startSession({
          tabId: message.tabId,
          frameId: message.frameId,
          lang: message.lang,
          newSession: true
        });
        sendResponse(result);
        return;
      }
      case MSG.OFF_STOP:
        sendResponse(await ctl.stopSession({ abort: Boolean(message.abort), reason: message.reason || 'user' }));
        return;
      case MSG.OFF_ABORT:
        sendResponse(await ctl.stopSession({ abort: true, reason: 'abort' }));
        return;
      case MSG.OFF_SETTINGS:
        settings = sanitizeSettings(message.settings || {});
        await ctl.updateSettings(settings);
        sendResponse({ ok: true });
        return;
      case MSG.OFF_MIC_QUERY:
        sendResponse(await ctl.micQuery());
        return;
      case MSG.OFF_MIC_TEST:
        sendResponse(await ctl.microphoneTest(message.durationMs || 1600));
        return;
      case MSG.OFF_ON_DEVICE_CHECK: {
        const { WebSpeechEngine } = await import('../engines/webSpeechEngine.js');
        sendResponse(await WebSpeechEngine.onDeviceStatus(message.langs || ['en-US']));
        return;
      }
      case MSG.OFF_WHISPER_TEST: {
        const { HttpWhisperEngine } = await import('../engines/httpWhisperEngine.js');
        const probe = await HttpWhisperEngine.probe(settings);
        sendResponse(probe);
        return;
      }
      case MSG.OFF_DIAGNOSTICS:
        sendResponse(await ctl.diagnostics());
        return;
      default:
        sendResponse({ ok: false, reason: 'unknown-message' });
    }
  })().catch((err) => {
    emit({ kind: 'error', code: 'internal-error', message: String(err && err.message), fatal: false });
    try { sendResponse({ ok: false, reason: 'internal-error' }); } catch { /* channel closed */ }
  });

  return true; // keep the message channel open for the async response
});

// announce readiness so the service worker can flush state
send({ type: MSG.OFF_READY, state: STATE.IDLE }).catch(() => {});
