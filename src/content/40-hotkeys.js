/**
 * Optional in-page shortcut fallback.
 *
 * The real shortcut is registered through the manifest `commands` API, which works globally and
 * is user-configurable in chrome://extensions/shortcuts. Some Chromium builds / OS layouts fail
 * to deliver a command while a page has focus, so this module offers a *different* key
 * (Alt+Shift+Space by default) that is handled in-page. It is disabled by default to make sure
 * a single key press can never toggle dictation twice.
 */
(function initHotkeys(VT) {
  if (VT.hotkeys) return; // already injected
  const FALLBACK_KEY = 'Alt+Shift+Space';
  let enabled = false;
  let guardShortcut = '';

  function comboFromEvent(event) {
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Command');
    const key = event.code === 'Space' ? 'Space'
      : event.code.startsWith('Key') ? event.code.slice(3)
        : event.code === 'Escape' ? 'Escape' : event.key.length === 1 ? event.key.toUpperCase() : event.code;
    parts.push(key);
    return parts.join('+');
  }

  function isEditableTarget(target) {
    return VT.inserter?.isEditableHost(target) || Boolean(target && target.closest && target.closest('input,textarea,[contenteditable]'));
  }

  function onKeyDown(event) {
    if (!enabled) return;
    const combo = comboFromEvent(event);
    if (combo === guardShortcut && guardShortcut) return; // avoid double toggle with chrome.commands
    if (combo !== FALLBACK_KEY) return;
    if (event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    VT.log('debug', 'page-shortcut', combo);
    VT.bridge?.send({ type: 'toggle-dictation' });
  }

  VT.hotkeys = {
    start() {
      document.addEventListener('keydown', onKeyDown, true);
    },
    configure(settings) {
      enabled = Boolean(settings?.hotkeys?.pageShortcutEnabled);
      guardShortcut = settings?.hotkeys?.commandShortcut || '';
    },
    /** Exposed for tests and for the options page preview. */
    comboFromEvent,
    isEditableTarget
  };
}(window.__VOICETYPE__));
