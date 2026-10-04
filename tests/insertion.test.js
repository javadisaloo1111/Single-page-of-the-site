/**
 * DOM integration tests for the content-script insertion engine.
 *
 * The jsdom environment reproduces the tricky cases from the brief:
 *   - React-controlled <input> (native value setter + InputEvent, not a silent assignment),
 *   - <textarea> with the caret in the middle,
 *   - plain contenteditable and rich-editor style contenteditable (execCommand fallback),
 *   - document.execCommand unavailable (Google-Docs-like environments),
 *   - selection replacement, undo of the last insertion and clear-all,
 *   - voice-command op dispatch (Enter ×2, Tab, copy, paste, undo).
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['00-namespace.js', '10-bridge.js', '20-tracker.js', '30-inserter.js', '40-hotkeys.js'];

let window;
let VT;

function loadContentScripts(win) {
  for (const file of FILES) {
    const code = readFileSync(resolve(ROOT, 'src/content', file), 'utf8');
    win.eval(code);
  }
  return win.__VOICETYPE__;
}

function makeDom({ execCommand = true } = {}) {
  const instance = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://example.com/'
  });
  const win = instance.window;
  if (!execCommand) {
    // simulate an environment where execCommand is unavailable (e.g. hardened editors)
    win.document.execCommand = undefined;
  }
  return { instance, win, VT: loadContentScripts(win) };
}

before(() => {
  const made = makeDom();
  window = made.win;
  VT = made.VT;
  VT.tracker.start(); // normally called by 99-main.js
});

beforeEach(() => {
  // A minimal chrome stub so the bridge can "send" messages without a real extension context.
  const sent = [];
  window.chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage: async (message) => { sent.push(message); return { ok: true }; },
      onMessage: { addListener() {} }
    }
  };
  window.__VOICETYPE__.sent = sent;
});

/* ---------------------------------- inputs ---------------------------------- */

test('inserts into an <input> at the caret and keeps the caret after the text', () => {
  const input = window.document.createElement('input');
  input.value = 'Hello world';
  window.document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(6, 11); // select "world"

  const res = VT.inserter.insertText(input, 'سلام');
  assert.equal(res.ok, true);
  assert.equal(input.value, 'Hello سلام');
  assert.equal(input.selectionStart, input.value.length);
  assert.equal(input.selectionEnd, input.value.length);
});

test('a React-controlled input receives a proper input event and keeps its state in sync', () => {
  const input = window.document.createElement('input');
  window.document.body.appendChild(input);

  // emulate React's value tracker: React stores the last value it rendered and skips
  // onChange when the assigned value equals the tracked one (the "silent assignment" trap).
  const tracker = { value: '' };
  Object.defineProperty(input, '_valueTracker', {
    value: { getValue: () => tracker.value, setValue: (v) => { tracker.value = v; } }
  });
  const events = [];
  input.addEventListener('input', (event) => {
    tracker.value = input.value;
    events.push({ type: event.type, inputType: event.inputType, data: event.data, value: input.value });
  });

  const res = VT.inserter.insertText(input, 'سلام دنیا');
  assert.equal(res.ok, true);
  assert.equal(input.value, 'سلام دنیا');
  assert.equal(events.length, 1, 'exactly one input event must be dispatched');
  assert.equal(events[0].inputType, 'insertText');
  assert.equal(events[0].data, 'سلام دنیا');
  assert.equal(tracker.value, 'سلام دنیا', 'the framework value tracker sees the new value');
});

test('textarea keeps multi-line text and reports the new caret position', () => {
  const area = window.document.createElement('textarea');
  area.value = 'first line\nsecond line';
  window.document.body.appendChild(area);
  area.focus();
  area.setSelectionRange(11, 11); // right after "first line\n"

  VT.inserter.insertText(area, 'میانی');
  assert.equal(area.value, 'first line\nمیانیsecond line');
  assert.equal(area.selectionStart, 'first line\nمیانی'.length);
});

test('a newline op is ignored for single-line inputs and inserted for textareas', () => {
  const input = window.document.createElement('input');
  window.document.body.appendChild(input);
  input.focus();
  const ignored = VT.inserter.insertNewline(input, 1);
  assert.equal(ignored.mode, 'noop');
  assert.equal(input.value, '');

  const area = window.document.createElement('textarea');
  window.document.body.appendChild(area);
  area.focus();
  VT.inserter.insertText(area, 'پاراگراف');
  VT.inserter.insertNewline(area, 2);
  assert.equal(area.value, 'پاراگراف\n\n');
});

/* ---------------------------------- contenteditable ---------------------------------- */

test('inserts into a plain contenteditable and places the caret after the text', () => {
  const div = window.document.createElement('div');
  div.contentEditable = 'true';
  div.textContent = 'متن اول ';
  window.document.body.appendChild(div);
  div.focus();

  const range = window.document.createRange();
  range.selectNodeContents(div);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const res = VT.inserter.insertText(div, 'دوم');
  assert.equal(res.ok, true);
  assert.ok(div.textContent.includes('دوم'));
  assert.ok(div.textContent.startsWith('متن اول'));
});

test('multi-line insertion into contenteditable falls back to range surgery', () => {
  const div = window.document.createElement('div');
  div.contentEditable = 'true';
  div.textContent = 'خط اول';
  window.document.body.appendChild(div);
  div.focus();
  const range = window.document.createRange();
  range.selectNodeContents(div);
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const res = VT.inserter.insertText(div, '\nخط دوم');
  assert.equal(res.ok, true);
  assert.ok(div.querySelectorAll('br').length >= 1, 'line break must be materialised as <br>');
  assert.ok(div.textContent.includes('خط دوم'));
});

test('contenteditable insertion works without document.execCommand (rich editors)', () => {
  const isolated = makeDom({ execCommand: false });
  const win = isolated.win;
  win.chrome = { runtime: { id: 't', sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } } };
  const vt = isolated.VT;

  const div = win.document.createElement('div');
  div.contentEditable = 'true';
  win.document.body.appendChild(div);
  div.focus();

  const res = vt.inserter.insertText(div, 'fallback');
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'range');
  assert.ok(div.textContent.includes('fallback'));
});

/* ---------------------------------- journal based editing ---------------------------------- */

test('deleteLast removes exactly the last inserted chunk', () => {
  const input = window.document.createElement('input');
  window.document.body.appendChild(input);
  input.focus();
  VT.inserter.insertText(input, 'سلام ');
  VT.inserter.insertText(input, 'دنیا');
  assert.equal(input.value, 'سلام دنیا');

  const res = VT.inserter.deleteLast();
  assert.equal(res.ok, true);
  assert.equal(input.value, 'سلام ');
  VT.inserter.deleteLast();
  assert.equal(input.value, '');
});

test('clearAll empties the whole field', () => {
  const area = window.document.createElement('textarea');
  area.value = 'some text';
  window.document.body.appendChild(area);
  const res = VT.inserter.clearAll(area);
  assert.equal(res.ok, true);
  assert.equal(area.value, '');
});

test('clearAll works on contenteditable', () => {
  const div = window.document.createElement('div');
  div.contentEditable = 'true';
  div.textContent = 'محتوای طولانی';
  window.document.body.appendChild(div);
  VT.inserter.clearAll(div);
  assert.equal(div.textContent, '');
});

/* ---------------------------------- op dispatch ---------------------------------- */

test('applyOps executes the pipeline output in order', async () => {
  const host = window.document.createElement('textarea');
  window.document.body.appendChild(host);
  host.focus();
  VT.tracker.setHost(host);

  const result = await VT.inserter.applyOps([
    { type: 'text', value: 'سلام' },
    { type: 'text', value: '، ' },
    { type: 'text', value: 'دنیا' },
    { type: 'key', key: 'Enter', count: 2 }
  ], { host });

  assert.equal(result.ok, true);
  assert.equal(result.applied, 4);
  assert.equal(host.value, 'سلام، دنیا\n\n');
});

test('the paragraph command inserts exactly one blank line', async () => {
  const host = window.document.createElement('textarea');
  window.document.body.appendChild(host);
  VT.tracker.setHost(host);
  await VT.inserter.applyOps([{ type: 'key', key: 'Enter', count: 2 }], { host });
  assert.equal(host.value, '\n\n');
});

test('the tab command inserts an indent, not a focus jump', async () => {
  const host = window.document.createElement('textarea');
  window.document.body.appendChild(host);
  const result = await VT.inserter.applyOps([{ type: 'key', key: 'Tab' }], { host });
  assert.equal(result.ok, true);
  assert.equal(host.value, '    ');
});

test('clipboard ops never throw when the clipboard API is blocked', async () => {
  const host = window.document.createElement('textarea');
  host.value = 'متن';
  host.setSelectionRange(0, 4);
  window.document.body.appendChild(host);
  const result = await VT.inserter.copyText(host, 'fallback');
  assert.equal(typeof result.ok, 'boolean');
});

test('the stop-dictation command is forwarded to the background', async () => {
  const result = await VT.inserter.applyOps([{ type: 'control', op: 'stop' }], { host: null });
  assert.equal(result.ok, true);
  const forwarded = window.__VOICETYPE__.sent.find((m) => m.type === 'toggle-dictation');
  assert.ok(forwarded, 'toggle-dictation must be sent to the background');
});

/* ---------------------------------- tracker ---------------------------------- */

test('the tracker follows focus and finds the enclosing editable', () => {
  const wrapper = window.document.createElement('div');
  const input = window.document.createElement('input');
  wrapper.appendChild(input);
  window.document.body.appendChild(wrapper);

  input.focus();
  input.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.equal(VT.tracker.host, input);

  const found = VT.tracker.closestEditable(input);
  assert.equal(found, input);
});

test('non-editable elements are never selected as a target', () => {
  const div = window.document.createElement('div');
  window.document.body.appendChild(div);
  assert.equal(VT.tracker.closestEditable(div), null);
  assert.equal(VT.inserter.isEditableHost(div), false);
});

test('checkbox inputs are not treated as text targets', () => {
  const checkbox = window.document.createElement('input');
  checkbox.type = 'checkbox';
  window.document.body.appendChild(checkbox);
  assert.equal(VT.inserter.isEditableHost(checkbox), false);
});

/* ---------------------------------- hotkeys ---------------------------------- */

test('hotkey combo detection is stable across layouts', () => {
  const event = { ctrlKey: false, altKey: true, shiftKey: true, metaKey: false, code: 'Space', key: ' ', repeat: false };
  assert.equal(VT.hotkeys.comboFromEvent(event), 'Alt+Shift+Space');
  const ctrl = { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, code: 'KeyX', key: 'x', repeat: false };
  assert.equal(VT.hotkeys.comboFromEvent(ctrl), 'Ctrl+Shift+X');
});

/* ---------------------------------- security ---------------------------------- */

test('inserted text is treated as text, never as HTML', () => {
  const input = window.document.createElement('input');
  window.document.body.appendChild(input);
  VT.inserter.insertText(input, '<img src=x onerror=alert(1)>');
  assert.equal(input.value, '<img src=x onerror=alert(1)>');
  assert.equal(window.document.querySelectorAll('img').length, 0);
});

test('contenteditable insertion escapes markup', () => {
  const div = window.document.createElement('div');
  div.contentEditable = 'true';
  window.document.body.appendChild(div);
  div.focus();
  VT.inserter.insertText(div, '<script>bad()</script>');
  assert.equal(div.querySelectorAll('script').length, 0);
  assert.ok(div.textContent.includes('<script>'));
});
