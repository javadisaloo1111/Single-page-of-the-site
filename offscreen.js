import { getSpeechErrorMessage, sanitizeSettings } from "./shared.js";
import { WebSpeechEngine } from "./webspeech-engine.js";

let activeSession = null;
let startLock = null;
let lastInterimAt = 0;
let lastInterimText = "";
let pendingInterim = null;
let interimTimer = null;
const cancelledSessions = new Set();
const scheduledSessionStops = new Map();
const pendingUtterances = new Set();

function emit(type, payload = {}) {
  if (!activeSession && type !== "OFFSCREEN_ERROR") return Promise.resolve();
  return chrome.runtime.sendMessage({
    target: "background",
    type,
    sessionId: activeSession?.sessionId ?? payload.sessionId,
    ...payload
  }).catch(() => {});
}

function emitUtterance(payload) {
  const pending = emit("OFFSCREEN_UTTERANCE", payload);
  pendingUtterances.add(pending);
  pending.finally(() => pendingUtterances.delete(pending));
  return pending;
}

function emitInterim(text, language, engine = "webspeech") {
  const value = String(text || "").slice(-4000);
  const payload = { text: value, language, engine };
  if (!value) {
    clearTimeout(interimTimer);
    interimTimer = null;
    pendingInterim = null;
    lastInterimText = "";
    lastInterimAt = Date.now();
    emit("OFFSCREEN_INTERIM", payload);
    return;
  }
  if (value === lastInterimText && !pendingInterim) return;
  pendingInterim = payload;
  const delay = Math.max(0, 150 - (Date.now() - lastInterimAt));
  if (delay === 0) {
    const next = pendingInterim;
    pendingInterim = null;
    lastInterimText = next.text;
    lastInterimAt = Date.now();
    emit("OFFSCREEN_INTERIM", next);
  } else if (!interimTimer) {
    interimTimer = setTimeout(() => {
      interimTimer = null;
      if (!pendingInterim) return;
      const next = pendingInterim;
      pendingInterim = null;
      lastInterimText = next.text;
      lastInterimAt = Date.now();
      emit("OFFSCREEN_INTERIM", next);
    }, delay);
  }
}

function scheduleSessionStop(sessionId, delay = 150) {
  if (!sessionId || scheduledSessionStops.has(sessionId)) return;
  const timer = setTimeout(() => {
    scheduledSessionStops.delete(sessionId);
    stopActiveSession({ userInitiated: true, sessionId }).catch(() => {});
  }, delay);
  scheduledSessionStops.set(sessionId, timer);
}

function setEngineStatus(status, details = {}) {
  if (activeSession) activeSession.status = status;
  emit("OFFSCREEN_STATUS", { status, engine: "webspeech", ...details });
}

function asFriendlyError(error) {
  const name = error?.name || error?.code || "unknown";
  if (error?.message && name === "Error") return error.message;
  return getSpeechErrorMessage(name);
}


async function stopActiveSession({ userInitiated = true, sessionId = null, notify = true } = {}) {
  if (sessionId && scheduledSessionStops.has(sessionId)) {
    clearTimeout(scheduledSessionStops.get(sessionId));
    scheduledSessionStops.delete(sessionId);
  }
  if (sessionId) {
    cancelledSessions.add(sessionId);
    while (cancelledSessions.size > 50) cancelledSessions.delete(cancelledSessions.values().next().value);
  }
  const session = activeSession;
  if (!session || (sessionId && session.sessionId !== sessionId)) return { ok: true, status: "ready" };
  activeSession = { ...session, status: "stopping" };
  clearTimeout(interimTimer);
  interimTimer = null;
  pendingInterim = null;
  emit("OFFSCREEN_STATUS", { status: "stopping", engine: "webspeech" });
  try { session.engine.stop(userInitiated); } catch { /* cleanup continues */ }
  while (pendingUtterances.size) await Promise.allSettled([...pendingUtterances]);
  activeSession = null;
  if (notify) chrome.runtime.sendMessage({ target: "background", type: "OFFSCREEN_STATUS", sessionId: session.sessionId, status: "ready", engine: "webspeech" }).catch(() => {});
  return { ok: true, status: "ready" };
}

async function startWebSpeech(sessionId, settings) {
  clearTimeout(interimTimer);
  interimTimer = null;
  pendingInterim = null;
  lastInterimAt = 0;
  lastInterimText = "";
  const engine = new WebSpeechEngine({
    Recognition: self.SpeechRecognition || self.webkitSpeechRecognition,
    settings,
    onInterim: (text, language) => {
      if (activeSession?.sessionId === sessionId && activeSession.status !== "stopping") {
        emitInterim(text, language, "webspeech");
      }
    },
    onUtterance: (text, language) => {
      if (activeSession?.sessionId !== sessionId) return;
      // stop() flushes its final buffer after the session status switches to stopping.
      emitUtterance({ text, language, engine: "webspeech", utteranceId: crypto.randomUUID() });
    },
    onSessionEnd: ({ hadTranscript }) => scheduleSessionStop(sessionId, hadTranscript ? 150 : 0),
    onState: (status, details = {}) => {
      if (activeSession?.sessionId === sessionId) setEngineStatus(status, { ...details, engine: "webspeech" });
    },
    onError: (message, info = {}) => {
      if (activeSession?.sessionId === sessionId) emit("OFFSCREEN_ERROR", { message, ...info });
    }
  });
  activeSession = { sessionId, settings, status: "starting", engineKind: "webspeech", engine, startedAt: Date.now() };
  try { engine.start(); }
  catch (error) { activeSession = null; throw error; }
  emit("OFFSCREEN_STATUS", {
    status: "listening",
    engine: "webspeech",
    limitation: "استفاده از SpeechRecognition داخلی Chrome است؛ رفتار ارسال صدا به سرویس Google به نسخهٔ Chrome و زبان بستگی دارد. تشخیص هم‌زمان چند زبان تضمین نمی‌شود."
  });
}

async function startSession(message) {
  if (startLock) return startLock;
  startLock = (async () => {
    const sessionId = message.sessionId;
    if (!sessionId || typeof sessionId !== "string") throw new Error("شناسهٔ نشست نامعتبر است.");
    if (cancelledSessions.has(sessionId)) throw new Error("شروع نشست لغو شد.");
    if (activeSession && activeSession.sessionId === sessionId) return { ok: true, status: activeSession.status };
    if (activeSession) await stopActiveSession({ userInitiated: false, sessionId: activeSession.sessionId });
    const settings = sanitizeSettings(message.settings || {});
    await startWebSpeech(sessionId, settings);
    if (cancelledSessions.has(sessionId)) {
      await stopActiveSession({ userInitiated: false, sessionId, notify: false });
      throw new Error("شروع نشست لغو شد.");
    }
    return { ok: true, status: "listening", engine: "webspeech" };
  })();
  try { return await startLock; }
  finally { startLock = null; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !["OFFSCREEN_START", "OFFSCREEN_STOP", "OFFSCREEN_CLIPBOARD_READ", "OFFSCREEN_CLIPBOARD_WRITE", "OFFSCREEN_GET_STATE"].includes(message.type)) return false;
  if (sender.id && sender.id !== chrome.runtime.id) return false;

  if (message.type === "OFFSCREEN_START") {
    startSession(message).then(sendResponse).catch((error) => {
      const messageText = asFriendlyError(error);
      emit("OFFSCREEN_ERROR", { sessionId: message.sessionId, message: messageText, code: error?.name || "engine-error", recoverable: false });
      sendResponse({ ok: false, error: messageText });
    });
    return true;
  }
  if (message.type === "OFFSCREEN_STOP") {
    stopActiveSession({ userInitiated: true, sessionId: message.sessionId || null }).then(sendResponse);
    return true;
  }
  if (message.type === "OFFSCREEN_GET_STATE") {
    sendResponse({ ok: true, active: Boolean(activeSession), status: activeSession?.status || "ready", engine: activeSession?.engineKind || null });
    return false;
  }
  if (message.type === "OFFSCREEN_CLIPBOARD_READ" || message.type === "OFFSCREEN_CLIPBOARD_WRITE") {
    (async () => {
      try {
        if (!navigator.clipboard) throw new Error("Clipboard API در این مرورگر در دسترس نیست.");
        if (message.type === "OFFSCREEN_CLIPBOARD_READ") return { ok: true, text: await navigator.clipboard.readText() };
        await navigator.clipboard.writeText(String(message.text || "").slice(0, 20000));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || "دسترسی Clipboard رد شد." };
      }
    })().then(sendResponse);
    return true;
  }
  return false;
});

chrome.runtime.onSuspend?.addListener(() => {
  stopActiveSession({ userInitiated: false }).catch(() => {});
});
