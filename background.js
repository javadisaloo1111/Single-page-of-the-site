import { DEFAULT_SETTINGS, getSpeechErrorMessage, normalizeText, parseVoiceCommand, sanitizeSettings } from "./shared.js";

const SESSION_KEY = "activeSession";
let offscreenCreating = null;
let startPromise = null;
let stopPromise = null;
let utteranceQueue = Promise.resolve();
let cachedSettings = null;

async function getSettings() {
  if (cachedSettings) return sanitizeSettings(cachedSettings);
  const result = await chrome.storage.local.get("settings");
  cachedSettings = sanitizeSettings(result.settings || DEFAULT_SETTINGS);
  return sanitizeSettings(cachedSettings);
}

function recognitionSettings(settings) {
  return {
    language: settings.language,
    continuousMode: settings.continuousMode,
    autoRestart: settings.autoRestart,
    interimResults: settings.interimResults
  };
}

function statusSettings(settings) {
  return { engine: settings.engine, language: settings.language, showFloating: settings.showFloating, historyEnabled: settings.historyEnabled };
}

function contentSettings(settings) {
  return { showFloating: settings.showFloating, floatingPosition: settings.floatingPosition };
}

async function getSession() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] || { active: false, status: "ready", lastTranscript: "", interimText: "" };
}

async function publishState(patch = {}, { sendToTab = true } = {}) {
  const current = await getSession();
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await chrome.storage.session.set({ [SESSION_KEY]: next });
  const badge = next.status === "listening" || next.status === "reconnecting" ? "●" : next.status === "processing" ? "…" : "";
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({ color: next.status === "error" || next.status === "mic_denied" ? "#c93845" : "#6955df" });
  await chrome.action.setTitle({ title: next.status === "listening" ? "VocaType — در حال گوش‌دادن" : "VocaType — تایپ صوتی" });
  if (sendToTab && Number.isInteger(next.tabId) && next.tabId >= 0) {
    chrome.tabs.sendMessage(next.tabId, { type: "VT_STATE", state: next }).catch(() => {});
  }
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", state: next }).catch(() => {});
  return next;
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (contexts.length) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "CLIPBOARD"],
      justification: "Run Chrome's built-in SpeechRecognition only after the user starts voice typing, and provide optional clipboard voice commands."
    });
  }
  try { await offscreenCreating; }
  finally { offscreenCreating = null; }
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ target: "offscreen", ...message });
}

function isRestrictedUrl(url = "") {
  return /^(chrome|chrome-untrusted|edge|about|view-source|devtools):/i.test(url) || /chrome\.google\.com\/webstore|chromewebstore\.google\.com/i.test(url);
}

async function prepareTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || isRestrictedUrl(tab.url)) throw new Error("این صفحه اجازهٔ اجرای Content Script نمی‌دهد. یک صفحهٔ معمولی باز کنید.");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const result = await chrome.tabs.sendMessage(tabId, { type: "VT_PREPARE" }).catch(() => null);
  if (!result?.ready) throw new Error("اتصال امن به صفحه برقرار نشد. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.");
  return { tab, editable: Boolean(result.editable) };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("تب فعال پیدا نشد.");
  return tab;
}

async function startSessionImpl(tabId = null) {
  const current = await getSession();
  if (current.active && current.status !== "error") return { ok: true, state: current };
  const settings = await getSettings();
  let tab;
  try { tab = tabId != null ? await chrome.tabs.get(tabId) : await getActiveTab(); }
  catch { tab = await getActiveTab(); }
  const sessionId = crypto.randomUUID();
  let sessionPublished = false;

  try {
    const prepared = await prepareTab(tab.id);
    const session = {
      active: true,
      status: "starting",
      sessionId,
      tabId: tab.id,
      startedAt: Date.now(),
      lastTranscript: "",
      interimText: "",
      language: settings.language,
      engine: settings.engine,
      restartCount: 0,
      fallbackReason: "",
      error: "",
      tabEditableAtStart: prepared.editable
    };
    await publishState(session);
    sessionPublished = true;
    const response = await sendToOffscreen({ type: "OFFSCREEN_START", sessionId, settings: recognitionSettings(settings) });
    if (!response?.ok) throw new Error(response?.error || "موتور تشخیص شروع نشد.");
    return { ok: true, state: await getSession() };
  } catch (error) {
    if (sessionPublished) {
      const latest = await getSession();
      if (latest.sessionId !== sessionId || (!latest.active && latest.status === "ready")) return { ok: true, state: latest };
    }
    const message = error?.message || getSpeechErrorMessage(error?.name);
    const isPermission = /دسترسی به میکروفون|permission|notallowed/i.test(message) || error?.name === "NotAllowedError";
    const state = await publishState({
      active: false,
      status: isPermission ? "mic_denied" : "error",
      error: isPermission ? "دسترسی به میکروفون فعال نیست. از تنظیمات مرورگر اجازه دسترسی بدهید." : message,
      interimText: ""
    });
    return { ok: false, error: state.error, state };
  }
}

function startSession(tabId = null) {
  if (startPromise) return startPromise;
  startPromise = startSessionImpl(tabId).finally(() => { startPromise = null; });
  return startPromise;
}

async function stopSessionImpl() {
  const current = await getSession();
  if (!current.active && current.status === "ready") return { ok: true, state: current };
  await publishState({ status: "stopping", error: "" });
  try { await sendToOffscreen({ type: "OFFSCREEN_STOP", sessionId: current.sessionId }); }
  catch { /* the offscreen context may already have been closed */ }
  const latest = await getSession();
  const state = await publishState({
    active: false,
    status: "ready",
    interimText: "",
    engine: latest.engine || current.engine,
    error: ""
  });
  return { ok: true, state };
}

function stopSession() {
  if (stopPromise) return stopPromise;
  stopPromise = stopSessionImpl().finally(() => { stopPromise = null; });
  return stopPromise;
}

async function toggleSession(tabId = null) {
  const state = await getSession();
  if (state.active || ["starting", "listening", "processing", "reconnecting", "stopping"].includes(state.status)) return stopSession();
  return startSession(tabId);
}

function addDebugLog(entry) {
  return getSettings().then(async (settings) => {
    if (!settings.debugMode) return;
    const result = await chrome.storage.session.get("debugLogs");
    const logs = Array.isArray(result.debugLogs) ? result.debugLogs : [];
    logs.push({ time: Date.now(), ...entry });
    await chrome.storage.session.set({ debugLogs: logs.slice(-100) });
  }).catch(() => {});
}

function sendTabMessage(tabId, message) {
  if (!Number.isInteger(tabId) || tabId < 0) return Promise.resolve(null);
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

async function showCommandError(message) {
  const state = await getSession();
  await publishState({ error: message, status: state.active ? state.status : "error" });
}

async function executeVoiceCommand(command, state) {
  const tabId = state.tabId;
  if (!Number.isInteger(tabId)) return;
  if (["period", "comma", "question", "exclamation", "colon", "semicolon", "new-line", "new-paragraph"].includes(command.id)) {
    const result = await sendTabMessage(tabId, { type: "VT_INSERT", text: command.text, commandText: true });
    if (!result) await showCommandError("صفحه برای درج فرمان در دسترس نیست.");
    else if (result.error) await showCommandError(result.error);
    return;
  }
  if (command.id === "copy") {
    const allowed = await chrome.permissions.contains({ permissions: ["clipboardWrite"] });
    if (!allowed) return showCommandError("برای فرمان کپی، مجوز Clipboard را از صفحهٔ تنظیمات فعال کنید.");
    const target = await sendTabMessage(tabId, { type: "VT_GET_COPY_TEXT" });
    if (!target?.text) return showCommandError("متنی برای کپی پیدا نشد.");
    const result = await sendToOffscreen({ type: "OFFSCREEN_CLIPBOARD_WRITE", text: target.text });
    if (!result?.ok) return showCommandError(result?.error || "کپی در Clipboard ناموفق بود.");
    return;
  }
  if (command.id === "paste") {
    const allowed = await chrome.permissions.contains({ permissions: ["clipboardRead"] });
    if (!allowed) return showCommandError("برای فرمان چسباندن، مجوز Clipboard را از صفحهٔ تنظیمات فعال کنید.");
    const result = await sendToOffscreen({ type: "OFFSCREEN_CLIPBOARD_READ" });
    if (!result?.ok) return showCommandError(result?.error || "خواندن Clipboard ناموفق بود.");
    const inserted = await sendTabMessage(tabId, { type: "VT_INSERT", text: String(result.text || "").slice(0, 20000), commandText: true });
    if (inserted?.error) await showCommandError(inserted.error);
    return;
  }
  if (["delete-last", "clear-session", "undo", "redo"].includes(command.id)) {
    const result = await sendTabMessage(tabId, { type: "VT_COMMAND", command: command.id });
    if (!result) return showCommandError("صفحه برای اجرای فرمان در دسترس نیست.");
    if (result.error) await showCommandError(result.error);
  }
}

async function addHistory(settings, text, language) {
  if (!settings.historyEnabled) return;
  const result = await chrome.storage.local.get("history");
  const history = Array.isArray(result.history) ? result.history : [];
  history.unshift({ id: crypto.randomUUID(), timestamp: Date.now(), language: language || "auto", text: text.slice(0, 8000) });
  await chrome.storage.local.set({ history: history.slice(0, settings.historyLimit) });
}

async function processUtterance(message) {
  const current = await getSession();
  if (!current.active || message.sessionId !== current.sessionId) return;
  const raw = typeof message.text === "string" ? message.text.trim().slice(0, 8000) : "";
  if (!raw) return;
  await publishState({ status: "processing", interimText: "", language: message.language || current.language || "auto" });
  await addDebugLog({ type: "final-transcript", language: message.language || null, text: raw });
  const settings = await getSettings();
  const voiceCommand = parseVoiceCommand(raw, settings.voiceCommands);
  if (voiceCommand) {
    await executeVoiceCommand(voiceCommand, current);
    const latest = await getSession();
    await publishState({ status: latest.active ? "listening" : "ready", interimText: "" });
    return;
  }
  const normalized = normalizeText(raw, settings, { finalize: true });
  if (!normalized) {
    await publishState({ status: current.active ? "listening" : "ready" });
    return;
  }
  const inserted = await sendTabMessage(current.tabId, { type: "VT_INSERT", text: normalized, settings });
  const insertionError = !inserted
    ? "صفحه یا ویرایشگر در دسترس نیست؛ متن در Popup باقی می‌ماند و در محل صفحه درج نشد."
    : inserted.error || "";
  await addHistory(settings, normalized, message.language || current.language);
  const stateAfterInsert = await getSession();
  await publishState({
    active: stateAfterInsert.active,
    status: stateAfterInsert.active ? "listening" : "ready",
    lastTranscript: normalized,
    interimText: "",
    language: message.language || stateAfterInsert.language || "auto",
    error: insertionError
  });
  await addDebugLog({ type: "insertion", language: message.language || null, tabId: current.tabId, ok: !insertionError });
}

async function handleOffscreenMessage(message, sender) {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("offscreen.html")) return;
  const current = await getSession();
  if (message.sessionId && current.sessionId && message.sessionId !== current.sessionId) return;
  if (message.type === "OFFSCREEN_STATUS") {
    const status = ["starting", "listening", "processing", "reconnecting", "stopping", "ready", "error"].includes(message.status) ? message.status : "error";
    const active = status !== "ready" && status !== "error" ? current.active : false;
    await publishState({
      active,
      status,
      engine: message.engine || current.engine,
      language: message.language || current.language,
      interimText: status === "ready" ? "" : current.interimText,
      restartCount: message.restartCount ?? current.restartCount,
      fallbackReason: message.fallbackReason || message.limitation || current.fallbackReason || "",
      error: message.error || current.error || ""
    });
    await addDebugLog({ type: "recognition-state", status, engine: message.engine || current.engine, restartCount: message.restartCount });
    if (status === "error") setTimeout(() => sendToOffscreen({ type: "OFFSCREEN_STOP", sessionId: message.sessionId }).catch(() => {}), 0);
    return;
  }
  if (message.type === "OFFSCREEN_INTERIM") {
    const text = typeof message.text === "string" ? message.text.slice(-4000) : "";
    const currentSettings = await getSettings();
    await publishState({
      status: current.active ? (current.status === "processing" ? "processing" : "listening") : current.status,
      interimText: currentSettings.interimResults ? text : "",
      language: message.language || current.language,
      engine: message.engine || current.engine
    });
    await addDebugLog({ type: "interim", language: message.language || null, text });
    return;
  }
  if (message.type === "OFFSCREEN_UTTERANCE") {
    utteranceQueue = utteranceQueue
      .catch(() => {})
      .then(() => processUtterance(message))
      .catch((error) => addDebugLog({ type: "utterance-processing-error", message: error?.message || "unknown" }));
    await utteranceQueue;
    return;
  }
  if (message.type === "OFFSCREEN_ERROR") {
    const error = String(message.message || getSpeechErrorMessage(message.code)).slice(0, 500);
    const micDenied = /دسترسی به میکروفون/.test(error) || message.code === "NotAllowedError" || message.code === "not-allowed";
    await publishState({
      active: micDenied || message.recoverable === false ? false : current.active,
      status: micDenied ? "mic_denied" : current.active ? current.status : "error",
      error,
      restartCount: message.restartCount ?? current.restartCount
    });
    await addDebugLog({ type: "error", code: message.code || "unknown", message: error, recoverable: Boolean(message.recoverable) });
    if (micDenied || message.recoverable === false) setTimeout(() => sendToOffscreen({ type: "OFFSCREEN_STOP", sessionId: message.sessionId }).catch(() => {}), 0);
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") return { ok: false, error: "درخواست نامعتبر است." };
  if (message.type.startsWith("OFFSCREEN_") && sender.url === chrome.runtime.getURL("offscreen.html")) {
    await handleOffscreenMessage(message, sender);
    return { ok: true };
  }
  if (sender.id !== chrome.runtime.id) return { ok: false, error: "فرستنده نامعتبر است." };

  switch (message.type) {
    case "GET_STATUS": {
      const state = await getSession();
      const settings = statusSettings(await getSettings());
      const commands = await chrome.commands.getAll();
      return { ok: true, state, settings, shortcut: commands.find((item) => item.name === "toggle-dictation")?.shortcut || "تنظیم نشده" };
    }
    case "GET_SETTINGS": {
      const pageUrl = sender.url ? new URL(sender.url) : null;
      if (pageUrl?.origin !== `chrome-extension://${chrome.runtime.id}` || !pageUrl.pathname.endsWith("/options.html")) {
        return { ok: false, error: "تنظیمات خصوصی فقط از صفحهٔ Options قابل خواندن است." };
      }
      return { ok: true, settings: await getSettings() };
    }
    case "GET_PUBLIC_SETTINGS": return { ok: true, settings: contentSettings(await getSettings()) };
    case "SAVE_SETTINGS": {
      const current = await getSettings();
      const settings = sanitizeSettings({ ...current, ...(message.settings || {}) });
      cachedSettings = settings;
      await chrome.storage.local.set({ settings });
      const storedHistory = await chrome.storage.local.get("history");
      if (!settings.historyEnabled) await chrome.storage.local.set({ history: [] });
      else if (Array.isArray(storedHistory.history) && storedHistory.history.length > settings.historyLimit) {
        await chrome.storage.local.set({ history: storedHistory.history.slice(0, settings.historyLimit) });
      }
      await publishState({ settingsUpdatedAt: Date.now() }, { sendToTab: false });
      return { ok: true, settings };
    }
    case "GET_HISTORY": {
      const result = await chrome.storage.local.get("history");
      return { ok: true, history: Array.isArray(result.history) ? result.history : [] };
    }
    case "CLEAR_HISTORY": await chrome.storage.local.set({ history: [] }); return { ok: true };
    case "GET_DEBUG_LOGS": {
      const result = await chrome.storage.session.get("debugLogs");
      return { ok: true, logs: Array.isArray(result.debugLogs) ? result.debugLogs.slice(-100) : [] };
    }
    case "CLEAR_DEBUG_LOGS": await chrome.storage.session.set({ debugLogs: [] }); return { ok: true };
    case "START_STOP": return toggleSession(sender.tab?.id ?? null);
    case "START_SESSION": return startSession(Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id ?? null);
    case "STOP_SESSION": return stopSession();
    case "TOGGLE_FROM_CONTENT": return toggleSession(sender.tab?.id ?? null);
    case "VT_PAGE_UNLOAD": {
      const current = await getSession();
      if (current.active && sender.tab?.id === current.tabId) return stopSession();
      return { ok: true };
    }
    case "OPEN_OPTIONS": {
      const section = ["general", "engine", "text", "dictionary", "commands", "history", "privacy", "debug"].includes(message.section) ? message.section : "general";
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${section}`) });
      return { ok: true };
    }
    case "OPEN_SHORTCUTS": await chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); return { ok: true };
    case "SET_FLOATING_POSITION": {
      const settings = await getSettings();
      const position = message.position;
      if (position && Number.isFinite(position.right) && Number.isFinite(position.bottom)) {
        settings.floatingPosition = { right: Math.max(0, Math.min(800, position.right)), bottom: Math.max(0, Math.min(800, position.bottom)) };
        cachedSettings = settings;
        await chrome.storage.local.set({ settings });
      }
      return { ok: true };
    }
    case "VT_SET_FLOATING_VISIBLE": {
      const settings = await getSettings();
      settings.showFloating = Boolean(message.visible);
      cachedSettings = settings;
      await chrome.storage.local.set({ settings });
      return { ok: true };
    }
    default: return { ok: false, error: "نوع درخواست شناخته‌شده نیست." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || "خطای داخلی اکستنشن." }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-dictation") toggleSession().catch((error) => showCommandError(error.message));
});

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("settings");
  const settings = sanitizeSettings(existing.settings || DEFAULT_SETTINGS);
  cachedSettings = settings;
  // Persist migration to Chrome-only speech and erase any obsolete stored Broker credentials.
  await chrome.storage.local.set({ settings });
  const granted = await chrome.permissions.getAll();
  if (granted.origins?.length) {
    try { await chrome.permissions.remove({ origins: granted.origins }); } catch { /* removed host grants are no longer used */ }
  }
  const previousSession = await getSession();
  if (previousSession.active && previousSession.sessionId) {
    try { await sendToOffscreen({ type: "OFFSCREEN_STOP", sessionId: previousSession.sessionId }); } catch { /* the old offscreen document may already be gone */ }
  }
  await publishState({ active: false, status: "ready", engine: "webspeech", language: settings.language, interimText: "", fallbackReason: "", error: "" }, { sendToTab: false });
  await chrome.action.setBadgeText({ text: "" });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getSession();
  if (state.active && state.tabId === tabId) await stopSession();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    const settings = sanitizeSettings(changes.settings.newValue || DEFAULT_SETTINGS);
    cachedSettings = settings;
    publishState({ settingsUpdatedAt: Date.now() }, { sendToTab: false }).then(() => {
      const state = getSession();
      state.then((current) => { if (current.active) sendTabMessage(current.tabId, { type: "VT_SETTINGS_CHANGED", settings: contentSettings(settings) }); });
    }).catch(() => {});
  }
});
