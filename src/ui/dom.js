/** Tiny DOM helpers shared by the popup, the options page and the voice console. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // only used with escaped/static content
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function on(node, event, handler, options) {
  node.addEventListener(event, handler, options);
  return () => node.removeEventListener(event, handler, options);
}

export function toastHost() {
  let host = $('#vt-toasts');
  if (!host) {
    host = el('div', { id: 'vt-toasts', class: 'vt-toasts' });
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, level = 'info', timeout = 4200) {
  const host = toastHost();
  const node = el('div', { class: `alert ${level}`, text: message });
  host.appendChild(node);
  setTimeout(() => node.remove(), timeout);
  return node;
}

export function copyToClipboard(text) {
  if (!text) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
}

export function formatTime(iso) {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return iso;
  }
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} ساعت و ${m} دقیقه`;
  if (m) return `${m} دقیقه و ${s} ثانیه`;
  return `${s} ثانیه`;
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export const STATE_LABEL_FA = {
  idle: 'آماده',
  starting: 'در حال آماده‌سازی',
  listening: 'در حال گوش دادن',
  speech: 'در حال شنیدن گفتار',
  processing: 'در حال پردازش',
  inserting: 'در حال درج متن',
  stopping: 'در حال توقف',
  error: 'خطا',
  'mic-denied': 'دسترسی میکروفون رد شده',
  'mic-unavailable': 'میکروفون در دسترس نیست',
  unsupported: 'پشتیبانی نمی‌شود'
};
