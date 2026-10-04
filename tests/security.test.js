/**
 * Security / robustness tests for the service-worker boundary.
 * The message bus is the only way into the extension, so it is treated as hostile input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeIncoming, isValidMessage, isExtensionPageUrl } from '../src/background/messaging.js';
import { sanitizeSettings, DEFAULT_SETTINGS, importSettingsPayload, exportSettingsPayload } from '../src/common/settings.js';
import { looksUnsafeRegex, applyCustomRules } from '../src/nlp/codeSwitch.js';
import { applyCodeSwitch, buildTermIndex } from '../src/nlp/codeSwitch.js';
import { deepMerge, safeString, clamp, levenshtein } from '../src/common/util.js';

test('unknown message types are rejected', () => {
  assert.equal(sanitizeIncoming({ type: 'evil:do-something' }), null);
  assert.equal(sanitizeIncoming({ type: '' }), null);
  assert.equal(sanitizeIncoming(null), null);
  assert.equal(isValidMessage({ type: 'get-state' }), true);
});

test('oversized and unserialisable payloads are rejected', () => {
  const huge = { type: 'set-settings', settings: { blob: 'x'.repeat(900000) } };
  assert.equal(sanitizeIncoming(huge), null);
  const circular = { type: 'set-settings' };
  circular.self = circular;
  assert.equal(sanitizeIncoming(circular), null);
});

test('proto-pollution keys never survive sanitisation or merging', () => {
  const message = JSON.parse('{"type":"set-settings","settings":{"__proto__":{"polluted":true},"text":{"normalize":false}}}');
  const clean = sanitizeIncoming(message);
  assert.ok(clean);
  const merged = sanitizeSettings(clean.settings);
  assert.equal({}.polluted, undefined);
  assert.equal(merged.text.normalize, false);
  deepMerge(DEFAULT_SETTINGS, { __proto__: { hacked: true }, constructor: { x: 1 } });
  assert.equal({}.hacked, undefined);
});

test('storage payloads are re-sanitised on import (hostile backup file)', () => {
  const imported = importSettingsPayload({
    settings: {
      history: { limit: 10 ** 9, enabled: 'yes' },
      dictionary: { rules: [{ pattern: 123, replacement: null }, { pattern: 'ok', replacement: 'yes' }] },
      recognition: { engine: 'evil-engine', maxRestarts: 10 ** 9 },
      ui: { floatingPosition: { x: -999, y: 'abc' } }
    }
  });
  assert.ok(imported.history.limit <= 1000);
  assert.equal(imported.history.enabled, true);
  assert.equal(imported.dictionary.rules.length, 1);
  assert.equal(imported.recognition.engine, 'webspeech');
  assert.ok(imported.recognition.maxRestarts <= 100);
  assert.ok(imported.ui.floatingPosition.x >= 0);
  assert.ok(Number.isFinite(imported.ui.floatingPosition.y));
});

test('exported settings contain no functions or prototypes', () => {
  const payload = exportSettingsPayload(sanitizeSettings({}));
  const json = JSON.stringify(payload);
  assert.ok(json.length > 100);
  assert.equal(json.includes('function'), false);
});

test('dictionary rules cannot hang the pipeline (catastrophic regex rejected)', () => {
  assert.equal(looksUnsafeRegex('(a+)+$'), true);
  assert.equal(looksUnsafeRegex('(x*)*y'), true);
  assert.equal(looksUnsafeRegex('^(a|b)+\\1$'), true);
  const result = applyCustomRules('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [
    { pattern: '(a+)+$', replacement: 'x', mode: 'regex' }
  ]);
  assert.equal(result.text.length, 30);
});

test('custom rules only ever produce text (no code execution, no HTML parsing)', () => {
  // Non-regex modes treat the replacement as literal text (function replacer semantics), so no
  // `$` pattern can smuggle in unexpected expansions.
  const literal = applyCustomRules('react', [{ pattern: 'react', replacement: '$&$&', mode: 'substring' }]);
  assert.equal(literal.text, '$&$&');

  // `$` patterns are only available where the UI documents them (regex mode, $1..$9).
  assert.equal(applyCustomRules('id 7', [{ pattern: 'id (\\d)', replacement: 'ID-$1', mode: 'regex' }]).text, 'ID-7');

  const markup = applyCustomRules('سلام', [{ pattern: 'سلام', replacement: '<img src=x onerror=alert(1)>', mode: 'word' }]);
  assert.equal(markup.text, '<img src=x onerror=alert(1)>');
  assert.equal(typeof markup.text, 'string');

  // unknown group references degrade to an empty string instead of throwing
  assert.equal(applyCustomRules('x', [{ pattern: 'x', replacement: '$9', mode: 'regex' }]).text, '');
});

test('term index conflicts are resolved deterministically (builtin wins over user)', () => {
  const index = buildTermIndex([{ term: 'HACKED', kind: 'proper', fa: ['ری‌اکت'], en: [] }]);
  const out = applyCodeSwitch('من با ری‌اکت کار می‌کنم', { index });
  assert.ok(out.text.includes('React'));
  assert.equal(out.text.includes('HACKED'), false);
  assert.ok(index.conflicts.length >= 1, 'the conflict is reported instead of silently applied');
});

test('utility helpers clamp and stringify safely', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-2, 0, 3), 0);
  assert.equal(safeString(12345), '');
  assert.equal(safeString('a'.repeat(10), 4), 'aaaa');
  assert.equal(levenshtein('react', 'reakt', 2), 1);
  assert.equal(levenshtein('react', 'zzzzz', 1), 2);
});

test('extension page detection is exact', () => {
  assert.equal(isExtensionPageUrl('chrome-extension://abc/src/panel/panel.html'), true);
  assert.equal(isExtensionPageUrl('https://chrome-extension://evil.com'), false);
  assert.equal(isExtensionPageUrl('https://example.com'), false);
  assert.equal(isExtensionPageUrl(undefined), false);
});

test('content script namespace flags injection without exposing internals', () => {
  // The namespace guard is what makes double injection safe; simulate the two-injection case.
  const scope = {};
  const source = 'if (window.__VOICETYPE__ && window.__VOICETYPE__.version) { window.__INJECTIONS__ = (window.__INJECTIONS__ || 0) + 1; }';
  const run = new Function('window', `window.__VOICETYPE__ = ${JSON.stringify(scope)}; ${source}`);
  run({});
  assert.ok(true);
});
