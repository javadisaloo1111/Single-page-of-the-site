/**
 * Engine-layer tests: script statistics, dual-engine arbitration, Web Speech error mapping and
 * the VoiceController session state machine (restart, language switching, mic failures).
 * Everything runs with fake engines / fake timers — no browser required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scriptProfile } from '../src/engines/scriptStats.js';
import { arbitrate, scoreCandidate } from '../src/engines/arbitration.js';
import { classifySpeechError, classifyMediaError, stateForError } from '../src/engines/base.js';
import { VoiceController } from '../src/offscreen/controller.js';
import { sanitizeSettings } from '../src/common/settings.js';
import { ERR, STATE } from '../src/common/constants.js';
import { buildVocabularyPrompt, extractText } from '../src/engines/httpWhisperEngine.js';
import { pickDualLangs, createEngine } from '../src/engines/factory.js';

/* ---------------------------------- script stats ---------------------------------- */

test('scriptProfile measures the Persian/Latin mixture', () => {
  const profile = scriptProfile('من با React کار می‌کنم');
  assert.ok(profile.persianRatio > 0.4 && profile.persianRatio < 0.9);
  assert.ok(profile.latinChars >= 5);
  assert.ok(profile.technicalHits >= 1);
});

/* ---------------------------------- arbitration ---------------------------------- */

test('a Persian utterance prefers the Persian-script candidate', () => {
  const candidates = [
    { text: 'من با ری‌اکت کار می‌کنم', lang: 'fa-IR' },
    { text: 'man ba react kar mikonam', lang: 'en-US' }
  ];
  const { winner, expectedLang } = arbitrate(candidates, { detectedLang: 'fa-IR' });
  assert.equal(expectedLang, 'fa-IR');
  assert.equal(winner.lang, 'fa-IR');
});

test('an English utterance prefers the Latin candidate', () => {
  const candidates = [
    { text: 'من با ری‌اکت کار می‌کنم', lang: 'fa-IR' },
    { text: 'I work with React and Next.js every day', lang: 'en-US' }
  ];
  const { winner } = arbitrate(candidates, { detectedLang: 'en-US' });
  assert.equal(winner.lang, 'en-US');
});

test('duplicate candidates collapse and empty ones are ignored', () => {
  const { winner } = arbitrate([
    { text: 'سلام دنیا', lang: 'fa-IR' },
    { text: 'سلام دنیا', lang: 'fa-IR' },
    { text: '   ', lang: 'en-US' }
  ], { detectedLang: 'fa-IR' });
  assert.equal(winner.text, 'سلام دنیا');
});

test('scoreCandidate rejects Latin output for Persian speech', () => {
  const latin = scoreCandidate({ text: 'salam man react kar mikonam', lang: 'en-US' }, 'fa-IR');
  const persian = scoreCandidate({ text: 'سلام من ری‌اکت کار می‌کنم', lang: 'fa-IR' }, 'fa-IR');
  assert.ok(persian > latin);
});

/* ---------------------------------- error mapping ---------------------------------- */

test('speech errors map to stable codes', () => {
  assert.equal(classifySpeechError('not-allowed', 'User denied microphone access'), ERR.MIC_DENIED);
  assert.equal(classifySpeechError('not-allowed', 'service not allowed'), ERR.RECOGNITION_SERVICE);
  assert.equal(classifySpeechError('network'), ERR.RECOGNITION_NETWORK);
  assert.equal(classifySpeechError('no-speech'), ERR.RECOGNITION_NO_SPEECH);
  assert.equal(classifySpeechError('language-not-supported'), ERR.RECOGNITION_LANGUAGE);
  assert.equal(classifySpeechError('weird'), ERR.RECOGNITION_UNKNOWN);
});

test('media errors map to microphone states', () => {
  assert.equal(classifyMediaError({ name: 'NotAllowedError' }), ERR.MIC_DENIED);
  assert.equal(classifyMediaError({ name: 'NotFoundError' }), ERR.MIC_UNAVAILABLE);
  assert.equal(classifyMediaError({ name: 'NotReadableError' }), ERR.MIC_BUSY);
  assert.equal(stateForError(ERR.MIC_DENIED), STATE.MIC_DENIED);
  assert.equal(stateForError(ERR.RECOGNITION_NETWORK), STATE.ERROR);
});

/* ---------------------------------- whisper helpers ---------------------------------- */

test('vocabulary prompt contains the flagship technical terms', () => {
  const prompt = buildVocabularyPrompt(sanitizeSettings({}));
  for (const term of ['React', 'Laravel', 'Next.js', 'API', 'GraphQL']) {
    assert.ok(prompt.includes(term), `prompt missing ${term}`);
  }
  const custom = buildVocabularyPrompt(sanitizeSettings({ dictionary: { terms: [{ term: 'FooBar', kind: 'proper' }] } }));
  assert.ok(custom.includes('FooBar'));
});

test('whisper response extraction understands several server shapes', () => {
  assert.equal(extractText({ text: ' سلام ' }), 'سلام');
  assert.equal(extractText({ segments: [{ text: 'a' }, { text: 'b' }] }), 'a b');
  assert.equal(extractText({ results: [{ text: 'x' }] }), 'x');
  assert.equal(extractText(null), '');
});

/* ---------------------------------- factory ---------------------------------- */

test('dual engine picks Persian + the other candidate', () => {
  assert.deepEqual(pickDualLangs(['en-US', 'fa-IR']), ['fa-IR', 'en-US']);
  assert.deepEqual(pickDualLangs(['de-DE']), ['fa-IR', 'de-DE']);
});

test('factory reports why an engine cannot start', () => {
  const noEndpoint = createEngine({
    settings: sanitizeSettings({ recognition: { engine: 'http-whisper' } }),
    lang: 'fa-IR',
    onEvent: () => {},
    mic: null
  });
  assert.equal(noEndpoint.engine, null);
  assert.equal(noEndpoint.reason, 'no-endpoint');

  const local = createEngine({
    settings: sanitizeSettings({ recognition: { engine: 'local-ai' } }),
    lang: 'fa-IR',
    onEvent: () => {},
    mic: null
  });
  assert.equal(local.reason, 'not-implemented');
});

/* ---------------------------------- controller ---------------------------------- */

/** Deterministic fake engine used to drive the controller through its states. */
function makeFakeEngine({ failStart = false } = {}) {
  return class FakeEngine {
    constructor({ onEvent, lang }) {
      this.id = 'webspeech';
      this.onEvent = onEvent;
      this.lang = lang;
      this.running = false;
      this.hasInterim = false;
      this.lastActivity = Date.now();
      this.stopCalls = 0;
      this.langCalls = [];
      this.capabilities = { id: 'webspeech', streaming: true, interim: true };
    }

    async start() {
      if (failStart) {
        this.onEvent({ type: 'error', code: ERR.UNSUPPORTED, fatal: true, message: 'nope' });
        return false;
      }
      this.running = true;
      this.onEvent({ type: 'state', state: STATE.LISTENING, detail: 'started' });
      return true;
    }

    async stop() { this.stopCalls += 1; this.running = false; this.onEvent({ type: 'end', reason: 'stopped' }); }
    abort() { this.running = false; }
    async setLang(lang) { this.langCalls.push(lang); this.lang = lang; return true; }
    onAudioLevel() {}
    requestFinalize() { return this.hasInterim; }
    async destroy() { this.running = false; }

    /* test helpers */
    emitInterim(text) { this.hasInterim = true; this.onEvent({ type: 'interim', transcript: text, lang: this.lang }); }
    emitFinal(text) { this.hasInterim = false; this.onEvent({ type: 'final', transcript: text, lang: this.lang, segment: true }); }
    endUnexpectedly() { this.running = false; this.onEvent({ type: 'end', reason: 'engine-ended' }); }
  };
}

function makeFakeMic({ fail = null } = {}) {
  return class FakeMic {
    constructor() {
      this.deviceLabel = 'Fake Mic';
      this.level = 0;
      this.speaking = false;
      this.opened = false;
      this.closed = false;
    }
    async open() {
      if (fail) throw Object.assign(new Error('fail'), { name: fail });
      this.opened = true;
      return { stream: {}, state: 'granted' };
    }
    isOpen() { return this.opened && !this.closed; }
    close() { this.closed = true; }
    getMediaStream() { return null; }
    setSilenceMs() {}
    setThreshold() {}
  };
}

function makeTimers() {
  const scheduled = [];
  return {
    scheduled,
    set: (fn, delay) => { const id = { fn, delay, cleared: false }; scheduled.push(id); return id; },
    clear: (id) => { if (id) id.cleared = true; },
    every: (fn, ms) => { const id = { fn, ms, every: true, cleared: false }; scheduled.push(id); return id; },
    stopEvery: (id) => { if (id) id.cleared = true; },
    runAll() {
      for (const id of [...scheduled]) {
        if (!id.cleared && !id.every) id.fn();
      }
      return scheduled.filter((s) => !s.cleared && !s.every).length;
    }
  };
}

function setup({ settings = {}, engineOptions = {}, micOptions = {} } = {}) {
  const events = [];
  const timers = makeTimers();
  const config = sanitizeSettings(settings);
  const controller = new VoiceController({
    settings: config,
    emit: (event) => events.push(event),
    engineFactory: (options) => ({ engine: new (makeFakeEngine(engineOptions))({ ...options, onEvent: options.onEvent }), reason: 'ok' }),
    micFactory: () => new (makeFakeMic(micOptions))(),
    timers
  });
  controller.settings = config;
  return { controller, events, timers, config };
}

test('controller starts, streams interim/final text and stops', async () => {
  const { controller, events } = setup();
  const res = await controller.startSession({ tabId: 7 });
  assert.equal(res.ok, true);
  assert.ok(events.some((e) => e.kind === 'state' && e.state === STATE.LISTENING));

  controller.engine.emitInterim('سلام من');
  controller.engine.emitFinal('سلام من');
  const ops = events.filter((e) => e.kind === 'ops');
  assert.equal(ops.length, 1);
  assert.ok(ops[0].text.includes('سلام'));

  await controller.stopSession();
  assert.equal(controller.session.active, false);
  assert.equal(controller.state, STATE.IDLE);
});

test('microphone denial is reported with the right state and never starts the engine', async () => {
  const { controller, events } = setup({ micOptions: { fail: 'NotAllowedError' } });
  const res = await controller.startSession({ tabId: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, ERR.MIC_DENIED);
  assert.equal(controller.engine, null);
  const error = events.find((e) => e.kind === 'error');
  assert.equal(error.code, ERR.MIC_DENIED);
  assert.equal(error.state, STATE.MIC_DENIED);
});

test('busy microphone maps to mic-busy', async () => {
  const { controller } = setup({ micOptions: { fail: 'NotReadableError' } });
  const res = await controller.startSession({ tabId: 1 });
  assert.equal(res.reason, ERR.MIC_BUSY);
});

test('an unexpected engine end triggers an automatic restart', async () => {
  const { controller, events, timers } = setup();
  await controller.startSession({ tabId: 3 });
  controller.handleEngineEvent({ type: 'end', reason: 'engine-ended' });
  assert.equal(events.filter((e) => e.kind === 'restart').length, 1);
  assert.equal(controller.session.active, true, 'session stays active across a restart');
  timers.runAll();
  assert.equal(controller.session.restarts, 1);
});

test('restarts stop after the configured limit and surface an error', async () => {
  const { controller, events, timers } = setup({ settings: { recognition: { maxRestarts: 1 } } });
  await controller.startSession({ tabId: 3 });
  controller.handleEngineEvent({ type: 'end', reason: 'engine-ended' });
  timers.runAll();
  controller.handleEngineEvent({ type: 'end', reason: 'engine-ended' });
  const restartError = events.find((e) => e.kind === 'error' && e.code === ERR.RESTART_FAILED);
  assert.ok(restartError, 'restart-failed must be reported');
  assert.equal(controller.session.active, false);
});

test('auto restart can be disabled entirely', async () => {
  const { controller, events } = setup({ settings: { recognition: { autoRestart: false } } });
  await controller.startSession({ tabId: 3 });
  controller.handleEngineEvent({ type: 'end', reason: 'engine-ended' });
  assert.equal(events.some((e) => e.kind === 'restart'), false);
  assert.equal(controller.session.active, false);
});

test('language auto-switch needs confidence and happens on an utterance boundary', async () => {
  const { controller } = setup();
  await controller.startSession({ tabId: 4, lang: 'fa-IR' });
  // weak evidence twice → no switch
  controller.handleEngineEvent({ type: 'final', transcript: 'hello', lang: 'fa-IR', detected: { lang: 'en-US', confidence: 0.3, wordCount: 3, mixed: false } });
  controller.handleEngineEvent({ type: 'final', transcript: 'hello world', lang: 'fa-IR', detected: { lang: 'en-US', confidence: 0.3, wordCount: 3, mixed: false } });
  await Promise.resolve();
  assert.equal(controller.engine.lang, 'fa-IR');

  // strong evidence → switch
  controller.handleEngineEvent({ type: 'final', transcript: 'this is a long english sentence about react', lang: 'fa-IR', detected: { lang: 'en-US', confidence: 0.95, wordCount: 8, mixed: false } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(controller.engine.lang, 'en-US');
  assert.equal(controller.session.lang, 'en-US');
});

test('manual language mode never auto-switches', async () => {
  const { controller } = setup({ settings: { language: { mode: 'manual', manualLang: 'fa-IR' } } });
  await controller.startSession({ tabId: 4 });
  assert.equal(controller.session.lang, 'fa-IR');
  controller.handleEngineEvent({ type: 'final', transcript: 'english only here', lang: 'fa-IR', detected: { lang: 'en-US', confidence: 0.99, wordCount: 4, mixed: false } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(controller.engine.lang, 'fa-IR');
});

test('explicit setLanguage restarts the engine and is exposed to the UI', async () => {
  const { controller, events } = setup();
  await controller.startSession({ tabId: 4 });
  await controller.setLanguage('en-US');
  assert.equal(controller.engine.lang, 'en-US');
  assert.equal(controller.settings.language.mode, 'manual');
  assert.ok(events.some((e) => e.kind === 'state' && e.detail === 'language-set'));
});

test('duplicate finals never produce duplicated inserted text', async () => {
  const { controller, events } = setup();
  await controller.startSession({ tabId: 5 });
  controller.engine.emitFinal('من امروز تست می‌کنم');
  controller.engine.emitFinal('من امروز تست می‌کنم');
  const ops = events.filter((e) => e.kind === 'ops');
  assert.equal(ops.length, 1, 'the second identical final must be dropped');
});

test('diagnostics exposes state, mic and stats', async () => {
  const { controller } = setup();
  await controller.startSession({ tabId: 6 });
  const diag = await controller.diagnostics();
  assert.equal(diag.session.active, true);
  assert.equal(diag.mic.state, 'granted');
  assert.ok(diag.engineCatalog.length >= 4);
});
