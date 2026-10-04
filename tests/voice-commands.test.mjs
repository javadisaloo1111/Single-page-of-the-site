import test from "node:test";
import assert from "node:assert/strict";
import { parseVoiceCommand, normalizeCommandText } from "../shared.js";

test("recognizes exact Persian and English commands", () => {
  assert.deepEqual(parseVoiceCommand("خط جدید"), { id: "new-line", text: "\n" });
  assert.deepEqual(parseVoiceCommand("پاراگراف جدید"), { id: "new-paragraph", text: "\n\n" });
  assert.deepEqual(parseVoiceCommand("علامت سؤال"), { id: "question", text: "؟" });
  assert.deepEqual(parseVoiceCommand("copy"), { id: "copy", text: null });
  assert.deepEqual(parseVoiceCommand("دوباره انجام بده"), { id: "redo", text: null });
});

test("does not turn an ordinary sentence containing a command word into an action", () => {
  assert.equal(parseVoiceCommand("من کپی کردم"), null);
  assert.equal(parseVoiceCommand("این خط جدید را نوشتم"), null);
  assert.equal(parseVoiceCommand("همه رو پاک کن لطفاً"), null);
  assert.equal(parseVoiceCommand("کپی", false), null);
});

test("normalizes Arabic/Persian spelling and spoken punctuation only at command boundaries", () => {
  assert.equal(normalizeCommandText("كپی!"), "کپی");
  assert.deepEqual(parseVoiceCommand("نقطه‌ویرگول"), { id: "semicolon", text: ";" });
});
