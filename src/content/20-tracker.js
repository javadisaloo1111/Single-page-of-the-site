/**
 * Focus tracker: keeps a reference to the element the user is typing into.
 *
 * Why a tracker instead of reading `document.activeElement` at insertion time?
 *   - rich editors move focus to hidden helper elements (Monaco, CodeMirror, Google Docs),
 *   - the visible caret can live in an iframe whose `activeElement` is a body element,
 *   - the user may have clicked a button after the caret (the text must still land where the
 *     caret was).
 * The tracker therefore records: the last real editable host, the selection inside it, and
 * exposes `resolveHost()` which prefers the live selection and falls back to the journal.
 */
(function initTracker(VT) {
  if (VT.tracker) return; // already injected
  const tracker = {
    host: null,
    lastFocusedAt: 0,
    lastRect: null,
    lastSelection: null,

    start() {
      document.addEventListener('focusin', (event) => this.onFocus(event.target), true);
      document.addEventListener('selectionchange', () => this.onSelectionChange(), true);
      document.addEventListener('keyup', (event) => this.onFocus(event.target), true);
      document.addEventListener('mouseup', (event) => this.onFocus(event.target), true);
      window.addEventListener('blur', () => this.snapshot(), true);
    },

    /**
     * Canonical "can text be typed here?" test.
     * `isContentEditable` is used when available but never trusted alone: the attribute based
     * check also covers documents where the property is not implemented (xml/foreign documents)
     * and elements inside an editable root that inherit editing.
     */
    isEditable(el) {
      if (!el || el.nodeType !== 1) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA') return !el.disabled && !el.readOnly;
      if (tag === 'INPUT') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const allowed = ['text', 'search', 'url', 'email', 'tel', 'number', 'password'];
        if (!allowed.includes(type)) return false;
        return !el.disabled && !el.readOnly;
      }
      const attr = el.getAttribute && el.getAttribute('contenteditable');
      if (attr !== null && attr !== undefined && attr !== 'false' && attr !== 'inherit') return true;
      if (el.isContentEditable === true) return true;
      if (el.contentEditable === 'true' || el.contentEditable === 'plaintext-only') return true;
      // inherited editing: a body-level contenteditable makes all descendants editable
      if (el.closest) {
        const root = el.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
        if (root && root !== el) return true;
      }
      // ARIA textbox that is not contenteditable cannot be typed into — ignore it
      return false;
    },

    /**
     * Walk up to the closest real editable host.
     * Nested editables (e.g. a <span contenteditable> inside a rich editor) resolve to the
     * innermost one, which is where the browser would insert the character.
     */
    closestEditable(el) {
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 16) {
        const ownEditable = (node.getAttribute && node.getAttribute('contenteditable')) === 'true'
          || node.isContentEditable === true
          || node.contentEditable === 'true'
          || node.tagName === 'TEXTAREA'
          || (node.tagName === 'INPUT' && this.isEditable(node));
        if (ownEditable) return this.isEditable(node) ? node : null;
        node = node.parentElement;
        depth += 1;
      }
      return null;
    },

    onFocus(target) {
      const host = this.closestEditable(target);
      if (!host) return;
      this.setHost(host);
    },

    setHost(host) {
      const changed = this.host !== host;
      this.host = host;
      this.lastFocusedAt = Date.now();
      this.snapshot();
      if (changed) this.notify();
    },

    snapshot() {
      const host = this.host;
      if (!host || !host.isConnected) return;
      try {
        const rect = host.getBoundingClientRect();
        this.lastRect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      } catch { /* detached */ }
      if (host.isContentEditable) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          if (host.contains(range.startContainer)) this.lastSelection = range.cloneRange();
        }
      } else {
        this.lastSelection = { start: host.selectionStart, end: host.selectionEnd };
      }
    },

    onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const anchor = sel.anchorNode;
      const el = anchor && anchor.nodeType === 1 ? anchor : anchor?.parentElement;
      const host = this.closestEditable(el);
      if (host) this.setHost(host);
      else this.snapshot();
    },

    notify() {
      for (const listener of VT.listeners) {
        try { listener({ type: 'host', host: this.host }); } catch { /* noop */ }
      }
      VT.bridge?.send({
        type: VT.bridge.MSG.CS_FOCUS,
        hasEditable: Boolean(this.host),
        url: location.href.slice(0, 500)
      });
    },

    /** Resolve the element that should receive text right now. */
    resolveHost() {
      const active = this.closestEditable(document.activeElement);
      if (active) { this.setHost(active); return active; }
      // Google Docs / Monaco put the caret in a hidden textarea or a nested div
      const deep = this.closestEditable(this.deepActiveElement());
      if (deep) { this.setHost(deep); return deep; }
      if (this.host && this.host.isConnected) return this.host;
      return null;
    },

    deepActiveElement() {
      let el = document.activeElement;
      let depth = 0;
      while (el && el.shadowRoot && depth < 8) {
        el = el.shadowRoot.activeElement || el;
        depth += 1;
      }
      return el;
    },

    isHostConnected() {
      return Boolean(this.host && this.host.isConnected);
    },

    clear() {
      this.host = null;
      this.lastSelection = null;
    }
  };

  VT.tracker = tracker;
}(window.__VOICETYPE__));
