import test from "node:test";
import assert from "node:assert/strict";
import { WebSpeechEngine } from "../webspeech-engine.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeRecognition {
  static instances = [];

  constructor() {
    this.constructor.instances.push(this);
    this.lang = "";
    this.continuous = false;
    this.interimResults = false;
    this.started = false;
  }

  start() {
    if (this.started) throw new DOMException("Already started", "InvalidStateError");
    this.started = true;
    this.onstart?.();
  }

  stop() {
    this.started = false;
    this.onend?.();
  }

  finish() {
    this.started = false;
    this.onend?.();
  }

  say(text, isFinal = true) {
    const result = [{ transcript: text }];
    result.isFinal = isFinal;
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

function makeEngine(Recognition = FakeRecognition) {
  const utterances = [];
  const states = [];
  const errors = [];
  const engine = new WebSpeechEngine({
    Recognition,
    settings: { language: "fa", continuousMode: true, autoRestart: true, interimResults: true },
    restartDelayMs: 5,
    onInterim: () => {},
    onUtterance: (text) => utterances.push(text),
    onState: (status) => states.push(status),
    onError: (message, details) => errors.push({ message, ...details }),
    onSessionEnd: () => {}
  });
  return { engine, utterances, states, errors };
}

test("keeps utterances on both sides of silence and restarts with a fresh recognizer", async () => {
  FakeRecognition.instances = [];
  const { engine, utterances, states } = makeEngine();
  engine.start();
  const first = FakeRecognition.instances[0];
  assert.equal(first.lang, "fa-IR");
  first.say("سلام خوبی");
  first.finish();
  assert.deepEqual(utterances, ["سلام خوبی"]);
  assert.ok(states.includes("reconnecting"));

  await wait(20);
  assert.equal(FakeRecognition.instances.length, 2);
  assert.notEqual(FakeRecognition.instances[1], first);
  FakeRecognition.instances[1].say("چه خبر");
  engine.stop();
  assert.deepEqual(utterances, ["سلام خوبی", "چه خبر"]);
});

test("retries a transient start failure instead of silently stopping dictation", async () => {
  class FlakyRecognition extends FakeRecognition {
    static failuresRemaining = 1;

    start() {
      if (FlakyRecognition.failuresRemaining > 0) {
        FlakyRecognition.failuresRemaining--;
        throw new DOMException("Recognizer is still stopping", "InvalidStateError");
      }
      super.start();
    }
  }

  FlakyRecognition.instances = [];
  FlakyRecognition.failuresRemaining = 0;
  const { engine, states, errors } = makeEngine(FlakyRecognition);
  engine.start();
  FlakyRecognition.instances[0].finish();
  FlakyRecognition.failuresRemaining = 1;
  await wait(35);

  assert.ok(FlakyRecognition.instances.length >= 3);
  assert.equal(FlakyRecognition.instances.at(-1).started, true);
  assert.ok(states.includes("listening"));
  assert.ok(errors.some((error) => error.code === "InvalidStateError" && error.recoverable));
  engine.stop();
});
