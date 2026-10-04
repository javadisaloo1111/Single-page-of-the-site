/**
 * VoiceType Pro — shared constants.
 * Pure module: safe to import from the service worker, the offscreen document,
 * content scripts (via a bundled copy) and Node tests.
 */

/** Extension-wide message types. Anything not listed here is rejected by the message bus. */
export const MSG = Object.freeze({
  // ---- popup / options / voice-console  ->  service worker ----
  PING: 'ping',
  GET_STATE: 'get-state',
  GET_SETTINGS: 'get-settings',
  SET_SETTINGS: 'set-settings',
  RESET_SETTINGS: 'reset-settings',
  EXPORT_SETTINGS: 'export-settings',
  IMPORT_SETTINGS: 'import-settings',
  START_DICTATION: 'start-dictation',
  STOP_DICTATION: 'stop-dictation',
  CANCEL_DICTATION: 'cancel-dictation',
  TOGGLE_DICTATION: 'toggle-dictation',
  INSERT_LAST: 'insert-last',
  COPY_LAST: 'copy-last',
  GET_HISTORY: 'get-history',
  CLEAR_HISTORY: 'clear-history',
  GET_LOGS: 'get-logs',
  CLEAR_LOGS: 'clear-logs',
  MIC_QUERY: 'mic-query',
  MIC_REQUEST: 'mic-request',
  MIC_TEST: 'mic-test',
  DIAGNOSTICS: 'diagnostics',
  WHISPER_TEST: 'whisper-test',
  ON_DEVICE_CHECK: 'on-device-check',
  OPEN_OPTIONS: 'open-options',
  OPEN_SHORTCUTS: 'open-shortcuts',
  OPEN_VOICE_CONSOLE: 'open-voice-console',

  // ---- service worker  ->  offscreen document ----
  OFF_START: 'off:start',
  OFF_STOP: 'off:stop',
  OFF_ABORT: 'off:abort',
  OFF_SETTINGS: 'off:settings',
  OFF_PING: 'off:ping',
  OFF_MIC_TEST: 'off:mic-test',
  OFF_MIC_QUERY: 'off:mic-query',
  OFF_WHISPER_TEST: 'off:whisper-test',
  OFF_ON_DEVICE_CHECK: 'off:on-device-check',
  OFF_DIAGNOSTICS: 'off:diagnostics',

  // ---- offscreen document  ->  service worker ----
  OFF_EVENT: 'off:event', // state | interim | final | error | log | mic | diagnostics
  OFF_READY: 'off:ready',

  // ---- service worker  ->  content script ----
  CS_CONF: 'cs:conf',
  CS_STATE: 'cs:state',
  CS_INSERT: 'cs:insert',
  CS_INTERIM: 'cs:interim',
  CS_INTERIM_CLEAR: 'cs:interim-clear',
  CS_EXEC: 'cs:exec',
  CS_TOAST: 'cs:toast',
  CS_PING: 'cs:ping',
  CS_RECOGNIZE_TOGGLE: 'cs:recognize-toggle',

  // ---- content script  ->  service worker ----
  CS_READY: 'cs:ready',
  CS_FOCUS: 'cs:focus',
  CS_EDIT_RESULT: 'cs:edit-result',
  CS_CONTEXT: 'cs:context',
  CS_LOG: 'cs:log',
  CS_SHORTCUT: 'cs:shortcut'
});

/** Dictation lifecycle states (single source of truth for UI dots/badges). */
export const STATE = Object.freeze({
  IDLE: 'idle',                 // ⚪ Ready
  STARTING: 'starting',         // 🟡 warming up (engine + mic)
  LISTENING: 'listening',       // 🔴 Listening
  SPEECH: 'speech',             // 🔴 Listening (speech detected)
  PROCESSING: 'processing',     // 🟠 flushing engine buffer / waiting on server
  INSERTING: 'inserting',       // 🔵 typing into the page
  STOPPING: 'stopping',
  ERROR: 'error',
  MIC_DENIED: 'mic-denied',     // microphone permission refused
  MIC_UNAVAILABLE: 'mic-unavailable', // no device / busy / hardware error
  UNSUPPORTED: 'unsupported'    // browser has no Web Speech API
});

export const STATE_LABEL_FA = Object.freeze({
  [STATE.IDLE]: 'آماده',
  [STATE.STARTING]: 'در حال آماده‌سازی',
  [STATE.LISTENING]: 'در حال گوش دادن',
  [STATE.SPEECH]: 'در حال شنیدن گفتار',
  [STATE.PROCESSING]: 'در حال پردازش',
  [STATE.INSERTING]: 'در حال درج متن',
  [STATE.STOPPING]: 'در حال توقف',
  [STATE.ERROR]: 'خطا',
  [STATE.MIC_DENIED]: 'دسترسی میکروفون رد شده',
  [STATE.MIC_UNAVAILABLE]: 'میکروفون در دسترس نیست',
  [STATE.UNSUPPORTED]: 'مرورگر پشتیبانی نمی‌کند'
});

/** Machine readable error codes -> user friendly Persian/English messages. */
export const ERR = Object.freeze({
  MIC_DENIED: 'mic-denied',
  MIC_UNAVAILABLE: 'mic-unavailable',
  MIC_BUSY: 'mic-busy',
  MIC_CONSTRAINTS: 'mic-constraints',
  UNSUPPORTED: 'unsupported',
  RECOGNITION_NETWORK: 'recognition-network',
  RECOGNITION_NO_SPEECH: 'recognition-no-speech',
  RECOGNITION_AUDIO_CAPTURE: 'recognition-audio-capture',
  RECOGNITION_ABORTED: 'recognition-aborted',
  RECOGNITION_LANGUAGE: 'recognition-language-unsupported',
  RECOGNITION_NOT_ALLOWED: 'recognition-not-allowed',
  RECOGNITION_SERVICE: 'recognition-service-not-allowed',
  RECOGNITION_UNKNOWN: 'recognition-unknown',
  RESTART_FAILED: 'restart-failed',
  ENGINE_TIMEOUT: 'engine-timeout',
  WHISPER_HTTP: 'whisper-http',
  WHISPER_NETWORK: 'whisper-network',
  WHISPER_CONFIG: 'whisper-config',
  NO_TARGET: 'no-editable-target',
  INSERTION_FAILED: 'insertion-failed',
  INTERNAL: 'internal-error'
});

export const ERR_MESSAGE_FA = Object.freeze({
  [ERR.MIC_DENIED]: 'دسترسی به میکروفون فعال نیست. از تنظیمات مرورگر اجازه دسترسی بدهید.',
  [ERR.MIC_UNAVAILABLE]: 'میکروفونی پیدا نشد یا در دسترس نیست. اتصال دستگاه صوتی را بررسی کنید.',
  [ERR.MIC_BUSY]: 'میکروفون توسط برنامه دیگری در حال استفاده است.',
  [ERR.MIC_CONSTRAINTS]: 'تنظیمات درخواستی میکروفون توسط دستگاه پشتیبانی نمی‌شود.',
  [ERR.UNSUPPORTED]: 'مرورگر شما از Web Speech API پشتیبانی نمی‌کند. از Chrome نسخه ۱۱۶ یا بالاتر استفاده کنید.',
  [ERR.RECOGNITION_NETWORK]: 'ارتباط با سرویس تشخیص گفتار قطع شد. اتصال اینترنت را بررسی کنید.',
  [ERR.RECOGNITION_NO_SPEECH]: 'گفتاری شنیده نشد.',
  [ERR.RECOGNITION_AUDIO_CAPTURE]: 'ضبط صدا با مشکل مواجه شد. میکروفون را بررسی کنید.',
  [ERR.RECOGNITION_ABORTED]: 'تشخیص گفتار لغو شد.',
  [ERR.RECOGNITION_LANGUAGE]: 'زبان انتخاب‌شده برای تشخیص گفتار پشتیبانی نمی‌شود.',
  [ERR.RECOGNITION_NOT_ALLOWED]: 'برای شروع، ابتدا باید اجازه میکروفون داده شود.',
  [ERR.RECOGNITION_SERVICE]: 'سرویس تشخیص گفتار مجاز نیست یا در دسترس نیست.',
  [ERR.RECOGNITION_UNKNOWN]: 'خطای نامشخص در تشخیص گفتار.',
  [ERR.RESTART_FAILED]: 'راه‌اندازی مجدد تشخیص گفتار پس از چند تلاش ناموفق بود.',
  [ERR.ENGINE_TIMEOUT]: 'پاسخی از موتور تشخیص گفتار دریافت نشد.',
  [ERR.WHISPER_HTTP]: 'سرور تبدیل گفتار پاسخ خطا برگرداند.',
  [ERR.WHISPER_NETWORK]: 'اتصال به سرور تبدیل گفتار برقرار نشد.',
  [ERR.WHISPER_CONFIG]: 'تنظیمات سرور تبدیل گفتار کامل نیست (آدرس سرور).',
  [ERR.NO_TARGET]: 'هیچ فیلد متنی فعالی برای درج متن پیدا نشد.',
  [ERR.INSERTION_FAILED]: 'درج متن در این عنصر امکان‌پذیر نبود.',
  [ERR.INTERNAL]: 'خطای داخلی افزونه.'
});

/** Recoverable errors: the engine may auto-restart. */
export const RECOVERABLE_ERRORS = Object.freeze([
  ERR.RECOGNITION_NO_SPEECH,
  ERR.RECOGNITION_ABORTED,
  ERR.RECOGNITION_NETWORK,
  ERR.RECOGNITION_AUDIO_CAPTURE,
  ERR.RECOGNITION_UNKNOWN
]);

/** Languages the UI offers out of the box (extendable at runtime). */
export const LANGUAGES = Object.freeze([
  { code: 'auto', label: 'Auto Detect', labelFa: 'تشخیص خودکار زبان', dir: 'auto' },
  { code: 'fa-IR', label: 'Persian', labelFa: 'فارسی', dir: 'rtl' },
  { code: 'en-US', label: 'English (US)', labelFa: 'انگلیسی (آمریکا)', dir: 'ltr' },
  { code: 'en-GB', label: 'English (UK)', labelFa: 'انگلیسی (بریتانیا)', dir: 'ltr' },
  { code: 'ar-SA', label: 'Arabic', labelFa: 'العربية', dir: 'rtl' },
  { code: 'tr-TR', label: 'Turkish', labelFa: 'ترکی', dir: 'ltr' },
  { code: 'fr-FR', label: 'French', labelFa: 'فرانسوی', dir: 'ltr' },
  { code: 'de-DE', label: 'German', labelFa: 'آلمانی', dir: 'ltr' },
  { code: 'es-ES', label: 'Spanish', labelFa: 'اسپانیایی', dir: 'ltr' },
  { code: 'ru-RU', label: 'Russian', labelFa: 'روسی', dir: 'ltr' },
  { code: 'hi-IN', label: 'Hindi', labelFa: 'هندی', dir: 'ltr' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)', labelFa: 'چینی', dir: 'ltr' },
  { code: 'ja-JP', label: 'Japanese', labelFa: 'ژاپنی', dir: 'ltr' },
  { code: 'ko-KR', label: 'Korean', labelFa: 'کره‌ای', dir: 'ltr' }
]);

/** Engine identifiers implemented by the extension. */
export const ENGINES = Object.freeze({
  WEBSPEECH: 'webspeech',
  WEBSPEECH_DUAL: 'webspeech-dual',
  HTTP_WHISPER: 'http-whisper',
  LOCAL_AI: 'local-ai'
});

export const ENGINE_LABEL_FA = Object.freeze({
  [ENGINES.WEBSPEECH]: 'Web Speech (Chrome) — سریع، نیازمند اینترنت',
  [ENGINES.WEBSPEECH_DUAL]: 'Web Speech دو‌موتوره (آزمایشی) — بهبود گفتار مخلوط',
  [ENGINES.HTTP_WHISPER]: 'Whisper روی سرور شما — دقیق‌ترین حالت چندزبانه',
  [ENGINES.LOCAL_AI]: 'مدل محلی درون مرورگر — در دست توسعه'
});

export const HISTORY_LIMIT_MAX = 1000;
export const DICTIONARY_LIMIT_MAX = 3000;
export const MAX_TEXT_CHUNK = 20000;      // hard cap for a single message payload (chars)
export const MAX_LOG_ENTRIES = 600;
export const SESSION_MAX_MS = 4 * 60 * 60 * 1000; // safety cap: 4h continuous dictation

/** Pages the content script must never attach UI to (browser internals / sensitive). */
export const BLOCKED_URL_PREFIXES = Object.freeze([
  'chrome://',
  'chrome-extension://',
  'devtools://',
  'edge://',
  'about:',
  'view-source:',
  'https://chrome.google.com/webstore',
  'https://chromewebstore.google.com'
]);
