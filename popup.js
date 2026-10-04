const $ = (selector) => document.querySelector(selector);
const labels = {
  ready: ["آماده", "برای شروع آماده‌ام"],
  starting: ["در حال شروع", "در حال آماده‌سازی میکروفون و موتور"],
  listening: ["در حال گوش‌دادن", "صحبت کنید؛ متن نهایی در محل مکان‌نما درج می‌شود"],
  processing: ["در حال پردازش", "در حال تکمیل متن نهایی"],
  reconnecting: ["در حال اتصال مجدد", "متن‌های نهایی دریافت‌شده حفظ می‌شوند"],
  stopping: ["در حال توقف", "در حال نهایی‌کردن آخرین بخش"],
  error: ["خطا", "تنظیمات یا اتصال را بررسی کنید"],
  mic_denied: ["دسترسی میکروفون رد شد", "از تنظیمات سایت مرورگر اجازه بدهید"]
};
let currentState = null;
let currentSettings = null;
let lastText = "";

function showNotice(text) {
  const notice = $("#warning");
  notice.textContent = text || "";
  notice.classList.toggle("hidden", !text);
}

function showError(text) {
  const error = $("#error");
  error.textContent = text || "";
  error.classList.toggle("hidden", !text);
}

function renderStatus(state = {}) {
  currentState = state;
  const status = state.status || "ready";
  const [title, subtitle] = labels[status] || labels.ready;
  $("#statusCard").dataset.state = status;
  $("#statusLabel").textContent = title;
  $("#statusSub").textContent = subtitle;
  const language = state.language === "auto" ? currentSettings?.language : state.language;
  $("#languageBadge").textContent = String(language || currentSettings?.language || "fa").toUpperCase();
  $("#toggleBtn").classList.toggle("stop", Boolean(state.active));
  $("#toggleBtn").disabled = ["starting", "stopping"].includes(status);
  $("#toggleBtn").querySelector("span:last-child").textContent = state.active ? "توقف تایپ صوتی" : "شروع تایپ صوتی";
  $("#micStatus").textContent = status === "listening" || status === "reconnecting" ? "فعال" : status === "mic_denied" ? "نیازمند اجازه" : status === "error" ? "بررسی لازم" : "فقط هنگام ضبط";
  lastText = state.lastTranscript || lastText;
  const transcript = $("#lastTranscript");
  transcript.textContent = lastText || "هنوز متنی ثبت نشده است.";
  transcript.classList.toggle("empty", !lastText);
  const interim = $("#interimTranscript");
  interim.textContent = state.interimText || "";
  interim.classList.toggle("hidden", !state.interimText);
  showError(state.error || "");
  showNotice(state.fallbackReason || state.limitation || "");
}

async function load() {
  const result = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (!result?.ok) return showError(result?.error || "وضعیت اکستنشن دریافت نشد.");
  currentSettings = result.settings;
  renderStatus(result.state);
}

$("#toggleBtn").addEventListener("click", async () => {
  $("#toggleBtn").disabled = true;
  showError("");
  try {
    const result = await chrome.runtime.sendMessage({ type: "START_STOP" });
    if (!result?.ok && result?.error) showError(result.error);
    if (result?.state) renderStatus(result.state);
    await load();
  } catch (error) {
    showError(error?.message || "ارتباط با اکستنشن برقرار نشد.");
  } finally {
    $("#toggleBtn").disabled = false;
  }
});

$("#settingsBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }));
$("#historyBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "history" }));
$("#vocabBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "dictionary" }));
$("#shortcutBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_SHORTCUTS" }));

$("#copyLastBtn").addEventListener("click", async () => {
  if (!lastText) return showNotice("هنوز متنی برای کپی وجود ندارد.");
  try {
    const granted = await chrome.permissions.request({ permissions: ["clipboardWrite"] });
    if (!granted) return showNotice("مجوز Clipboard داده نشد.");
    await navigator.clipboard.writeText(lastText);
    showNotice("متن کپی شد.");
    setTimeout(() => showNotice(""), 1500);
  } catch {
    showNotice("کپی انجام نشد؛ مجوز Clipboard را بررسی کنید.");
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "STATE_UPDATE") renderStatus(message.state);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.activeSession) renderStatus(changes.activeSession.newValue || {});
  if (area === "local" && changes.settings) {
    currentSettings = changes.settings.newValue;
    if (currentState) renderStatus(currentState);
  }
});
load();
