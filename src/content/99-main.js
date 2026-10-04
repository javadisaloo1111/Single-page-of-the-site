/**
 * Content-script entry point: wires the modules together and answers service-worker messages.
 *
 * Message contract (see src/common/constants.js MSG):
 *   cs:ready / cs:ping        → handshake + settings handoff
 *   cs:conf                   → settings push (replaces the local cache)
 *   cs:state                  → dictation state (drives the floating indicator)
 *   cs:interim                → live preview text
 *   cs:insert                 → ordered ops to apply to the focused editor
 *   cs:exec                   → single op (copy text, …)
 *   cs:toast                  → user-facing message
 */
(function boot(VT) {
  if (VT.booted) return;
  VT.booted = true;

  const { MSG } = VT.bridge;

  function applyConf(conf) {
    if (!conf) return;
    VT.state.conf = { ...VT.state.conf, ...conf, language: { ...VT.state.conf.language, ...(conf.language || {}) } };
    VT.hotkeys?.configure(VT.state.conf);
    if (VT.state.conf.floating === false || VT.state.conf.floatingHidden) VT.ui?.unmount();
    else if (VT.ui && VT.state.session !== 'idle') VT.ui.mount();
    VT.ui?.render();
  }

  function handleMessage(message) {
    switch (message.type) {
      case MSG.CS_PING:
        return { ok: true, hasEditable: Boolean(VT.tracker.host), url: location.href.slice(0, 500) };

      case MSG.CS_CONF:
        applyConf(message.conf);
        return { ok: true };

      case MSG.CS_STATE:
        VT.ui?.setState(message.state, { session: message.session });
        return { ok: true };

      case MSG.CS_INTERIM:
        VT.ui?.setInterim(message.tail || '');
        if (message.lang) VT.ui?.setLang(message.lang, false);
        return { ok: true };

      case MSG.CS_INSERT: {
        const ops = Array.isArray(message.ops) ? message.ops : [];
        return VT.inserter.applyOps(ops, { fallbackText: VT.state.lastTranscript }).then((result) => {
          VT.inserter.pruneJournal();
          const touchedText = result.results.some((r) => r.op.type === 'text');
          if (touchedText && !result.ok) {
            VT.ui?.showError('insertion-failed');
          }
          if (message.meta?.lang) VT.ui?.setLang(message.meta.lang, Boolean(message.meta.detected?.mixed));
          VT.bridge.send({
            type: MSG.CS_EDIT_RESULT,
            ok: result.ok,
            applied: result.applied,
            replaceCommitted: result.results.some((r) => r.op.type === 'edit'),
            url: location.href.slice(0, 200)
          });
          return { ok: result.ok, applied: result.applied };
        });
      }

      case MSG.CS_EXEC: {
        if (message.op === 'copyText') {
          return VT.inserter.copyText(VT.tracker.resolveHost(), message.text).then((res) => {
            if (!res.ok) VT.ui?.toast('متن یا انتخاب قابل کپی نبود.', 'warn');
            else VT.ui?.toast('متن کپی شد.', 'info', 2200);
            return { ok: res.ok };
          });
        }
        return { ok: false, reason: 'unknown-exec-op' };
      }

      case MSG.CS_TOAST: {
        if (message.fatal || message.code) VT.ui?.showError(message.code, message.message);
        else if (message.message) VT.ui?.toast(message.message, 'info');
        return { ok: true };
      }

      default:
        return { ok: false, reason: 'unhandled' };
    }
  }

  async function ready() {
    VT.tracker.start();
    VT.hotkeys?.start();
    const res = await VT.bridge.send({
      type: MSG.CS_READY,
      hasEditable: Boolean(VT.tracker.host),
      url: location.href.slice(0, 500)
    });
    if (res && res.conf) applyConf(res.conf);
    if (res && res.state && res.state !== 'idle') VT.ui?.setState(res.state, { session: { active: true } });
  }

  VT.bridge.onMessage(handleMessage);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') VT.inserter?.pruneJournal();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }

  VT.listeners.add((event) => {
    if (event.type === 'host' && VT.state.active) VT.ui?.mount();
  });
}(window.__VOICETYPE__));
