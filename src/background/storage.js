/**
 * Persistence for history / logs / stats.
 * All reads are defensive: a corrupted or hostile storage payload must never break dictation.
 */
import { HISTORY_KEY, LOGS_KEY, STATS_KEY, SESSION_KEY, MAX_LOG_ENTRIES, HISTORY_LIMIT_MAX } from '../common/constants.js';
import { readRaw, writeRaw, removeRaw } from '../common/settings.js';
import { uid, clamp } from '../common/util.js';

export async function getHistory() {
  const raw = await readRaw(HISTORY_KEY, []);
  return Array.isArray(raw) ? raw.filter((e) => e && typeof e.text === 'string') : [];
}

export async function addHistoryEntry({ text, lang, engine, meta }, settings) {
  if (!settings?.history?.enabled) return null;
  const clean = String(text || '').trim();
  if (!clean) return null;
  if (settings.history.limit === 0) return null;

  const entry = {
    id: uid('h'),
    at: new Date().toISOString(),
    text: clean.slice(0, 20000),
    chars: clean.length,
    lang: lang || 'unknown',
    engine: engine || 'webspeech',
    mixed: Boolean(meta?.detected?.mixed)
  };
  const history = await getHistory();
  history.unshift(entry);
  const limit = clamp(Number(settings.history.limit) || 100, 0, HISTORY_LIMIT_MAX);
  await writeRaw(HISTORY_KEY, history.slice(0, limit));
  return entry;
}

export async function clearHistory() {
  await removeRaw(HISTORY_KEY);
  return true;
}

export async function pruneHistory(settings) {
  const history = await getHistory();
  const limit = clamp(Number(settings?.history?.limit) || 100, 0, HISTORY_LIMIT_MAX);
  if (history.length <= limit) return history;
  const trimmed = history.slice(0, limit);
  await writeRaw(HISTORY_KEY, trimmed);
  return trimmed;
}

export async function getLogs() {
  const raw = await readRaw(LOGS_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

export async function appendLog(entry, settings) {
  if (!settings?.debug?.enabled || !settings.debug.keepLogs) return;
  const logs = await getLogs();
  logs.push(entry);
  const limit = clamp(Number(settings.debug.logLimit) || 300, 20, MAX_LOG_ENTRIES);
  await writeRaw(LOGS_KEY, logs.slice(-limit));
}

export async function clearLogs() {
  await removeRaw(LOGS_KEY);
  return true;
}

export async function getStats() {
  const raw = await readRaw(STATS_KEY, null);
  return {
    sessions: 0,
    dictationMs: 0,
    chars: 0,
    finals: 0,
    errors: 0,
    languageSwitches: 0,
    ...(raw && typeof raw === 'object' ? raw : {})
  };
}

export async function bumpStats(patch) {
  const stats = await getStats();
  for (const [key, value] of Object.entries(patch || {})) {
    stats[key] = clamp((Number(stats[key]) || 0) + (Number(value) || 0), 0, Number.MAX_SAFE_INTEGER);
  }
  await writeRaw(STATS_KEY, stats);
  return stats;
}

export async function resetStats() {
  await writeRaw(STATS_KEY, { sessions: 0, dictationMs: 0, chars: 0, finals: 0, errors: 0, languageSwitches: 0 });
}

export async function getPersistedSession() {
  const raw = await readRaw(SESSION_KEY, null);
  return raw && typeof raw === 'object' ? raw : null;
}

export async function persistSession(session) {
  await writeRaw(SESSION_KEY, session);
}
