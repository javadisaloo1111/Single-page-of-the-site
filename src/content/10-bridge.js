/**
 * Bridge between the content script and the service worker:
 * typed messages, tolerant failure handling and a single place where the extension context
 * being invalidated (extension reload/update) is handled.
 */
(function initBridge(VT) {
  if (VT.bridge) return; // already injected (manifest + scripting both ran)
  const MSG = {
    CS_READY: 'cs:ready',
    CS_FOCUS: 'cs:focus',
    CS_INSERT: 'cs:insert',
    CS_CONF: 'cs:conf',
    CS_STATE: 'cs:state',
    CS_INTERIM: 'cs:interim',
    CS_TOAST: 'cs:toast',
    CS_EXEC: 'cs:exec',
    CS_PING: 'cs:ping',
    CS_EDIT_RESULT: 'cs:edit-result',
    CS_LOG: 'cs:log'
  };

  const bridge = {
    MSG,
    invalidated: false,

    alive() {
      try {
        return Boolean(chrome && chrome.runtime && chrome.runtime.id);
      } catch {
        return false;
      }
    },

    async send(message) {
      if (!this.alive()) { this.invalidated = true; return { ok: false, reason: 'context-invalidated' }; }
      try {
        return await chrome.runtime.sendMessage(message);
      } catch (err) {
        if (/Extension context invalidated|message port closed/i.test(String(err && err.message))) {
          this.invalidated = true;
        }
        return { ok: false, reason: 'send-failed' };
      }
    },

    onMessage(handler) {
      if (!this.alive()) return;
      try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (!message || typeof message.type !== 'string') return false;
          try {
            const result = handler(message, sender);
            if (result && typeof result.then === 'function') {
              result.then((value) => sendResponse(value ?? { ok: true })).catch(() => sendResponse({ ok: false }));
              return true;
            }
          } catch (err) {
            VT.log('error', 'message-handler-failed', String(err));
          }
          return false;
        });
      } catch { /* extension context gone */ }
    },

    log(level, message, data) {
      if (level === 'debug' && !VT.state.conf.debug?.enabled) return;
      this.send({ type: MSG.CS_LOG, level, message, data });
    }
  };

  VT.bridge = bridge;
}(window.__VOICETYPE__));
