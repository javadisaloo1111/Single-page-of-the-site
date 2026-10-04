export const BUILTIN_VOCABULARY = [
  "React", "Next.js", "JavaScript", "TypeScript", "Node.js", "Laravel", "PHP",
  "Python", "Flask", "WordPress", "WooCommerce", "HTML", "CSS", "API",
  "REST API", "GraphQL", "JSON", "MySQL", "PostgreSQL", "MongoDB", "Git",
  "GitHub", "GitLab", "Docker", "Linux", "Chrome", "Chrome Extension",
  "Frontend", "Backend", "Full Stack", "UI", "UX", "SEO", "Tailwind",
  "Bootstrap", "Vite", "NPM", "Yarn", "PNPM"
];

export const DEFAULT_SETTINGS = Object.freeze({
  engine: "auto",
  language: "auto",
  continuousMode: true,
  autoRestart: true,
  interimResults: true,
  smartPunctuation: true,
  normalizeText: true,
  persianHalfSpace: true,
  preserveEnglishWords: true,
  digitStyle: "fa",
  voiceCommands: true,
  showFloating: true,
  historyEnabled: false,
  historyLimit: 50,
  debugMode: false,
  customVocabulary: [],
  tokenBrokerUrl: "",
  brokerAccessToken: "",
  floatingPosition: { right: 22, bottom: 22 }
});

const TECHNICAL_ALIASES = [
  ["next js", "Next.js"], ["nextjs", "Next.js"], ["javascript", "JavaScript"],
  ["type script", "TypeScript"], ["typescript", "TypeScript"],
  ["node js", "Node.js"], ["nodejs", "Node.js"], ["react js", "React.js"],
  ["rest api", "REST API"], ["full stack", "Full Stack"],
  ["front end", "Frontend"], ["back end", "Backend"],
  ["wordpress", "WordPress"], ["woocommerce", "WooCommerce"],
  ["github", "GitHub"], ["gitlab", "GitLab"], ["mysql", "MySQL"],
  ["postgresql", "PostgreSQL"], ["mongodb", "MongoDB"],
  ["npm", "NPM"], ["pnpm", "PNPM"], ["ui", "UI"], ["ux", "UX"]
];

const PERSIAN_NUMBER_VALUES = new Map([
  ["صفر", 0], ["یک", 1], ["یه", 1], ["دو", 2], ["سه", 3], ["چهار", 4],
  ["پنج", 5], ["شش", 6], ["شیش", 6], ["هفت", 7], ["هشت", 8], ["نه", 9], ["ده", 10],
  ["یازده", 11], ["دوازده", 12], ["سیزده", 13], ["چهارده", 14], ["پانزده", 15],
  ["شانزده", 16], ["هفده", 17], ["هجده", 18], ["نوزده", 19], ["بیست", 20],
  ["سی", 30], ["چهل", 40], ["پنجاه", 50], ["شصت", 60], ["هفتاد", 70],
  ["هشتاد", 80], ["نود", 90], ["صد", 100], ["یکصد", 100], ["دویست", 200],
  ["سیصد", 300], ["چهارصد", 400], ["پانصد", 500], ["ششصد", 600],
  ["هفتصد", 700], ["هشتصد", 800], ["نهصد", 900], ["هزار", 1000],
  ["میلیون", 1_000_000], ["میلیارد", 1_000_000_000], ["تریلیون", 1_000_000_000_000]
]);
const NUMBER_SCALES = new Map([["هزار", 1_000], ["میلیون", 1_000_000], ["میلیارد", 1_000_000_000], ["تریلیون", 1_000_000_000_000]]);
const NUMBER_WORDS = [...PERSIAN_NUMBER_VALUES.keys()].sort((a, b) => b.length - a.length);
const NUMBER_UNITS = /^(?:تومان|ریال|درصد|سال|ماه|روز|دقیقه|ثانیه|ساعت|نفر|عدد|نسخه|متر|کیلومتر|مگابایت|گیگابایت|درجه|صفحه|بار|تا)$/u;

export function sanitizeSettings(raw = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...raw };
  settings.engine = ["auto", "soniox", "webspeech"].includes(settings.engine) ? settings.engine : "auto";
  settings.language = ["auto", "fa", "en", "ar"].includes(settings.language) ? settings.language : "auto";
  settings.digitStyle = ["fa", "en"].includes(settings.digitStyle) ? settings.digitStyle : "fa";
  settings.historyLimit = Math.min(200, Math.max(10, Number.parseInt(settings.historyLimit, 10) || 50));
  settings.customVocabulary = Array.isArray(settings.customVocabulary)
    ? settings.customVocabulary
        .filter((entry) => entry && typeof entry.word === "string" && typeof entry.replacement === "string")
        .slice(0, 100)
        .map((entry) => ({ word: entry.word.trim().slice(0, 80), replacement: entry.replacement.trim().slice(0, 80) }))
        .filter((entry) => entry.word && entry.replacement)
    : [];
  settings.tokenBrokerUrl = typeof settings.tokenBrokerUrl === "string" ? settings.tokenBrokerUrl.trim().slice(0, 500) : "";
  settings.brokerAccessToken = typeof settings.brokerAccessToken === "string" ? settings.brokerAccessToken.trim().slice(0, 500) : "";
  settings.floatingPosition = raw.floatingPosition && Number.isFinite(raw.floatingPosition.right) && Number.isFinite(raw.floatingPosition.bottom)
    ? { right: Math.max(0, Math.min(800, raw.floatingPosition.right)), bottom: Math.max(0, Math.min(800, raw.floatingPosition.bottom)) }
    : { ...DEFAULT_SETTINGS.floatingPosition };
  for (const key of ["continuousMode", "autoRestart", "interimResults", "smartPunctuation", "normalizeText", "persianHalfSpace", "preserveEnglishWords", "voiceCommands", "showFloating", "historyEnabled", "debugMode"]) {
    settings[key] = Boolean(settings[key]);
  }
  return settings;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacePhrase(text, phrase, replacement) {
  if (!phrase) return text;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`, "giu");
  return text.replace(pattern, (_match, prefix) => `${prefix}${replacement}`);
}

export function applyVocabulary(input, customVocabulary = []) {
  let text = input;
  for (const [alias, canonical] of TECHNICAL_ALIASES) text = replacePhrase(text, alias, canonical);
  for (const word of BUILTIN_VOCABULARY) {
    // Standardize capitalization without translating or transliterating the word.
    text = replacePhrase(text, word, word);
  }
  for (const entry of customVocabulary) {
    if (entry?.word && entry?.replacement) text = replacePhrase(text, entry.word.trim(), entry.replacement.trim());
  }
  return text;
}

export function toDigits(text, style = "fa") {
  const source = String(text);
  if (style === "en") return source.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  return source.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

const STRUCTURED_TOKEN_PATTERN = /(?:https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|(?<![\p{L}\p{N}])v?\d+(?:\.\d+)+(?:[-+][\p{L}\p{N}._-]+)?)/giu;
const TRAILING_URL_PUNCTUATION = /[.,!?؟،؛:]+$/u;

function protectStructuredTokens(text) {
  const tokens = [];
  const protectedText = text.replace(STRUCTURED_TOKEN_PATTERN, (match) => {
    const punctuation = match.match(TRAILING_URL_PUNCTUATION)?.[0] || "";
    const token = punctuation ? match.slice(0, -punctuation.length) : match;
    if (!token) return match;
    const marker = String.fromCodePoint(0xF0000 + tokens.length);
    tokens.push({ marker, token });
    return marker + punctuation;
  });
  return { text: protectedText, tokens };
}

function restoreStructuredTokens(text, tokens) {
  let output = text;
  for (const { marker, token } of tokens) output = output.split(marker).join(token);
  return output;
}

function parsePersianNumberExpression(expression) {
  const tokens = expression.split(/\s+/u).filter(Boolean);
  let total = 0;
  let group = 0;
  let count = 0;
  let hasScale = false;
  for (const token of tokens) {
    if (token === "و") continue;
    if (NUMBER_SCALES.has(token)) {
      const scale = NUMBER_SCALES.get(token);
      total += (group || 1) * scale;
      group = 0;
      count++;
      hasScale = true;
      continue;
    }
    if (!PERSIAN_NUMBER_VALUES.has(token)) return null;
    const value = PERSIAN_NUMBER_VALUES.get(token);
    if (value >= 1000) return null;
    group += value;
    count++;
  }
  if (count === 0) return null;
  const value = total + group;
  return { value, count, hasScale };
}

function formatSpokenNumber(value) {
  const scales = [[1_000_000_000_000, "تریلیون"], [1_000_000_000, "میلیارد"], [1_000_000, "میلیون"], [1_000, "هزار"]];
  for (const [scale, label] of scales) {
    if (value >= scale && value % scale === 0) return `${value / scale} ${label}`;
  }
  return String(value);
}

export function convertPersianNumberWords(text, digitStyle = "fa") {
  const words = NUMBER_WORDS.map(escapeRegExp).join("|");
  const numberWord = `(?:${words}|و)`;
  const expression = new RegExp(`(^|[^\\p{L}\\p{N}])((?:${numberWord})(?:\\s+${numberWord}){0,12})(?=$|[^\\p{L}\\p{N}])`, "giu");
  return text.replace(expression, (match, prefix, phrase, offset, whole) => {
    const normalizedPhrase = phrase.replace(/\s+/gu, " ").trim();
    const parsed = parsePersianNumberExpression(normalizedPhrase);
    if (!parsed || parsed.value === 0 && parsed.count === 1) return match;
    const tail = whole.slice(offset + match.length);
    const isUnit = /^\s*[^\p{L}\p{N}]?\s*/u.test(tail) && NUMBER_UNITS.test(tail.trimStart().split(/\s+/u)[0] || "");
    if (!parsed.hasScale && parsed.count < 2 && !isUnit) return match;
    const formatted = toDigits(formatSpokenNumber(parsed.value), digitStyle);
    return `${prefix}${formatted}`;
  });
}

function normalizePersianSpacing(text) {
  let result = text;
  result = result.replace(/(^|[\s(\[{])((?:ن)?می)\s+(?=[\u0600-\u06ff])/gu, "$1$2\u200c");
  result = result.replace(/([\u0600-\u06ff])\s+(ها|های|هایی|تر|ترین)(?=$|[\s،؛؟!,.])/gu, "$1\u200c$2");
  return result;
}

export function normalizeText(rawText, rawSettings = {}, { finalize = true } = {}) {
  const settings = sanitizeSettings(rawSettings);
  const source = String(rawText ?? "").normalize("NFC").replace(/<\/?(?:end|fin)>/g, "");
  const protectedContent = protectStructuredTokens(source);
  let text = protectedContent.text;
  if (!settings.normalizeText) return restoreStructuredTokens(toDigits(text.trim(), settings.digitStyle), protectedContent.tokens);

  text = text
    .replace(/[\u064a\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .replace(/\u0640/g, "")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\t\r]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\s+([،؛؟!?,.:;])/gu, "$1")
    .replace(/([،؛؟!?])(?=[\p{L}\p{N}])/gu, "$1 ")
    .trim();

  if (settings.persianHalfSpace) text = normalizePersianSpacing(text);
  if (settings.preserveEnglishWords) text = applyVocabulary(text, settings.customVocabulary);
  else {
    for (const entry of settings.customVocabulary) text = replacePhrase(text, entry.word, entry.replacement);
  }
  text = convertPersianNumberWords(text, settings.digitStyle);
  text = restoreStructuredTokens(toDigits(text, settings.digitStyle).trim(), protectedContent.tokens);

  const endsWithUrlOrEmail = /(?:https?:\/\/[^\s<>]+|www\.[^\s<>]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,})[.,!?؟،؛:]*$/iu.test(text);
  if (finalize && settings.smartPunctuation && text && !/[.!?؟…]$/u.test(text) && !endsWithUrlOrEmail) {
    const isQuestion = /(?:چرا|چطور|چطوری|چه‌طور|چه طور|چی|چه|کجا|کی|آیا|مگه|درسته|هستی|هستید|می‌کنی|میکنی|میشه|می‌شود|می‌شه)$/u.test(text);
    text += isQuestion ? "؟" : ".";
  }
  return text;
}

const COMMANDS = [
  { id: "new-line", phrases: ["خط جدید", "برو خط بعد", "خط بعد", "new line"] },
  { id: "new-paragraph", phrases: ["پاراگراف جدید", "پاراگراف بعد", "new paragraph"] },
  { id: "delete-last", phrases: ["پاک کن", "حذف کن", "حذف آخر", "delete that", "delete last"] },
  { id: "clear-session", phrases: ["همه رو پاک کن", "همه را پاک کن", "کل متن رو پاک کن", "پاک کردن همه", "clear all"] },
  { id: "copy", phrases: ["کپی", "کپی کن", "copy"] },
  { id: "paste", phrases: ["بچسبون", "پیست کن", "paste"] },
  { id: "undo", phrases: ["برگرد", "واگرد", "undo"] },
  { id: "redo", phrases: ["دوباره انجام بده", "از نو انجام بده", "redo"] },
  { id: "period", phrases: ["نقطه", "علامت نقطه", "period"] },
  { id: "comma", phrases: ["ویرگول", "کاما", "comma"] },
  { id: "question", phrases: ["علامت سوال", "علامت سؤال", "سوال", "سؤال", "question mark"] },
  { id: "exclamation", phrases: ["علامت تعجب", "تعجب", "exclamation mark"] },
  { id: "colon", phrases: ["دو نقطه", "دونقطه", "colon"] },
  { id: "semicolon", phrases: ["نقطه ویرگول", "نقطه‌ویرگول", "semicolon"] }
];
const COMMAND_TEXT = new Map([
  ["period", "."], ["comma", "،"], ["question", "؟"], ["exclamation", "!"],
  ["colon", ":"], ["semicolon", ";"], ["new-line", "\n"], ["new-paragraph", "\n\n"]
]);

export function normalizeCommandText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[\u064a\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .toLocaleLowerCase("fa-IR")
    .replace(/[.!?؟،,؛:;]+$/u, "")
    .replace(/[\s\u200c]+/gu, " ")
    .trim();
}

export function parseVoiceCommand(text, enabled = true) {
  if (!enabled) return null;
  const normalized = normalizeCommandText(text);
  if (!normalized) return null;
  for (const command of COMMANDS) {
    if (command.phrases.some((phrase) => normalizeCommandText(phrase) === normalized)) {
      return { id: command.id, text: COMMAND_TEXT.get(command.id) ?? null };
    }
  }
  return null;
}

export function getSpeechErrorMessage(errorCode) {
  const code = String(errorCode ?? "").toLowerCase();
  if (["notallowederror", "not-allowed", "permission-denied", "permission_denied"].includes(code)) {
    return "دسترسی به میکروفون فعال نیست. از تنظیمات مرورگر اجازه دسترسی بدهید.";
  }
  if (["notfounderror", "audio-capture", "device-not-found", "no-microphone"].includes(code)) {
    return "میکروفونی پیدا نشد. اتصال و تنظیمات ورودی صدا را بررسی کنید.";
  }
  if (["notreadableerror", "audio-busy", "device-in-use"].includes(code)) {
    return "میکروفون در برنامه دیگری مشغول است یا در دسترس نیست.";
  }
  if (["network", "networkerror", "offline"].includes(code)) {
    return "اتصال شبکه قطع شد. اتصال را بررسی کنید؛ متن‌های نهاییِ دریافت‌شده حفظ شده‌اند.";
  }
  if (["unsupported", "service-not-allowed", "language-not-supported"].includes(code)) {
    return "موتور تشخیص گفتار یا زبان انتخاب‌شده در این مرورگر پشتیبانی نمی‌شود.";
  }
  return "در تشخیص گفتار خطایی رخ داد. دوباره تلاش کنید یا تنظیمات موتور را بررسی کنید.";
}

export function getWebSpeechLanguage(language = "auto", browserLanguage = "fa-IR") {
  if (language === "en") return "en-US";
  if (language === "ar") return "ar-SA";
  if (language === "fa") return "fa-IR";
  return /^en/i.test(browserLanguage) ? "en-US" : /^ar/i.test(browserLanguage) ? "ar-SA" : "fa-IR";
}

export function hasProviderConfiguration(settings) {
  return Boolean(settings?.tokenBrokerUrl && settings?.brokerAccessToken);
}
