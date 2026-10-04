/**
 * Settings schema, defaults, validation and storage helpers.
 * Single source of truth shared by the service worker, the options page and the popup
 * (the content script only receives the small subset it needs).
 */
import { deepMerge, clamp, uid, safeString } from './util.js';
import { HISTORY_LIMIT_MAX, DICTIONARY_LIMIT_MAX, MAX_LOG_ENTRIES } from './constants.js';
import { ENGINES } from './constants.js';

export const SETTINGS_KEY = 'vt.settings.v1';
export const HISTORY_KEY = 'vt.history.v1';
export const LOGS_KEY = 'vt.logs.v1';
export const STATS_KEY = 'vt.stats.v1';
export const SESSION_KEY = 'vt.session.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  language: {
    mode: 'auto',                 // 'auto' | 'manual'
    manualLang: 'fa-IR',
    autoDetect: true,
    fallbackLang: 'fa-IR',
    switchConfidence: 0.55,
    minWordsForSwitch: 2,
    stickyWithinSession: true,     // keep the engine language once a session switched
    dualEngine: false,             // experimental two-engine mode for heavy code-switching
    candidates: ['fa-IR', 'en-US', 'ar-SA']
  },
  recognition: {
    engine: ENGINES.WEBSPEECH,
    continuous: true,
    interimResults: true,
    autoRestart: true,
    maxRestarts: 15,
    restartDelayMs: 250,
    noSpeechRestartDelayMs: 900,
    silenceFinalizeMs: 1600,      // ask the engine to finalise after this much silence
    maxSessionMinutes: 120,
    processLocally: false         // Web Speech on-device packs (no Persian support today)
  },
  text: {
    normalize: true,
    persianChars: true,           // ي/ك → ی/ک
    persianHalfSpace: true,
    persianDigits: 'persian',     // 'persian' | 'english' | 'keep'
    autoCapitalize: true,
    preserveEnglishWords: true,   // the flagship feature: ری‌اکت → React
    englishizeGenericTerms: false,
    fuzzyMatch: true,
    numbers: { enabled: true, expandScales: false },
    punctuation: { enabled: true, level: 'safe' } // 'safe' | 'balanced' | 'aggressive'
  },
  commands: {
    enabled: true,
    strict: false,          // true => commands only when the whole utterance is a command
    allowTrailing: true
  },
  dictionary: {
    rules: [],   // [{ id, pattern, replacement, mode:'word'|'substring'|'compact'|'regex', caseSensitive, enabled }]
    terms: []    // [{ term, kind:'proper'|'generic', category, fa:[], en:[] }]
  },
  whisper: {
    enabled: false,
    endpoint: '',            // e.g. https://api.openai.com/v1/audio/transcriptions
    apiKey: '',
    model: 'whisper-1',
    prompt: '',
    chunkSeconds: 3,
    overlapSeconds: 0.6,
    timeoutMs: 25000,
    vadThreshold: 0.012,
    preferForMixedLanguage: true
  },
  ui: {
    floating: true,
    floatingPosition: { x: 24, y: 24 },   // px from bottom-right
    floatingMinimized: false,
    floatingHidden: false,
    showInterim: true,
    showLanguageBadge: true,
    theme: 'auto',                         // 'auto' | 'light' | 'dark'
    playSoundOnToggle: false
  },
  history: { enabled: true, limit: 100 },
  debug: { enabled: false, verbose: false, keepLogs: true, logLimit: 300 },
  onboarding: { completed: false, micTestPassed: false }
});

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** Validate + normalize an arbitrary object into a safe settings object. */
export function sanitizeSettings(input) {
  const merged = deepMerge(DEFAULT_SETTINGS, input && typeof input === 'object' ? input : {});
  const s = merged;

  s.version = 1;
  s.language.mode = pickEnum(s.language.mode, ['auto', 'manual'], 'auto');
  s.language.manualLang = safeString(s.language.manualLang, 16) || 'fa-IR';
  s.language.fallbackLang = safeString(s.language.fallbackLang, 16) || 'fa-IR';
  s.language.switchConfidence = clamp(Number(s.language.switchConfidence) || 0.55, 0.2, 0.95);
  s.language.minWordsForSwitch = clamp(Math.round(Number(s.language.minWordsForSwitch) || 2), 1, 8);
  s.language.dualEngine = Boolean(s.language.dualEngine);
  s.language.stickyWithinSession = s.language.stickyWithinSession !== false;
  s.language.candidates = Array.isArray(s.language.candidates) && s.language.candidates.length
    ? s.language.candidates.map((c) => safeString(c, 16)).filter(Boolean).slice(0, 8)
    : ['fa-IR', 'en-US', 'ar-SA'];

  s.recognition.engine = pickEnum(s.recognition.engine, Object.values(ENGINES), ENGINES.WEBSPEECH);
  s.recognition.continuous = s.recognition.continuous !== false;
  s.recognition.interimResults = s.recognition.interimResults !== false;
  s.recognition.autoRestart = s.recognition.autoRestart !== false;
  s.recognition.maxRestarts = clamp(Math.round(Number(s.recognition.maxRestarts) || 15), 0, 100);
  s.recognition.restartDelayMs = clamp(Math.round(Number(s.recognition.restartDelayMs) || 250), 0, 5000);
  s.recognition.noSpeechRestartDelayMs = clamp(Math.round(Number(s.recognition.noSpeechRestartDelayMs) || 900), 0, 10000);
  s.recognition.silenceFinalizeMs = clamp(Math.round(Number(s.recognition.silenceFinalizeMs) || 1600), 500, 10000);
  s.recognition.maxSessionMinutes = clamp(Math.round(Number(s.recognition.maxSessionMinutes) || 120), 1, 480);
  s.recognition.processLocally = Boolean(s.recognition.processLocally);

  s.text.persianDigits = pickEnum(s.text.persianDigits, ['persian', 'english', 'keep'], 'persian');
  s.text.punctuation.level = pickEnum(s.text.punctuation.level, ['safe', 'balanced', 'aggressive'], 'safe');
  s.text.punctuation.enabled = s.text.punctuation.enabled !== false;
  s.text.numbers.enabled = s.text.numbers.enabled !== false;
  s.text.numbers.expandScales = Boolean(s.text.numbers.expandScales);
  for (const key of ['normalize', 'persianChars', 'persianHalfSpace', 'autoCapitalize', 'preserveEnglishWords', 'englishizeGenericTerms', 'fuzzyMatch']) {
    s.text[key] = s.text[key] !== false;
  }

  s.commands.enabled = s.commands.enabled !== false;
  s.commands.strict = Boolean(s.commands.strict);
  s.commands.allowTrailing = s.commands.allowTrailing !== false;

  s.dictionary.rules = (Array.isArray(s.dictionary.rules) ? s.dictionary.rules : [])
    .slice(0, 500)
    .map((r) => ({
      id: safeString(r?.id, 40) || uid('rule'),
      pattern: safeString(r?.pattern, 200),
      replacement: safeString(r?.replacement, 200),
      mode: pickEnum(r?.mode, ['word', 'substring', 'compact', 'regex'], 'word'),
      caseSensitive: Boolean(r?.caseSensitive),
      enabled: r?.enabled !== false
    }))
    .filter((r) => r.pattern.length > 0);

  s.dictionary.terms = (Array.isArray(s.dictionary.terms) ? s.dictionary.terms : [])
    .slice(0, DICTIONARY_LIMIT_MAX)
    .map((t) => ({
      term: safeString(t?.term, 80),
      kind: pickEnum(t?.kind, ['proper', 'generic'], 'proper'),
      category: safeString(t?.category, 40) || 'custom',
      fa: Array.isArray(t?.fa) ? t.fa.map((a) => safeString(a, 80)).filter(Boolean).slice(0, 12) : [],
      en: Array.isArray(t?.en) ? t.en.map((a) => safeString(a, 80).toLowerCase()).filter(Boolean).slice(0, 12) : []
    }))
    .filter((t) => t.term.length > 0);

  s.whisper.endpoint = safeString(s.whisper.endpoint, 500);
  s.whisper.apiKey = safeString(s.whisper.apiKey, 400);
  s.whisper.model = safeString(s.whisper.model, 80) || 'whisper-1';
  s.whisper.prompt = safeString(s.whisper.prompt, 600);
  s.whisper.chunkSeconds = clamp(Number(s.whisper.chunkSeconds) || 3, 1, 30);
  s.whisper.overlapSeconds = clamp(Number(s.whisper.overlapSeconds) || 0.6, 0, 5);
  s.whisper.timeoutMs = clamp(Math.round(Number(s.whisper.timeoutMs) || 25000), 2000, 120000);
  s.whisper.vadThreshold = clamp(Number(s.whisper.vadThreshold) || 0.012, 0.001, 0.2);
  s.whisper.enabled = Boolean(s.whisper.enabled);
  s.whisper.preferForMixedLanguage = s.whisper.preferForMixedLanguage !== false;

  s.ui.floating = s.ui.floating !== false;
  s.ui.showInterim = s.ui.showInterim !== false;
  s.ui.showLanguageBadge = s.ui.showLanguageBadge !== false;
  s.ui.theme = pickEnum(s.ui.theme, ['auto', 'light', 'dark'], 'auto');
  s.ui.floatingMinimized = Boolean(s.ui.floatingMinimized);
  s.ui.floatingHidden = Boolean(s.ui.floatingHidden);
  s.ui.playSoundOnToggle = Boolean(s.ui.playSoundOnToggle);
  const pos = s.ui.floatingPosition || {};
  s.ui.floatingPosition = {
    x: clamp(Math.round(Number(pos.x) || 24), 0, 4000),
    y: clamp(Math.round(Number(pos.y) || 24), 0, 4000)
  };

  s.history.enabled = s.history.enabled !== false;
  s.history.limit = clamp(Math.round(Number(s.history.limit) || 100), 0, HISTORY_LIMIT_MAX);

  s.debug.enabled = Boolean(s.debug.enabled);
  s.debug.verbose = Boolean(s.debug.verbose);
  s.debug.logLimit = clamp(Math.round(Number(s.debug.logLimit) || 300), 20, MAX_LOG_ENTRIES);

  return s;
}

export function diffSettings(a, b) {
  const keys = [];
  const walk = (x, y, path) => {
    for (const key of Object.keys(y)) {
      const next = `${path}${path ? '.' : ''}${key}`;
      const xv = x ? x[key] : undefined;
      const yv = y[key];
      if (yv && typeof yv === 'object' && !Array.isArray(yv)) walk(xv, yv, next);
      else if (JSON.stringify(xv) !== JSON.stringify(yv)) keys.push(next);
    }
  };
  walk(a, b, '');
  return keys;
}

/** Settings the content script cares about (keeps message payloads small). */
export function contentSettings(settings) {
  return {
    floating: settings.ui.floating && !settings.ui.floatingHidden,
    floatingMinimized: settings.ui.floatingMinimized,
    floatingPosition: settings.ui.floatingPosition,
    showInterim: settings.ui.showInterim,
    showLanguageBadge: settings.ui.showLanguageBadge,
    theme: settings.ui.theme,
    language: {
      mode: settings.language.mode,
      manualLang: settings.language.manualLang,
      fallbackLang: settings.language.fallbackLang
    },
    debug: { enabled: settings.debug.enabled }
  };
}

/* ------------------------------------------------------------------ *
 * Storage helpers (chrome.storage.local) with a memory fallback so the
 * modules stay unit-testable outside a browser.
 * ------------------------------------------------------------------ */

const memory = new Map();

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

export async function readRaw(key, fallback = null) {
  if (hasChromeStorage()) {
    const res = await chrome.storage.local.get(key);
    return res[key] === undefined ? fallback : res[key];
  }
  return memory.has(key) ? memory.get(key) : fallback;
}

export async function writeRaw(key, value) {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [key]: value });
    return true;
  }
  memory.set(key, value);
  return true;
}

export async function removeRaw(key) {
  if (hasChromeStorage()) await chrome.storage.local.remove(key);
  else memory.delete(key);
}

export async function loadSettings() {
  const raw = await readRaw(SETTINGS_KEY, null);
  return sanitizeSettings(raw || {});
}

export async function saveSettings(settings) {
  const clean = sanitizeSettings(settings);
  await writeRaw(SETTINGS_KEY, clean);
  return clean;
}

/** Patch only a subtree of the settings (used by the popup/options forms). */
export async function patchSettings(patch) {
  const current = await loadSettings();
  const next = sanitizeSettings(deepMerge(current, patch));
  await writeRaw(SETTINGS_KEY, next);
  return next;
}

export async function resetSettings() {
  await writeRaw(SETTINGS_KEY, DEFAULT_SETTINGS);
  return sanitizeSettings({});
}

export function exportSettingsPayload(settings) {
  return {
    app: 'VoiceType Pro',
    schema: 1,
    exportedAt: new Date().toISOString(),
    settings: sanitizeSettings(settings)
  };
}

export function importSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-payload');
  const incoming = payload.settings || payload;
  return sanitizeSettings(incoming);
}
