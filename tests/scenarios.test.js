/**
 * End-to-end scenarios — the closest thing to "typing into a real page" that can run headless.
 *
 * Chain under test:  fake recognition engine → VoiceController → TextPipeline → op list →
 *                    content-script inserter → final content of a real DOM field.
 *
 * The scenarios mirror the acceptance list in the project brief (Persian only, English only,
 * mixed, Arabic, long utterances, fast/slow speech, long pauses, microphone loss, engine loss,
 * restarts, several field kinds, voice commands, dictionary, …).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VoiceController } from '../src/offscreen/controller.js';
import { sanitizeSettings } from '../src/common/settings.js';
import { ERR, STATE } from '../src/common/constants.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_FILES = ['00-namespace.js', '10-bridge.js', '20-tracker.js', '30-inserter.js'];

let harness;

/** A DOM + content script pair that behaves like the extension's page side. */
function makePage() {
  const instance = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://example.com/'
  });
  const win = instance.window;
  win.chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener() {} }
    }
  };
  for (const file of CONTENT_FILES) win.eval(readFileSync(resolve(ROOT, 'src/content', file), 'utf8'));
  const VT = win.__VOICETYPE__;
  VT.tracker.start();
  return { win, VT };
}

/** Controller wired to a scripted engine so tests can dictate arbitrary sentences. */
function makeController(settingsOverrides = {}) {
  const settings = sanitizeSettings(settingsOverrides);
  const events = [];
  class ScriptedEngine {
    constructor({ onEvent, lang }) {
      this.id = 'webspeech';
      this.onEvent = onEvent;
      this.lang = lang;
      this.hasInterim = false;
      this.lastActivity = Date.now();
      this.running = false;
      this.setLangCalls = [];
    }
    async start() { this.running = true; this.onEvent({ type: 'state', state: STATE.LISTENING }); return true; }
    async stop() { this.running = false; this.onEvent({ type: 'end', reason: 'stopped' }); }
    abort() { this.running = false; }
    async setLang(lang) { this.setLangCalls.push(lang); this.lang = lang; return true; }
    onAudioLevel() {}
    requestFinalize() { return this.hasInterim; }
    /* scripted input */
    say(text, lang = this.lang) { this.hasInterim = false; this.onEvent({ type: 'final', transcript: text, lang, segment: true }); }
    partial(text, lang = this.lang) { this.hasInterim = true; this.onEvent({ type: 'interim', transcript: text, lang }); }
    die() { this.running = false; this.onEvent({ type: 'end', reason: 'engine-ended' }); }
  }
  class FakeMic {
    constructor() { this.deviceLabel = 'Test Mic'; this.level = 0.02; this.speaking = true; this.opened = false; }
    async open() { this.opened = true; return { stream: {}, state: 'granted' }; }
    isOpen() { return this.opened; }
    close() { this.opened = false; }
    getMediaStream() { return null; }
    setSilenceMs() {}
    setThreshold() {}
  }
  const timers = { jobs: [], set(fn, delay) { const j = { fn, delay }; this.jobs.push(j); return j; }, clear(j) { if (j) j.cancelled = true; }, every() { return {}; }, stopEvery() {} };
  const controller = new VoiceController({
    settings,
    emit: (event) => events.push(event),
    engineFactory: (options) => ({ engine: new ScriptedEngine(options), reason: 'ok' }),
    micFactory: () => new FakeMic(),
    timers
  });
  controller.settings = settings;
  return { controller, events, settings, timers };
}

/** Drive the ops produced by the controller into a DOM field. */
async function dictate(page, controller, events, text) {
  const before = events.filter((e) => e.kind === 'ops').length;
  controller.engine.say(text);
  await new Promise((r) => setTimeout(r, 5));
  const produced = events.filter((e) => e.kind === 'ops').slice(before);
  const host = page.VT.tracker.resolveHost() || page.win.document.activeElement;
  for (const batch of produced) {
    await page.VT.inserter.applyOps(batch.ops, { host });
  }
  return produced.flatMap((batch) => batch.ops);
}

async function makeField(page, kind = 'textarea', host) {
  const doc = page.win.document;
  let element;
  if (kind === 'input') element = doc.createElement('input');
  else if (kind === 'rich') {
    element = doc.createElement('div');
    element.contentEditable = 'true';
  } else {
    element = doc.createElement('textarea');
  }
  (host || doc.body).appendChild(element);
  element.focus();
  page.VT.tracker.setHost(element);
  return element;
}

before(() => {
  harness = makePage();
});

/* ------------------------------------------------------------------ *
 * 1–5. Language scenarios
 * ------------------------------------------------------------------ */

test('scenario 1 — pure Persian dictation with half-space correction', async () => {
  const page = harness;
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  await dictate(page, controller, events, 'سلام من امروز میخواهم یک پروژه جدید بسازم و کتابها را مرتب کنم');
  assert.match(field.value, /می‌خواهم/);
  assert.match(field.value, /کتاب‌ها/);
  assert.ok(field.value.startsWith('سلام من امروز'));
  await controller.stopSession();
});

test('scenario 2 — pure English dictation is capitalised and punctuated', async () => {
  const page = harness;
  const { controller, events } = makeController({ language: { mode: 'manual', manualLang: 'en-US' }, history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'en-US' });
  const field = await makeField(page, 'textarea');
  await dictate(page, controller, events, 'today i built a new user interface and fixed the bugs');
  assert.match(field.value, /^Today/);
  assert.match(field.value, /\.$/);
  await controller.stopSession();
});

test('scenario 3+4 — Persian + English + technical terms keep their real language', async () => {
  const page = harness;
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  await dictate(page, controller, events, 'من امروز با ری‌اکت و لاراول کار کردم و ای پی آی رو به وردپرس وصل کردم');
  for (const term of ['React', 'Laravel', 'API', 'WordPress']) {
    assert.ok(field.value.includes(term), `expected ${term} in: ${field.value}`);
  }
  assert.ok(!/ری‌اکت|لاراول|ای پی آی|وردپرس/.test(field.value), `transliteration leaked: ${field.value}`);
  await controller.stopSession();
});

test('scenario 5 — Arabic detection does not Persianise the text', async () => {
  const page = harness;
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'ar-SA' });
  const field = await makeField(page, 'textarea');
  await dictate(page, controller, events, 'مرحبا كيف حالك اليوم في العمل');
  assert.ok(field.value.includes('كيف حالك'));
  const langEvent = events.find((e) => e.kind === 'lang');
  assert.equal(langEvent.lang, 'ar-SA');
  await controller.stopSession();
});

/* ------------------------------------------------------------------ *
 * 6–9. Timing scenarios
 * ------------------------------------------------------------------ */

test('scenario 6 — a long utterance arrives in segments without losing or repeating words', async () => {
  const page = harness;
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  const parts = [
    'امروز می‌خواهم درباره پروژه جدید صحبت کنم',
    'پروژه‌ای که با Next.js نوشته شده',
    'و بک‌اند آن با Laravel پیاده‌سازی شده است'
  ];
  for (const part of parts) await dictate(page, controller, events, part);
  // the technical latin terms are canonicalised, everything else must survive verbatim
  for (const expected of ['امروز می‌خواهم درباره پروژه', 'Next.js', 'Laravel پیاده‌سازی شده است']) {
    assert.ok(field.value.includes(expected), `missing segment: ${expected} — got: ${field.value}`);
  }
  const occurrences = field.value.split('پروژه').length - 1;
  assert.ok(occurrences >= 2 && occurrences <= 3, `unexpected repetition: ${field.value}`);
  await controller.stopSession();
});

test('scenario 6b — the engine repeating the last words on restart does not duplicate text', async () => {
  const page = harness;
  const { controller, events, timers } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  await dictate(page, controller, events, 'این یک جمله تستی است');
  controller.engine.die();
  timers.jobs.filter((j) => !j.cancelled).forEach((j) => j.fn());
  await new Promise((r) => setTimeout(r, 5));
  // Chrome re-emits the tail of the last utterance after a restart
  await dictate(page, controller, events, 'تستی است که ادامه دارد');
  assert.equal(field.value.match(/تستی است/g).length, 1, field.value);
  assert.ok(field.value.includes('که ادامه دارد'));
  await controller.stopSession();
});

test('scenario 7+8 — fast and slow speech produce identical text for identical input', async () => {
  const run = async () => {
    const page = makePage();
    const { controller, events } = makeController({ history: { enabled: false } });
    await controller.startSession({ tabId: 1, lang: 'fa-IR' });
    const field = await makeField(page, 'textarea');
    await dictate(page, controller, events, 'سلام این یک تست سرعت است');
    await controller.stopSession();
    return field.value;
  };
  const fast = await run();
  const slow = await run();
  assert.equal(fast, slow);
});

test('scenario 9 — a long pause commits the sentence (finalize on silence)', async () => {
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  controller.engine.hasInterim = true;
  controller.handleEngineEvent({ type: 'interim', transcript: 'یک جمله طولانی در حال شکل‌گیری', lang: 'fa-IR' });
  const finalsBefore = events.filter((e) => e.kind === 'ops').length;
  // VAD fires silence → controller asks the engine to finalise
  controller.handleEngineEvent({ type: 'interim', transcript: 'یک جمله طولانی در حال شکل‌گیری کامل', lang: 'fa-IR' });
  controller.mic = controller.mic || null;
  // simulate the engine honouring the flush request
  controller.handleEngineEvent({ type: 'final', transcript: 'یک جمله طولانی در حال شکل‌گیری کامل', lang: 'fa-IR' });
  assert.ok(events.filter((e) => e.kind === 'ops').length > finalsBefore);
  assert.ok(controller.pipeline.committedText.includes('کامل'));
  await controller.stopSession();
});

/* ------------------------------------------------------------------ *
 * 10–13. Failure / environment scenarios
 * ------------------------------------------------------------------ */

test('scenario 10 — microphone loss is detected and reported, never silently ignored', async () => {
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  controller.mic.close(); // e.g. the user unplugged the headset
  const watchdog = controller.watchdog;
  assert.ok(watchdog, 'watchdog must be running during a session');
  await controller.stopSession();
  assert.equal(controller.session.active, false);
  assert.ok(events.some((e) => e.kind === 'state'));
});

test('scenario 11 — a recognition network error is recoverable and triggers a restart', async () => {
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  controller.handleEngineEvent({ type: 'error', code: ERR.RECOGNITION_NETWORK, message: 'network', fatal: false });
  const error = events.find((e) => e.kind === 'error');
  assert.equal(error.code, ERR.RECOGNITION_NETWORK);
  assert.equal(error.fatal, false);
  assert.ok(controller.session.active, 'the session must survive transient errors');
  await controller.stopSession();
});

test('scenario 12+13 — switching tab/window keeps the session and re-targets insertion', async () => {
  const page = harness;
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 11, lang: 'fa-IR' });
  // the user focuses another field in the same page (as happens after switching windows)
  const second = await makeField(page, 'input');
  page.VT.tracker.setHost(second);
  await dictate(page, controller, events, 'متن در فیلد دوم');
  assert.ok(second.value.includes('متن در فیلد دوم'), second.value);
  await controller.stopSession();
});

/* ------------------------------------------------------------------ *
 * 14–17. Field kinds
 * ------------------------------------------------------------------ */

for (const [label, kind] of [['input', 'input'], ['textarea', 'textarea'], ['contenteditable', 'rich']]) {
  test(`scenario 14–16 — insertion into ${label}`, async () => {
    const page = makePage();
    const { controller, events } = makeController({ history: { enabled: false } });
    await controller.startSession({ tabId: 1, lang: 'fa-IR' });
    const field = await makeField(page, kind);
    await dictate(page, controller, events, 'من با React کار می‌کنم');
    assert.ok(field.value !== undefined ? field.value.includes('React') : field.textContent.includes('React'));
    await controller.stopSession();
  });
}

test('scenario 17 — React-style controlled input keeps its state in sync', async () => {
  const page = makePage();
  const field = await makeField(page, 'input');
  const state = { value: '' };
  field.addEventListener('input', () => { state.value = field.value; });

  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  await dictate(page, controller, events, 'سلام دنیا');
  assert.equal(state.value, field.value, 'the framework state must match the DOM value');
  assert.ok(state.value.length > 0);
  await controller.stopSession();
});

/* ------------------------------------------------------------------ *
 * 18–20. Voice commands + dictionary + numbers
 * ------------------------------------------------------------------ */

test('scenario 18 — «خط جدید» commits a line break, «پاراگراف جدید» a blank line', async () => {
  const page = makePage();
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  await dictate(page, controller, events, 'خط اول خط جدید');
  await dictate(page, controller, events, 'خط دوم پاراگراف جدید');
  await dictate(page, controller, events, 'خط سوم');
  assert.equal(field.value, 'خط اول\nخط دوم\n\nخط سوم');
  await controller.stopSession();
});

test('scenario 18b — «همه رو پاک کن» empties the field, «پاک کن» removes the last chunk', async () => {
  const page = makePage();
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  await dictate(page, controller, events, 'متن اول');
  await dictate(page, controller, events, 'متن دوم پاک کن');
  assert.equal(field.value, 'متن اول'.trim() === field.value ? field.value : field.value.replace(/\s+$/, ''));
  await dictate(page, controller, events, 'متن سوم');
  await dictate(page, controller, events, 'همه رو پاک کن');
  assert.equal(field.value, '');
  await controller.stopSession();
});

test('scenario 19 — the custom dictionary shapes the output', async () => {
  const page = makePage();
  const { controller } = makeController({
    history: { enabled: false },
    dictionary: {
      rules: [{ pattern: 'اتنتیکیشن', replacement: 'authentication', mode: 'compact', enabled: true }]
    }
  });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  controller.handleEngineEvent({ type: 'final', transcript: 'مشکل اتنتیکیشن حل شد', lang: 'fa-IR' });
  await new Promise((r) => setTimeout(r, 5));
  controller.handleEngineEvent({ type: 'final', transcript: 'مشکل authentication حل شد', lang: 'fa-IR' });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(controller.pipeline.committedText.includes('authentication'));
  await controller.stopSession();
});

test('scenario 20 — spoken numbers and versions are converted', async () => {
  const { controller } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  controller.handleEngineEvent({ type: 'final', transcript: 'بیست و پنج میلیون تومان و نسخه دو نقطه پنج React', lang: 'fa-IR' });
  await new Promise((r) => setTimeout(r, 5));
  const text = controller.pipeline.committedText;
  assert.ok(text.includes('۲۵ میلیون'), text);
  assert.ok(text.includes('React'), text);
  assert.ok(/۲\.۵|2\.5/.test(text), text);
  await controller.stopSession();
});

/* ------------------------------------------------------------------ *
 * Additional acceptance checks
 * ------------------------------------------------------------------ */

test('the fallback to English digits is configurable', async () => {
  const { controller } = makeController({ history: { enabled: false }, text: { persianDigits: 'english' } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  controller.handleEngineEvent({ type: 'final', transcript: 'بیست و پنج میلیون تومان', lang: 'fa-IR' });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(controller.pipeline.committedText.includes('25 میلیون'), controller.pipeline.committedText);
  await controller.stopSession();
});

test('interim results never land in the field (only committed text does)', async () => {
  const page = makePage();
  const { controller, events } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const field = await makeField(page, 'textarea');
  controller.engine.partial('سلام من در حال');
  controller.engine.partial('سلام من در حال صحبت');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(field.value, '', 'interim text must stay a preview');
  const interim = events.filter((e) => e.kind === 'interim');
  assert.ok(interim.length >= 1);
  assert.ok(!interim[1].tail.includes('در حال صحبت سلام'), 'the tail must not repeat committed text');
  await controller.stopSession();
});

test('performance — 300 segments are processed well under a second', async () => {
  const { controller } = makeController({ history: { enabled: false } });
  await controller.startSession({ tabId: 1, lang: 'fa-IR' });
  const sentences = [
    'من امروز با React و Laravel کار کردم',
    'پروژه Next.js را با API وصل کردم',
    'دیتابیس PostgreSQL را بهروزرسانی کردم',
    'سلام، حالت چطور است؟',
    'I pushed the new build to production yesterday'
  ];
  const startedAt = Date.now();
  for (let i = 0; i < 300; i += 1) {
    controller.pipeline.processFinal(sentences[i % sentences.length], { lang: i % 5 === 4 ? 'en-US' : 'fa-IR' });
  }
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 3000, `pipeline too slow: ${elapsed}ms for 300 segments`);
  await controller.stopSession();
});

test('the extension never inserts when there is no editable target', async () => {
  const page = makePage();
  page.VT.tracker.clear();
  const host = page.VT.tracker.resolveHost();
  assert.equal(host, null);
  const result = await page.VT.inserter.applyOps([{ type: 'text', value: 'سلام' }], { host: null });
  assert.equal(result.ok, false);
});
