import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeText, sanitizeSettings, applyVocabulary, convertPersianNumberWords, toDigits } from "../shared.js";

test("normalizes Persian Arabic Yeh/Kaf and spacing without transliterating English terms", () => {
  const input = "سلام، من با React و Next.js کار می‌کنم؛ API را به Laravel وصل کردم";
  const output = normalizeText(input, { ...DEFAULT_SETTINGS, smartPunctuation: false });
  assert.equal(output, "سلام، من با React و Next.js کار می‌کنم؛ API را به Laravel وصل کردم");
  assert.match(normalizeText("كیف يک", { ...DEFAULT_SETTINGS, smartPunctuation: false }), /کیف یک/);
});

test("preserves technical brand capitalization and only canonicalizes Latin aliases", () => {
  assert.equal(applyVocabulary("react next js node js REST API", []), "React Next.js Node.js REST API");
  assert.equal(applyVocabulary("ری‌اکت در فارسی", []), "ری‌اکت در فارسی");
});

test("supports editable word replacements with whole-word boundaries", () => {
  const output = normalizeText("reactjs و api", {
    ...DEFAULT_SETTINGS,
    smartPunctuation: false,
    customVocabulary: [{ word: "reactjs", replacement: "React.js" }]
  });
  assert.equal(output, "React.js و API");
});

test("does not rewrite digits, aliases, or punctuation inside URLs, emails, and version numbers", () => {
  const output = normalizeText("نسخه v2.5 و https://example.com/reactjs?id=4 و user42@example.com", {
    ...DEFAULT_SETTINGS,
    digitStyle: "fa",
    smartPunctuation: false,
    customVocabulary: [{ word: "reactjs", replacement: "React.js" }]
  });
  assert.equal(output, "نسخه v2.5 و https://example.com/reactjs?id=4 و user42@example.com");
});

test("normalizes common Persian spoken numbers and digit preference", () => {
  assert.equal(convertPersianNumberWords("بیست و پنج میلیون تومان", "fa"), "۲۵ میلیون تومان");
  assert.equal(convertPersianNumberWords("بیست و پنج میلیون تومان", "en"), "25 میلیون تومان");
  assert.equal(toDigits("نسخه 2.5", "fa"), "نسخه ۲.۵");
  assert.equal(toDigits("نسخه ۲.۵", "en"), "نسخه 2.5");
});

test("adds conservative sentence punctuation and detects likely Persian questions", () => {
  const settings = { ...DEFAULT_SETTINGS, smartPunctuation: true };
  assert.equal(normalizeText("سلام امروز خوبی", settings), "سلام امروز خوبی.");
  assert.equal(normalizeText("سلام خوبی امروز چطوری", settings), "سلام خوبی امروز چطوری؟");
  assert.equal(normalizeText("این React.js است.", settings), "این React.js است.");
});

test("sanitizes settings and clamps storage sizes", () => {
  const result = sanitizeSettings({ historyLimit: 5000, language: "xx", customVocabulary: [{ word: "  x ", replacement: " Y " }, null] });
  assert.equal(result.historyLimit, 200);
  assert.equal(result.language, "auto");
  assert.deepEqual(result.customVocabulary, [{ word: "x", replacement: "Y" }]);
});
