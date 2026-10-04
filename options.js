import { BUILTIN_VOCABULARY, DEFAULT_SETTINGS, sanitizeSettings } from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const fields = ["language", "showFloating", "interimResults", "continuousMode", "autoRestart", "smartPunctuation", "normalizeText", "persianHalfSpace", "preserveEnglishWords", "digitStyle", "voiceCommands", "historyEnabled", "historyLimit", "debugMode"];
let settings = { ...DEFAULT_SETTINGS };
let historyItems = [];
let dirty = false;

function setStatus(element, text, isError = false) {
  element.textContent = text || "";
  element.style.color = isError ? "#bd4148" : "#57866b";
}

function readForm() {
  const result = { ...settings };
  for (const key of fields) {
    const element = document.getElementById(key);
    if (!element) continue;
    result[key] = element.type === "checkbox" ? element.checked : element.value;
  }
  result.historyLimit = Number.parseInt(result.historyLimit, 10) || 50;
  return sanitizeSettings(result);
}

function fillForm(value) {
  settings = sanitizeSettings(value);
  for (const key of fields) {
    const element = document.getElementById(key);
    if (!element) continue;
    if (element.type === "checkbox") element.checked = Boolean(settings[key]);
    else element.value = settings[key] ?? "";
  }
  renderVocabulary();
  renderBuiltinTerms();
  renderHistory();
  updateEngineHint();
}

function markDirty() {
  dirty = true;
  $("#saveMessage").textContent = "تغییرات ذخیره نشده‌اند";
  $("#saveMessage").style.color = "#b77b2c";
}

function renderBuiltinTerms() {
  const container = $("#builtinTerms");
  container.replaceChildren();
  for (const term of BUILTIN_VOCABULARY) {
    const chip = document.createElement("span");
    chip.className = "term-chip";
    chip.textContent = term;
    container.append(chip);
  }
}

function renderVocabulary() {
  const container = $("#customVocabularyList");
  container.replaceChildren();
  if (!settings.customVocabulary.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "واژهٔ سفارشی اضافه نشده است.";
    container.append(empty);
    return;
  }
  settings.customVocabulary.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "vocab-row";
    const source = document.createElement("span");
    source.className = "source";
    source.textContent = entry.word;
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "→";
    const replacement = document.createElement("span");
    replacement.className = "replacement";
    replacement.textContent = entry.replacement;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "حذف واژه";
    remove.addEventListener("click", () => {
      settings.customVocabulary.splice(index, 1);
      renderVocabulary();
      markDirty();
    });
    row.append(source, arrow, replacement, remove);
    container.append(row);
  });
}

function renderHistory() {
  const container = $("#historyList");
  container.replaceChildren();
  if (!settings.historyEnabled) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "تاریخچه خاموش است؛ متن‌ها ذخیره نمی‌شوند.";
    container.append(empty);
    return;
  }
  if (!historyItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "هنوز موردی در تاریخچه وجود ندارد.";
    container.append(empty);
    return;
  }
  historyItems.slice(0, settings.historyLimit).forEach((item) => {
    const article = document.createElement("article");
    article.className = "history-item";
    const meta = document.createElement("div");
    meta.className = "history-meta";
    const date = new Date(item.timestamp || Date.now()).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
    const dateSpan = document.createElement("span");
    dateSpan.textContent = date;
    const langSpan = document.createElement("span");
    langSpan.textContent = String(item.language || "auto").toUpperCase();
    meta.append(dateSpan, langSpan);
    const text = document.createElement("p");
    text.className = "history-text";
    text.textContent = item.text || "";
    article.append(meta, text);
    container.append(article);
  });
}

function updateEngineHint() {
  const hint = $("#engineHint");
  if (hint) hint.textContent = "SpeechRecognition داخلی Chrome؛ رفتار ارسال صوت به سرویس Google به مرورگر و زبان وابسته است.";
}

async function load() {
  const [settingsResult, historyResult, statusResult] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }),
    chrome.runtime.sendMessage({ type: "GET_HISTORY" }),
    chrome.runtime.sendMessage({ type: "GET_STATUS" })
  ]);
  if (settingsResult?.ok) fillForm(settingsResult.settings);
  if (historyResult?.ok) {
    historyItems = historyResult.history || [];
    renderHistory();
  }
  if (statusResult?.ok) {
    $("#shortcutValue").textContent = statusResult.shortcut || "تنظیم نشده";
    const names = { listening: "در حال گوش‌دادن", processing: "در حال پردازش", reconnecting: "اتصال مجدد", error: "خطا", mic_denied: "دسترسی رد شده", ready: "آماده" };
    $("#topStatus").textContent = names[statusResult.state?.status] || "آماده";
  }
  dirty = false;
  const section = location.hash.slice(1);
  if (section && document.getElementById(section)) {
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

async function saveSettings() {
  const next = readForm();
  const previousHistory = settings.historyEnabled;
  const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: next });
  if (!response?.ok) throw new Error(response?.error || "ذخیره تنظیمات ناموفق بود.");
  settings = response.settings;
  if (previousHistory && !settings.historyEnabled) {
    await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
    historyItems = [];
  }
  if (settings.historyEnabled && settings.historyLimit < historyItems.length) {
    // The UI only displays the limit; the worker applies the cap on subsequent saves.
    historyItems = historyItems.slice(0, settings.historyLimit);
  }
  renderHistory();
  dirty = false;
  $("#saveMessage").textContent = "تغییرات ذخیره شدند";
  $("#saveMessage").style.color = "#57866b";
  setTimeout(() => { if (!dirty) $("#saveMessage").textContent = ""; }, 2200);
  return settings;
}

$("#saveBtn").addEventListener("click", async () => {
  try { await saveSettings(); }
  catch (error) { $("#saveMessage").textContent = error.message; $("#saveMessage").style.color = "#bd4148"; }
});

$("#shortcutBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_SHORTCUTS" }));

$("#addVocabBtn").addEventListener("click", () => {
  const word = $("#vocabWord").value.trim();
  const replacement = $("#vocabReplacement").value.trim();
  if (!word || !replacement) return;
  if (settings.customVocabulary.some((entry) => entry.word.toLocaleLowerCase() === word.toLocaleLowerCase())) {
    $("#vocabWord").focus();
    return;
  }
  if (settings.customVocabulary.length >= 100) return;
  settings.customVocabulary.push({ word, replacement });
  $("#vocabWord").value = "";
  $("#vocabReplacement").value = "";
  renderVocabulary();
  markDirty();
});

$("#clearHistoryBtn").addEventListener("click", async () => {
  if (!confirm("همهٔ تاریخچهٔ محلی پاک شود؟")) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
  historyItems = [];
  renderHistory();
});

$("#resetBtn").addEventListener("click", async () => {
  if (!confirm("تنظیمات به حالت اولیه برگردد؟")) return;
  settings = { ...DEFAULT_SETTINGS, floatingPosition: { ...DEFAULT_SETTINGS.floatingPosition } };
  fillForm(settings);
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
  historyItems = [];
  renderHistory();
  dirty = false;
  $("#saveMessage").textContent = "تنظیمات بازنشانی شدند";
});

$("#clipboardReadBtn").addEventListener("click", async () => {
  const result = await chrome.permissions.request({ permissions: ["clipboardRead"] });
  setStatus($("#permissionStatus"), result ? "مجوز Paste فعال شد." : "مجوز Paste داده نشد.", !result);
});
$("#clipboardWriteBtn").addEventListener("click", async () => {
  const result = await chrome.permissions.request({ permissions: ["clipboardWrite"] });
  setStatus($("#permissionStatus"), result ? "مجوز Copy فعال شد." : "مجوز Copy داده نشد.", !result);
});

$("#refreshDebugBtn").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "GET_DEBUG_LOGS" });
  const log = $("#debugLog");
  if (!result?.logs?.length) log.textContent = settings.debugMode ? "هنوز رویدادی ثبت نشده است." : "حالت توسعه‌دهنده خاموش است.";
  else log.textContent = result.logs.map((entry) => `${new Date(entry.time).toISOString()} ${entry.type} ${JSON.stringify(entry)}`).join("\n");
});
$("#clearDebugBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_DEBUG_LOGS" });
  $("#debugLog").textContent = "گزارش پاک شد.";
});

fields.forEach((key) => {
  const element = document.getElementById(key);
  element?.addEventListener("change", markDirty);
  element?.addEventListener("input", markDirty);
});

$(".sidebar").addEventListener("click", (event) => {
  const link = event.target.closest(".nav-link");
  if (!link) return;
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item === link));
});

window.addEventListener("hashchange", () => {
  const target = document.querySelector(`.nav-link[href="${location.hash}"]`);
  if (target) {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item === target));
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

load();
