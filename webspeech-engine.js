import { getSpeechErrorMessage, getWebSpeechLanguage } from "./shared.js";

export class WebSpeechEngine {
  constructor({ Recognition, settings, onInterim, onUtterance, onState, onError, onSessionEnd, restartDelayMs = 150 }) {
    this.Recognition = Recognition;
    this.settings = settings;
    this.onInterim = onInterim;
    this.onUtterance = onUtterance;
    this.onState = onState;
    this.onError = onError;
    this.onSessionEnd = onSessionEnd;
    this.restartDelayMs = restartDelayMs;
    this.recognition = null;
    this.active = false;
    this.finalBuffer = "";
    this.interimBuffer = "";
    this.flushTimer = null;
    this.restartTimer = null;
    this.stoppedByUser = false;
    this.restartCount = 0;
    this.restartAttempts = 0;
  }

  start() {
    if (!this.Recognition) throw Object.assign(new Error("Speech Recognition پشتیبانی نمی‌شود."), { name: "unsupported" });
    this.stoppedByUser = false;
    this.active = true;
    this.startRecognition();
  }

  startRecognition() {
    if (!this.active || this.stoppedByUser) return;
    const recognition = new this.Recognition();
    this.recognition = recognition;
    recognition.lang = getWebSpeechLanguage(this.settings.language);
    recognition.continuous = Boolean(this.settings.continuousMode);
    recognition.interimResults = Boolean(this.settings.interimResults);
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (this.recognition !== recognition || !this.active) return;
      this.restartAttempts = 0;
      this.onState("listening", {
        engine: "webspeech",
        limitation: "استفاده از SpeechRecognition داخلی Chrome است؛ پردازش ممکن است به سرویس گفتار Google وابسته باشد و تشخیص code-switch فارسی/English/عربی تضمین نمی‌شود."
      });
    };
    recognition.onresult = (event) => {
      if (this.recognition !== recognition || !this.active) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript || "";
        if (result.isFinal) this.finalBuffer = (this.finalBuffer + transcript).slice(-8000);
        else interim += transcript;
      }
      this.interimBuffer = interim.slice(-4000);
      this.onInterim(this.finalBuffer + this.interimBuffer, null);
      if (this.finalBuffer.trim()) {
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), 700);
      }
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition || !this.active) return;
      const code = event.error || "unknown";
      const fatal = ["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(code);
      this.onError(getSpeechErrorMessage(code), { code, recoverable: !fatal });
      if (fatal) this.stop(false);
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      const hadTranscript = this.flush();
      if (this.stoppedByUser || !this.active) return;
      if (!this.settings.autoRestart || !this.settings.continuousMode) {
        this.active = false;
        this.onSessionEnd({ hadTranscript });
        return;
      }
      this.restartCount++;
      this.onState("reconnecting", { engine: "webspeech", restartCount: this.restartCount });
      // Chrome may finish a recognition object after silence. Create a fresh object quickly;
      // reusing an ended object can silently fail in some Chrome builds.
      this.scheduleRestart(this.restartDelayMs);
    };

    try {
      recognition.start();
    } catch (error) {
      if (this.recognition === recognition) this.recognition = null;
      throw error;
    }
  }

  scheduleRestart(delay) {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.active || this.stoppedByUser) return;
      try {
        this.startRecognition();
      } catch (error) {
        if (!this.active || this.stoppedByUser) return;
        const code = error?.name || "unknown";
        const fatal = ["NotAllowedError", "SecurityError"].includes(code);
        this.onError(getSpeechErrorMessage(code), { code, recoverable: !fatal, restartCount: this.restartCount });
        if (fatal) {
          this.stop(false);
          return;
        }
        this.restartAttempts++;
        const retryDelay = Math.min(this.restartDelayMs * (2 ** Math.min(this.restartAttempts, 3)), 1200);
        this.scheduleRestart(retryDelay);
      }
    }, delay);
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
    const recognition = this.recognition;
    this.recognition = null;
    this.flush();
    try { recognition?.stop(); } catch { /* recognition may already be stopped */ }
  }
}
