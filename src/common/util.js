/** Small dependency-free helpers shared by all contexts. */

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural, prototype-pollution-safe deep merge (source wins). */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return clone(base);
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) => (isPlainObject(v) ? clone(v) : v));
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

export function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, waitMs);
  };
}

export function throttle(fn, waitMs) {
  let last = 0;
  let pending = null;
  return (...args) => {
    const now = Date.now();
    if (now - last >= waitMs) {
      last = now;
      fn(...args);
    } else if (!pending) {
      pending = setTimeout(() => {
        pending = null;
        last = Date.now();
        fn(...args);
      }, waitMs - (now - last));
    }
  };
}

export function truncate(str, max) {
  if (typeof str !== 'string') return '';
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/**
 * Levenshtein distance with an early bail-out: returns `max + 1` as soon as the
 * best possible distance exceeds `max`. Used by fuzzy term matching.
 */
export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j += 1) prev[j] = j;
  for (let i = 1; i <= al; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[bl];
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function safeString(value, max = 100000) {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}
