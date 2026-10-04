/**
 * Text insertion engine.
 *
 * Compatibility strategy (in order):
 *   1. `document.execCommand('insertText')` for contenteditable — it produces real `beforeinput`
 *      /`input` events, participates in the native undo stack and therefore keeps React, Vue,
 *      Angular, ProseMirror, Slate, TinyMCE and Gmail in sync.
 *   2. The native value setter + `InputEvent` for <input>/<textarea>. This is the documented
 *      way to update a controlled React input: `element.value = …` would be swallowed by
 *      React's value tracker, while the prototype setter + a proper `input` event is not.
 *   3. Manual Range surgery for contenteditable when (1) is unavailable or multi-line text has
 *      to be inserted.
 *
 * Every insertion is recorded in a journal so that «پاک کن» (delete last) and «همه رو پاک کن»
 * (clear all) can undo exactly what the extension wrote — including in rich editors.
 */
(function initInserter(VT) {
  if (VT.inserter) return; // already injected
  const MAX_JOURNAL = 60;
  const journal = VT.journal; // shared, so the service worker sees the same undo history

  const isNativeInput = (el) => Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

  /** Delegates to the tracker's canonical rule (the tracker loads first). */
  const isEditableHost = (el) => {
    if (!el) return false;
    if (VT.tracker && typeof VT.tracker.isEditable === 'function') return VT.tracker.isEditable(el);
    return isNativeInput(el) || el.isContentEditable === true;
  };

  function nativeValueSetter(el) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    return descriptor && descriptor.set ? descriptor.set : null;
  }

  function dispatchInput(el, data, inputType = 'insertText') {
    try {
      const event = new InputEvent('input', { bubbles: true, composed: true, inputType, data });
      el.dispatchEvent(event);
    } catch (err) {
      try { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch { /* noop */ }
    }
  }

  function dispatchBeforeInput(el, data, inputType) {
    try {
      const event = new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, composed: true, inputType, data
      });
      return el.dispatchEvent(event);
    } catch {
      return true;
    }
  }

  function setNativeValue(el, value) {
    const setter = nativeValueSetter(el);
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function focusHost(host) {
    try {
      host.focus({ preventScroll: true });
    } catch {
      try { host.focus(); } catch { /* noop */ }
    }
  }

  /* ------------------------------- input / textarea ------------------------------- */

  function insertIntoInput(host, text) {
    const start = typeof host.selectionStart === 'number' ? host.selectionStart : host.value.length;
    const end = typeof host.selectionEnd === 'number' ? host.selectionEnd : start;
    const before = host.value.slice(0, start);
    const after = host.value.slice(end);
    const inserted = host.tagName === 'INPUT' ? text.replace(/[\r\n]+/g, ' ') : text;
    const next = before + inserted + after;
    const caret = start + inserted.length;

    dispatchBeforeInput(host, inserted, 'insertText');
    focusHost(host);
    try { host.setSelectionRange(start, end); } catch { /* detached */ }
    setNativeValue(host, next);
    try { host.setSelectionRange(caret, caret); } catch { /* detached */ }
    dispatchInput(host, inserted);

    journal.push({ host, mode: 'native', start, end: caret, text: inserted, length: inserted.length, at: Date.now() });

    // some frameworks restore the caret on the next tick — re-assert once
    queueMicrotask(() => {
      if (!host.isConnected) return;
      try {
        if (host.selectionStart !== caret) host.setSelectionRange(caret, caret);
      } catch { /* noop */ }
    });

    return { ok: true, mode: 'native', start, end: caret, length: inserted.length, inserted };
  }

  /* ------------------------------- contenteditable ------------------------------- */

  function currentRangeInside(host) {
    const sel = window.getSelection();
    if (!sel) return null;
    if (sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (host.contains(range.startContainer) && host.contains(range.endContainer)) return range;
    return null;
  }

  function caretAtEnd(host) {
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return range;
  }

  function tryExecInsertText(text) {
    try {
      const ok = document.execCommand('insertText', false, text);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  function insertIntoEditable(host, text) {
    focusHost(host);
    let range = currentRangeInside(host) || VT.tracker?.lastSelection || caretAtEnd(host);
    if (!range || !host.contains(range.startContainer)) range = caretAtEnd(host);

    const lines = String(text).split('\n');
    const supportsExec = lines.length === 1 && tryExecInsertText(text);
    if (supportsExec) {
      const after = currentRangeInside(host);
      const journalRange = after ? after.cloneRange() : null;
      let length = text.length;
      if (journalRange) {
        // widen the range backwards so «delete last» removes the whole inserted chunk
        try {
          journalRange.setStart(journalRange.startContainer, Math.max(0, journalRange.startOffset - text.length));
          length = journalRange.toString().length;
        } catch { /* cross-node insertions keep the plain length */ }
      }
      journal.push({ host, mode: 'editable', range: journalRange, text, length, at: Date.now() });
      return { ok: true, mode: 'execCommand' };
    }

    const doc = host.ownerDocument;
    const fragment = doc.createDocumentFragment();
    const nodes = [];
    lines.forEach((line, index) => {
      if (index > 0) {
        const br = doc.createElement('br');
        fragment.appendChild(br);
        nodes.push(br);
      }
      if (line) {
        const node = doc.createTextNode(line);
        fragment.appendChild(node);
        nodes.push(node);
      }
    });

    dispatchBeforeInput(host, text, 'insertText');
    try {
      range.deleteContents();
      const last = nodes[nodes.length - 1];
      if (!last) return { ok: false, reason: 'empty-insertion' };
      range.insertNode(fragment);
      const next = doc.createRange();
      next.setStartAfter(last);
      next.collapse(true);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(next); }
      journal.push({ host, mode: 'editable', nodes, range: next.cloneRange(), text, length: text.length, at: Date.now() });
      dispatchInput(host, text);
      return { ok: true, mode: 'range' };
    } catch (err) {
      VT.log('error', 'editable-insert-failed', String(err));
      return { ok: false, reason: 'insert-failed' };
    }
  }

  /** Google Docs & similar canvas editors expose a hidden text input. */
  function googleDocsTarget() {
    const frame = document.querySelector('iframe.docs-texteventtarget-iframe');
    if (!frame) return null;
    try {
      const doc = frame.contentDocument;
      if (!doc) return null;
      return doc.querySelector('textarea') || doc.querySelector('[contenteditable="true"]');
    } catch {
      return null;
    }
  }

  /* ------------------------------- public API ------------------------------- */

  function insertText(host, text) {
    if (!host) return { ok: false, reason: 'no-host' };
    if (typeof text !== 'string' || text.length === 0) return { ok: true, mode: 'noop' };
    if (!isEditableHost(host)) return { ok: false, reason: 'not-editable' };

    if (isNativeInput(host)) return insertIntoInput(host, text);

    const docs = googleDocsTarget();
    if (docs) {
      try {
        docs.focus();
        if (tryExecInsertText(text)) {
          journal.push({ host: docs, mode: 'native', start: 0, end: 0, text, length: text.length, at: Date.now() });
          return { ok: true, mode: 'google-docs' };
        }
      } catch { /* fall through to the normal path */ }
    }

    return insertIntoEditable(host, text);
  }

  function insertNewline(host, count = 1) {
    if (!host) return { ok: false, reason: 'no-host' };
    if (isNativeInput(host)) {
      if (host.tagName === 'INPUT') return { ok: true, mode: 'noop' };
      return insertText(host, '\n'.repeat(count));
    }
    const text = '\n'.repeat(count);
    const result = insertIntoEditable(host, text);
    return result;
  }

  function insertIndent(host, spaces = 4) {
    return insertText(host, ' '.repeat(spaces));
  }

  function backspace(host, count = 1) {
    if (!host) return { ok: false, reason: 'no-host' };
    focusHost(host);
    for (let i = 0; i < count; i += 1) {
      try {
        const ok = document.execCommand('delete');
        if (!ok) break;
      } catch { break; }
    }
    return { ok: true, mode: 'execCommand' };
  }

  /* ------------------------------- journal based edits ------------------------------- */

  function pruneJournal() {
    while (VT.journal.length > MAX_JOURNAL) VT.journal.shift();
    for (let i = VT.journal.length - 1; i >= 0; i -= 1) {
      const entry = VT.journal[i];
      if (entry.host && !entry.host.isConnected) VT.journal.splice(i, 1);
    }
  }

  function deleteLast() {
    pruneJournal();
    const entry = VT.journal.pop();
    if (!entry) return { ok: false, reason: 'empty-journal' };
    const host = entry.host;
    if (!host || !host.isConnected) return { ok: false, reason: 'host-gone' };
    focusHost(host);

    if (entry.mode === 'native') {
      const value = host.value ?? '';
      const start = Math.max(0, Math.min(Number(entry.start) || 0, value.length));
      const end = Math.max(start, Math.min(Number(entry.end) || start + (entry.length || 0), value.length));
      const next = value.slice(0, start) + value.slice(end);
      setNativeValue(host, next);
      try { host.setSelectionRange(start, start); } catch { /* noop */ }
      dispatchInput(host, '', 'deleteContentBackward');
      return { ok: true, mode: 'native', removed: entry.text || '' };
    }

    // contenteditable
    try {
      if (entry.range && entry.range.startContainer && entry.range.startContainer.isConnected) {
        const range = entry.range;
        if (range.toString().length > 0 || entry.length > 0) {
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
          const deleted = range.toString();
          range.deleteContents();
          dispatchInput(host, '', 'deleteContentBackward');
          return { ok: true, mode: 'range', removed: deleted };
        }
      }
      if (Array.isArray(entry.nodes)) {
        for (const node of entry.nodes) {
          if (node && node.parentNode) node.parentNode.removeChild(node);
        }
        dispatchInput(host, '', 'deleteContentBackward');
        return { ok: true, mode: 'nodes', removed: entry.text || '' };
      }
    } catch (err) {
      VT.log('warn', 'delete-last-failed', String(err));
    }
    return { ok: false, reason: 'unsupported' };
  }

  function clearAll(host) {
    if (!host) return { ok: false, reason: 'no-host' };
    focusHost(host);
    if (isNativeInput(host)) {
      setNativeValue(host, '');
      try { host.setSelectionRange(0, 0); } catch { /* noop */ }
      dispatchInput(host, '', 'deleteContentBackward');
      return { ok: true, mode: 'native' };
    }
    try {
      const range = document.createRange();
      range.selectNodeContents(host);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      range.deleteContents();
      const caret = document.createRange();
      caret.selectNodeContents(host);
      caret.collapse(true);
      if (sel) { sel.removeAllRanges(); sel.addRange(caret); }
      dispatchInput(host, '', 'deleteContentBackward');
      return { ok: true, mode: 'range' };
    } catch (err) {
      return { ok: false, reason: 'unsupported' };
    }
  }

  /* ------------------------------- clipboard / history ------------------------------- */

  async function copyText(host, fallbackText) {
    let text = '';
    try {
      if (isNativeInput(host) && typeof host.selectionStart === 'number') {
        text = host.value.slice(host.selectionStart, host.selectionEnd);
      } else if (host && host.isContentEditable) {
        const sel = window.getSelection();
        text = sel ? sel.toString() : '';
      }
    } catch { /* noop */ }
    if (!text && fallbackText) text = fallbackText;
    if (!text) return { ok: false, reason: 'nothing-to-copy' };
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, text };
    } catch {
      // clipboard API can be blocked by permissions policy — fall back to execCommand
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return { ok, text, mode: 'execCommand' };
      } catch (err) {
        return { ok: false, reason: 'clipboard-blocked' };
      }
    }
  }

  async function pasteText(host) {
    if (!host) return { ok: false, reason: 'no-host' };
    focusHost(host);
    try {
      const ok = document.execCommand('paste');
      if (ok) return { ok: true, mode: 'execCommand' };
    } catch { /* noop */ }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return { ok: false, reason: 'clipboard-empty' };
      return insertText(host, text);
    } catch {
      return { ok: false, reason: 'clipboard-blocked' };
    }
  }

  function execHistory(op) {
    try {
      const ok = document.execCommand(op === 'redo' ? 'redo' : 'undo');
      return { ok, mode: 'execCommand' };
    } catch {
      return { ok: false, reason: 'unsupported' };
    }
  }

  function selectAll(host) {
    if (!host) return { ok: false, reason: 'no-host' };
    focusHost(host);
    if (isNativeInput(host)) {
      try { host.setSelectionRange(0, host.value.length); return { ok: true }; } catch { /* noop */ }
    }
    try {
      const range = document.createRange();
      range.selectNodeContents(host);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /* ------------------------------- ops ------------------------------- */

  /**
   * Apply the ordered ops produced by the pipeline.
   * @returns {Promise<{ok:boolean, applied:number, results:Array, host:Element|null}>}
   */
  async function applyOps(ops, options = {}) {
    const results = [];
    let host = options.host || VT.tracker?.resolveHost() || null;
    let applied = 0;
    let focused = false;

    for (const op of ops || []) {
      if (!op || typeof op !== 'object') continue;
      if (!focused && host) { focusHost(host); focused = true; }
      let result = { ok: false, reason: 'unknown-op' };

      switch (op.type) {
        case 'text':
          if (!host) { host = VT.tracker?.resolveHost(); if (host) { focusHost(host); focused = true; } }
          result = insertText(host, op.value);
          break;
        case 'key':
          if (op.key === 'Enter') result = insertNewline(host, op.count || 1);
          else if (op.key === 'Tab') result = insertIndent(host, 4);
          else if (op.key === 'Backspace') result = backspace(host, op.count || 1);
          else result = { ok: false, reason: 'unsupported-key' };
          break;
        case 'edit':
          result = op.op === 'clearAll' ? clearAll(host) : deleteLast();
          break;
        case 'clipboard':
          if (op.op === 'copy') result = await copyText(host, options.fallbackText);
          else if (op.op === 'paste') result = await pasteText(host);
          else if (op.op === 'selectAll') result = selectAll(host);
          else result = execHistory(op.op);
          break;
        case 'control':
          VT.bridge?.send({ type: 'toggle-dictation', reason: 'voice-command-stop' });
          result = { ok: true, mode: 'control' };
          break;
        default:
          result = { ok: false, reason: 'unknown-op' };
      }

      if (result && result.ok !== false) applied += 1;
      results.push({ op, result });
    }

    return { ok: applied > 0, applied, results, host };
  }

  VT.inserter = {
    isNativeInput,
    isEditableHost,
    insertText,
    insertNewline,
    insertIndent,
    backspace,
    deleteLast,
    clearAll,
    copyText,
    pasteText,
    execHistory,
    selectAll,
    applyOps,
    journal: () => VT.journal,
    pruneJournal
  };
}(window.__VOICETYPE__));
