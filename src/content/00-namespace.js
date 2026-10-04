/**
 * Content-script namespace + idempotency guard.
 * Injection can happen twice (manifest + chrome.scripting.executeScript after install), so
 * every file cooperates through this single namespace and `boot()` runs exactly once.
 */
(function initNamespace() {
  if (window.__VOICETYPE__ && window.__VOICETYPE__.version) return;
  window.__VOICETYPE__ = {
    version: '1.0.0',
    booted: false,
    mountId: 'voicetype-root',
    state: {
      conf: {
        floating: true,
        floatingMinimized: false,
        floatingPosition: { x: 24, y: 24 },
        showInterim: true,
        showLanguageBadge: true,
        theme: 'auto',
        language: { mode: 'auto', manualLang: 'fa-IR', fallbackLang: 'fa-IR' },
        debug: { enabled: false }
      },
      session: 'idle',
      active: false,
      interim: '',
      lang: 'fa-IR',
      lastError: null,
      lastTranscript: '',
      micLevel: 0
    },
    journal: [],
    ui: null,
    listeners: new Set(),
    log(level, message, data) {
      try {
        if (level !== 'debug' || window.__VOICETYPE__.state.conf.debug?.enabled) {
          const sink = level === 'error' ? console.error : console.log;
          sink('[VoiceType]', message, data ?? '');
        }
      } catch { /* noop */ }
    }
  };
}());
