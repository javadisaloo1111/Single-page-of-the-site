import { BUILTIN_VOCABULARY, getSpeechErrorMessage, getWebSpeechLanguage, sanitizeSettings } from "./shared.js";

let activeSession = null;
let startLock = null;
let lastInterimAt = 0;
let lastInterimText = "";
let pendingInterim = null;
let interimTimer = null;
const cancelledSessions = new Set();
const scheduledSessionStops = new Map();

function emit(type, payload = {}) {
  if (!activeSession && type !== "OFFSCREEN_ERROR") return;
  chrome.runtime.sendMessage({
    target: "background",
    type,
    sessionId: activeSession?.sessionId ?? payload.sessionId,
    ...payload
  }).catch(() => {});
}

function emitInterim(text, language, engine) {
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
  emit("OFFSCREEN_STATUS", { status, ...details });
}

function asFriendlyError(error) {
  const name = error?.name || error?.code || "unknown";
  if (/token broker|broker/i.test(error?.message || "")) return error.message;
  if (error?.message && name === "Error") return error.message;
  return getSpeechErrorMessage(name);
}

async function requestTemporaryKey(sessionId) {
  const response = await chrome.runtime.sendMessage({ type: "BROKER_GET_TEMP_KEY", sessionId });
  if (!response?.ok || !response.apiKey) throw new Error(response?.error || "پیکربندی امن Token Broker کامل نیست.");
  return response.apiKey;
}

function toPcm16(floatSamples) {
  const output = new Int16Array(floatSamples.length);
  for (let i = 0; i < floatSamples.length; i++) {
    const sample = Math.max(-1, Math.min(1, floatSamples[i]));
    output[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return output.buffer;
}

class SonioxRealtimeEngine {
  constructor({ apiKey, settings, onInterim, onUtterance, onState, onError, getFreshKey }) {
    this.apiKey = apiKey;
    this.settings = settings;
    this.onInterim = onInterim;
    this.onUtterance = onUtterance;
    this.onState = onState;
    this.onError = onError;
    this.getFreshKey = getFreshKey;
    this.socket = null;
    this.reconnectTimer = null;
    this.keepAliveTimer = null;
    this.stableTimer = null;
    this.stopping = false;
    this.closed = false;
    this.reconnectAttempts = 0;
    this.audioQueue = [];
    this.finalBuffer = "";
    this.interimBuffer = "";
    this.utteranceLanguages = new Set();
    this.finalizeWaiters = [];
    this.connectionGeneration = 0;
    this.lastAudioSentAt = Date.now();
    this.lastQueueWarningAt = 0;
  }

  async connect(apiKey = this.apiKey) {
    if (this.closed || this.stopping) throw new Error("نشست تشخیص گفتار بسته شده است.");
    this.apiKey = apiKey;
    const generation = ++this.connectionGeneration;
    this.onState(this.reconnectAttempts ? "reconnecting" : "connecting");

    return new Promise((resolve, reject) => {
      const socket = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket");
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      let settled = false;
      const failConnect = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);
        if (this.socket === socket) this.connectionGeneration++;
        reject(error instanceof Error ? error : new Error(String(error || "WebSocket connection failed.")));
      };
      const connectionTimeout = setTimeout(() => {
        failConnect(new Error("اتصال Soniox بیش از حد طول کشید."));
        try { socket.close(); } catch { /* no-op */ }
      }, 12000);

      socket.onopen = () => {
        if (generation !== this.connectionGeneration || this.closed || this.stopping) {
          try { socket.close(); } catch { /* no-op */ }
          failConnect(new Error("نشست تشخیص لغو شد."));
          return;
        }
        try {
          const languageHints = this.settings.language === "auto" ? ["fa", "en", "ar"] : [this.settings.language];
          const customTerms = this.settings.customVocabulary.flatMap((item) => [item.word, item.replacement]);
          const terms = [...new Set([...customTerms, ...BUILTIN_VOCABULARY].filter(Boolean))].slice(0, 80);
          socket.send(JSON.stringify({
            api_key: this.apiKey,
            model: "stt-rt-v5",
            audio_format: "pcm_s16le",
            sample_rate: 16000,
            num_channels: 1,
            language_hints: languageHints,
            language_hints_strict: false,
            enable_language_identification: true,
            enable_endpoint_detection: true,
            context: { general: [{ key: "domain", value: "Voice typing and software terminology" }], terms }
          }));
          clearTimeout(this.stableTimer);
          this.stableTimer = setTimeout(() => { this.reconnectAttempts = 0; }, 60_000);
          this.onState("listening", { engine: "soniox" });
          while (this.audioQueue.length && socket.readyState === WebSocket.OPEN) {
            socket.send(this.audioQueue.shift());
            this.lastAudioSentAt = Date.now();
          }
          clearInterval(this.keepAliveTimer);
          this.keepAliveTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN && Date.now() - this.lastAudioSentAt > 8000) {
              socket.send(JSON.stringify({ type: "keepalive" }));
            }
          }, 8000);
          settled = true;
          clearTimeout(connectionTimeout);
          resolve();
        } catch (error) {
          try { socket.close(); } catch { /* no-op */ }
          failConnect(error);
        }
      };

      socket.onmessage = (event) => {
        if (generation !== this.connectionGeneration || this.closed) return;
        let data;
        try { data = JSON.parse(event.data); }
        catch { return this.onError("پاسخ موتور گفتار قابل‌خواندن نبود.", { recoverable: true }); }
        if (data.error_code != null) {
          const errorText = `${data.error_type || data.error_code}: ${data.error_message || "خطای سرویس گفتار"}`;
          if (Number(data.error_code) === 401 || Number(data.error_code) === 403) {
            this.stopping = true;
            this.onState("error", { error: "کلید موقت نامعتبر یا منقضی شده است. Token Broker را بررسی کنید." });
            this.onError(errorText, { recoverable: false, code: data.error_code });
            socket.close();
            return;
          }
          this.onError(errorText, { recoverable: true, code: data.error_code });
        }
        const tokens = Array.isArray(data.tokens) ? data.tokens : [];
        let marker = false;
        let finMarker = false;
        let changed = false;
        let nextInterim = "";
        for (const token of tokens) {
          const tokenText = typeof token?.text === "string" ? token.text : "";
          if (!tokenText) continue;
          if (tokenText === "<end>" || tokenText === "<fin>") {
            marker = true;
            if (tokenText === "<fin>") finMarker = true;
            continue;
          }
          if (token.translation_status === "translation") continue;
          if (token.language) this.utteranceLanguages.add(token.language);
          if (token.is_final) {
            this.finalBuffer += tokenText;
            changed = true;
          } else {
            nextInterim += tokenText;
            changed = true;
          }
        }
        this.interimBuffer = nextInterim;
        const language = [...this.utteranceLanguages].join("+") || tokens.find((token) => token.language)?.language || null;
        if (changed) this.onInterim(this.finalBuffer + this.interimBuffer, language);
        if (marker) this.flushUtterance(language);
        if (finMarker) {
          for (const resolve of this.finalizeWaiters.splice(0)) resolve();
        }
        if (data.finished) {
          this.flushUtterance(language);
          if (!this.stopping && !this.closed) {
            this.scheduleReconnect("اتصال سرویس پایان یافت.");
            if (socket.readyState < WebSocket.CLOSING) socket.close(1000, "session finished");
          }
        }
      };

      socket.onerror = () => {
        const error = new Error("ارتباط WebSocket با موتور گفتار برقرار نشد.");
        if (!settled) failConnect(error);
        else if (!this.stopping && !this.closed) this.onError(error.message, { recoverable: true });
      };
      socket.onclose = (event) => {
        clearInterval(this.keepAliveTimer);
        clearTimeout(this.stableTimer);
        if (!settled) failConnect(new Error(event.reason || "اتصال اولیه به Soniox برقرار نشد."));
        if (generation !== this.connectionGeneration || this.closed || this.stopping) return;
        this.scheduleReconnect(event.reason || "اتصال سرویس قطع شد.");
      };
    });
  }

  flushUtterance(language = null) {
    const text = this.finalBuffer + this.interimBuffer;
    const languageLabel = [...this.utteranceLanguages].join("+") || language || null;
    this.finalBuffer = "";
    this.interimBuffer = "";
    this.utteranceLanguages.clear();
    if (!text.trim()) return;
    this.onUtterance(text, languageLabel);
    this.onInterim("", languageLabel);
  }

  sendAudio(buffer) {
    if (this.closed || this.stopping) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(buffer);
        this.lastAudioSentAt = Date.now();
        return;
      } catch { /* use bounded queue below */ }
    }
    this.audioQueue.push(buffer);
    // About six seconds at 50 ms per block. Never allow unbounded memory growth.
    if (this.audioQueue.length > 120) {
      this.audioQueue.shift();
      if (Date.now() - this.lastQueueWarningAt > 5000) {
        this.lastQueueWarningAt = Date.now();
        this.onError("اتصال کند است؛ بخشی از صدای موقت بافر حذف شد.", { recoverable: true });
      }
    }
  }

  scheduleReconnect(reason) {
    if (this.closed || this.stopping || this.reconnectTimer) return;
    if (!this.settings.autoRestart || this.reconnectAttempts >= 6) {
      this.onState("error", { error: reason || "اتصال تشخیص گفتار قطع شد." });
      this.onError(reason || "اتصال تشخیص گفتار قطع شد.", { recoverable: false });
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * (2 ** (this.reconnectAttempts - 1)), 15000);
    this.onState("reconnecting", { restartCount: this.reconnectAttempts });
    this.onError("اتصال قطع شد؛ تلاش برای اتصال مجدد…", { recoverable: true, restartCount: this.reconnectAttempts });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const freshKey = await this.getFreshKey();
        await this.connect(freshKey);
      } catch (error) {
        this.onError(asFriendlyError(error), { recoverable: true });
        this.scheduleReconnect(error?.message);
      }
    }, delay);
  }

  async stop() {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepAliveTimer);
    clearTimeout(this.stableTimer);
    this.onState("processing");
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      let timeout;
      try {
        while (this.audioQueue.length && socket.readyState === WebSocket.OPEN) socket.send(this.audioQueue.shift());
        socket.send(new ArrayBuffer(6400)); // 200 ms of mono 16 kHz PCM silence before finalization.
        await new Promise((resolve) => setTimeout(resolve, 200));
        const finalized = new Promise((resolve) => this.finalizeWaiters.push(resolve));
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "finalize" }));
        await Promise.race([finalized, new Promise((resolve) => { timeout = setTimeout(resolve, 1200); })]);
      } catch { /* finalization and closing are best-effort */ }
      finally { clearTimeout(timeout); this.finalizeWaiters.length = 0; }
    }
    this.flushUtterance();
    this.closed = true;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "user stopped");
  }

  destroy() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepAliveTimer);
    clearTimeout(this.stableTimer);
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close(1000, "cleanup");
    this.audioQueue.length = 0;
  }
}

class WebSpeechEngine {
  constructor({ settings, onInterim, onUtterance, onState, onError }) {
    this.settings = settings;
    this.onInterim = onInterim;
    this.onUtterance = onUtterance;
    this.onState = onState;
    this.onError = onError;
    this.recognition = null;
    this.active = false;
    this.finalBuffer = "";
    this.interimBuffer = "";
    this.flushTimer = null;
    this.restartTimer = null;
    this.stoppedByUser = false;
    this.restartCount = 0;
  }

  start() {
    const Recognition = self.SpeechRecognition || self.webkitSpeechRecognition;
    if (!Recognition) throw Object.assign(new Error("Speech Recognition پشتیبانی نمی‌شود."), { name: "unsupported" });
    this.stoppedByUser = false;
    this.active = true;
    this.recognition = new Recognition();
    this.recognition.lang = getWebSpeechLanguage(this.settings.language, navigator.language);
    this.recognition.continuous = Boolean(this.settings.continuousMode);
    this.recognition.interimResults = Boolean(this.settings.interimResults);
    this.recognition.maxAlternatives = 1;
    this.recognition.onstart = () => this.onState("listening", { engine: "webspeech", limitation: this.settings.language === "auto" ? "زبان fallback ثابت است؛ تشخیص Mixed Language تضمین نمی‌شود." : "Web Speech API؛ نتایج به زبان انتخاب‌شده وابسته‌اند." });
    this.recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript || "";
        if (result.isFinal) this.finalBuffer += transcript;
        else interim += transcript;
      }
      this.interimBuffer = interim;
      this.onInterim(this.finalBuffer + this.interimBuffer, null);
      if (this.finalBuffer.trim()) {
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), 700);
      }
    };
    this.recognition.onerror = (event) => {
      const code = event.error || "unknown";
      this.onError(getSpeechErrorMessage(code), { code, recoverable: !["not-allowed", "service-not-allowed", "audio-capture"].includes(code) });
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(code)) this.stop(false);
    };
    this.recognition.onend = () => {
      const hadTranscript = this.flush();
      if (this.stoppedByUser || !this.active) return;
      if (!this.settings.autoRestart || !this.settings.continuousMode) {
        this.active = false;
        scheduleSessionStop(activeSession?.sessionId, hadTranscript ? 150 : 0);
        return;
      }
      this.restartCount++;
      this.onState("reconnecting", { engine: "webspeech", restartCount: this.restartCount });
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        if (!this.active || this.stoppedByUser) return;
        try { this.recognition?.start(); }
        catch (error) {
          if (error?.name === "InvalidStateError") return;
          this.onError(getSpeechErrorMessage(error?.name), { recoverable: true });
        }
      }, Math.min(300 * this.restartCount, 2000));
    };
    this.recognition.start();
  }

  flush() {
    clearTimeout(this.flushTimer);
    const text = this.finalBuffer + this.interimBuffer;
    this.finalBuffer = "";
    this.interimBuffer = "";
    const hasText = Boolean(text.trim());
    if (hasText) this.onUtterance(text, null);
    this.onInterim("", null);
    return hasText;
  }

  stop(userInitiated = true) {
    this.stoppedByUser = userInitiated;
    this.active = false;
    clearTimeout(this.flushTimer);
    clearTimeout(this.restartTimer);
    this.flush();
    try { this.recognition?.stop(); } catch { /* recognition may already be stopped */ }
  }
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
  emit("OFFSCREEN_STATUS", { status: "stopping" });
  try {
    if (session.engineKind === "soniox") await session.engine.stop();
    else session.engine.stop(userInitiated);
  } catch { /* cleanup continues */ }
  if (session.audioNode) {
    try { session.audioNode.port.onmessage = null; session.audioNode.disconnect(); } catch { /* already disconnected */ }
  }
  if (session.source) {
    try { session.source.disconnect(); } catch { /* already disconnected */ }
  }
  if (session.stream) for (const track of session.stream.getTracks()) track.stop();
  if (session.audioContext && session.audioContext.state !== "closed") {
    try { await session.audioContext.close(); } catch { /* cleanup */ }
  }
  activeSession = null;
  if (notify) chrome.runtime.sendMessage({ target: "background", type: "OFFSCREEN_STATUS", sessionId: session.sessionId, status: "ready" }).catch(() => {});
  return { ok: true, status: "ready" };
}

async function startSoniox(sessionId, settings) {
  let stream = null;
  let audioContext = null;
  let source = null;
  let audioNode = null;
  let engine = null;
  try {
    const apiKey = await requestTemporaryKey(sessionId);
    if (cancelledSessions.has(sessionId)) throw new Error("شروع نشست لغو شد.");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
    } catch (error) {
      const friendly = new Error(getSpeechErrorMessage(error?.name));
      friendly.name = error?.name || "Error";
      throw friendly;
    }
    if (cancelledSessions.has(sessionId)) throw new Error("شروع نشست لغو شد.");
    try { audioContext = new AudioContext({ sampleRate: 16000 }); }
    catch { audioContext = new AudioContext(); }
    await audioContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js"));
    if (cancelledSessions.has(sessionId)) throw new Error("شروع نشست لغو شد.");
    source = audioContext.createMediaStreamSource(stream);
    audioNode = new AudioWorkletNode(audioContext, "vocatyp-pcm16", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    source.connect(audioNode);
    audioNode.connect(audioContext.destination);
    const callbacks = {
      onInterim: (text, language) => emitInterim(text, language, "soniox"),
      onUtterance: (text, language) => {
        emit("OFFSCREEN_UTTERANCE", { text, language, engine: "soniox", utteranceId: crypto.randomUUID() });
        if (!settings.continuousMode) scheduleSessionStop(sessionId, 150);
      },
      onState: (status, info = {}) => setEngineStatus(status, { engine: "soniox", ...info }),
      onError: (message, info = {}) => emit("OFFSCREEN_ERROR", { message, ...info }),
      getFreshKey: () => requestTemporaryKey(sessionId)
    };
    engine = new SonioxRealtimeEngine({ apiKey, settings, ...callbacks });
    activeSession = { sessionId, settings, status: "starting", engineKind: "soniox", engine, stream, audioContext, source, audioNode, startedAt: Date.now() };
    audioNode.port.onmessage = (event) => {
      if (activeSession?.sessionId !== sessionId) return;
      const samples = event.data?.samples;
      if (samples && samples.length) engine.sendAudio(toPcm16(samples));
    };
    await engine.connect(apiKey);
    if (cancelledSessions.has(sessionId)) throw new Error("شروع نشست لغو شد.");
  } catch (error) {
    if (activeSession?.sessionId === sessionId) {
      await stopActiveSession({ userInitiated: false, sessionId, notify: false });
    } else {
      engine?.destroy();
      try { if (audioNode) { audioNode.port.onmessage = null; audioNode.disconnect(); } } catch { /* cleanup */ }
      try { source?.disconnect(); } catch { /* cleanup */ }
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (audioContext && audioContext.state !== "closed") {
        try { await audioContext.close(); } catch { /* cleanup */ }
      }
    }
    throw error;
  }
}

async function startWebSpeech(sessionId, settings, fallbackReason = "") {
  const engine = new WebSpeechEngine({
    settings,
    onInterim: (text, language) => emitInterim(text, language, "webspeech"),
    onUtterance: (text, language) => {
      emit("OFFSCREEN_UTTERANCE", { text, language, engine: "webspeech", utteranceId: crypto.randomUUID() });
      if (!settings.continuousMode) scheduleSessionStop(sessionId, 150);
    },
    onState: (status, details = {}) => setEngineStatus(status, { ...details, engine: "webspeech", fallbackReason }),
    onError: (message, info = {}) => emit("OFFSCREEN_ERROR", { message, ...info })
  });
  activeSession = { sessionId, settings, status: "starting", engineKind: "webspeech", engine, startedAt: Date.now() };
  try {
    engine.start();
  } catch (error) {
    activeSession = null;
    throw error;
  }
  emit("OFFSCREEN_STATUS", {
    status: "listening", engine: "webspeech",
    fallbackReason: fallbackReason || "Web Speech API ممکن است به سرویس مرورگر وابسته باشد و Auto/Mixed Language را تضمین نمی‌کند."
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
    const hasBroker = Boolean(message.providerConfigured);

    if (settings.engine === "webspeech") {
      await startWebSpeech(sessionId, settings);
      if (cancelledSessions.has(sessionId)) { await stopActiveSession({ userInitiated: false, sessionId }); throw new Error("شروع نشست لغو شد."); }
      return { ok: true, status: "listening", engine: "webspeech" };
    }

    if (!hasBroker && settings.engine === "soniox") {
      throw new Error("برای Soniox، نشانی Token Broker و Access Token را در تنظیمات وارد کنید.");
    }

    if (hasBroker) {
      try {
        await startSoniox(sessionId, settings);
        if (cancelledSessions.has(sessionId)) { await stopActiveSession({ userInitiated: false, sessionId, notify: false }); throw new Error("شروع نشست لغو شد."); }
        return { ok: true, status: "listening", engine: "soniox" };
      } catch (error) {
        if (cancelledSessions.has(sessionId) || settings.engine === "soniox") throw error;
        if (error?.name && ["NotAllowedError", "NotFoundError", "NotReadableError"].includes(error.name)) throw error;
        await startWebSpeech(sessionId, settings, `Soniox در دسترس نبود: ${error?.message || "خطا"}`);
        if (cancelledSessions.has(sessionId)) { await stopActiveSession({ userInitiated: false, sessionId, notify: false }); throw new Error("شروع نشست لغو شد."); }
        return { ok: true, status: "listening", engine: "webspeech", fallback: true };
      }
    }

    await startWebSpeech(sessionId, settings, "Token Broker تنظیم نشده؛ در حالت مرورگر، تشخیص خودکار زبان و Code-switching تضمین نمی‌شود.");
    if (cancelledSessions.has(sessionId)) { await stopActiveSession({ userInitiated: false, sessionId, notify: false }); throw new Error("شروع نشست لغو شد."); }
    return { ok: true, status: "listening", engine: "webspeech", fallback: true };
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
