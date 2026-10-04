/**
 * Floating mini indicator (Shadow DOM — isolated from the page's CSS and from page scripts).
 *
 * Features: live status, interim preview, language badge, microphone level, drag & drop with
 * persisted position, minimize, hide, keyboard accessible controls, error toasts.
 * It is mounted only while dictation is relevant, so idle pages stay untouched.
 */
(function initFloating(VT) {
  if (VT.ui) return; // already injected
  const STATE_LABEL = {
    idle: 'آماده',
    starting: 'در حال آماده‌سازی',
    listening: 'در حال گوش دادن',
    speech: 'در حال شنیدن',
    processing: 'در حال پردازش',
    inserting: 'در حال درج متن',
    stopping: 'در حال توقف',
    error: 'خطا',
    'mic-denied': 'میکروفون رد شد',
    'mic-unavailable': 'میکروفون در دسترس نیست',
    unsupported: 'پشتیبانی نمی‌شود'
  };

  const ERROR_LABEL = {
    'mic-denied': 'دسترسی به میکروفون فعال نیست. از تنظیمات مرورگر اجازه دسترسی بدهید.',
    'mic-unavailable': 'میکروفونی پیدا نشد یا در دسترس نیست.',
    'mic-busy': 'میکروفون توسط برنامه دیگری در حال استفاده است.',
    'recognition-network': 'ارتباط با سرویس تشخیص گفتار قطع شد. اتصال اینترنت را بررسی کنید.',
    'engine-timeout': 'پاسخی از موتور تشخیص گفتار دریافت نشد.',
    'whisper-http': 'سرور تبدیل گفتار پاسخ خطا برگرداند.',
    'whisper-network': 'اتصال به سرور تبدیل گفتار برقرار نشد.',
    'whisper-config': 'آدرس سرور تبدیل گفتار در تنظیمات وارد نشده است.',
    'no-editable-target': 'فیلد متنی فعالی برای درج متن پیدا نشد — روی یک input کلیک کنید.',
    'insertion-failed': 'درج متن در این عنصر امکان‌پذیر نبود.',
    'unsupported': 'مرورگر شما از Web Speech API پشتیبانی نمی‌کند.'
  };

  const STYLE = `
    :host { all: initial; pointer-events: auto; }
    * { box-sizing: border-box; }
    .vt-wrap {
      position: fixed; z-index: 2147483646; direction: rtl;
      font-family: "Segoe UI", Tahoma, system-ui, -apple-system, sans-serif;
      user-select: none; -webkit-user-select: none;
    }
    .vt-pill {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 999px;
      background: rgba(22, 24, 29, 0.92); color: #f5f6f8;
      box-shadow: 0 6px 24px rgba(0,0,0,.28), 0 1px 2px rgba(0,0,0,.2);
      border: 1px solid rgba(255,255,255,.08);
      cursor: grab; font-size: 12.5px; line-height: 1.4; max-width: min(420px, 76vw);
      backdrop-filter: blur(10px); transition: opacity .16s ease, transform .16s ease;
    }
    .vt-pill:active { cursor: grabbing; }
    .vt-pill.compact { padding: 6px 8px; }
    .vt-wrap.light .vt-pill { background: rgba(255,255,255,.96); color: #17181c; border-color: rgba(0,0,0,.08); }
    .vt-dot { width: 9px; height: 9px; border-radius: 50%; background: #8b93a1; flex: 0 0 auto; }
    .vt-dot.listening, .vt-dot.speech { background: #ff4d4f; animation: vt-pulse 1.15s ease-in-out infinite; }
    .vt-dot.starting, .vt-dot.processing, .vt-dot.inserting, .vt-dot.stopping { background: #f5a524; }
    .vt-dot.error, .vt-dot.mic-denied, .vt-dot.mic-unavailable, .vt-dot.unsupported { background: #ff7a45; }
    @keyframes vt-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.8); } }
    .vt-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .vt-lang { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: rgba(255,255,255,.14); }
    .vt-wrap.light .vt-lang { background: rgba(0,0,0,.08); }
    .vt-lang.mixed { background: rgba(24,144,255,.28); }
    .vt-meter { width: 44px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.16); overflow: hidden; }
    .vt-meter > i { display: block; height: 100%; width: 0%; background: #4ade80; transition: width .08s linear; }
    .vt-btn {
      all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; font-size: 12px;
      background: rgba(255,255,255,.1); color: inherit; line-height: 1.6;
    }
    .vt-btn:hover { background: rgba(255,255,255,.2); }
    .vt-wrap.light .vt-btn { background: rgba(0,0,0,.06); }
    .vt-wrap.light .vt-btn:hover { background: rgba(0,0,0,.12); }
    .vt-interim {
      margin-top: 6px; padding: 7px 10px; border-radius: 10px;
      background: rgba(22,24,29,.94); color: #e9eaee; direction: auto;
      font-size: 13px; max-width: min(520px, 80vw); max-height: 130px; overflow: auto;
      border: 1px solid rgba(255,255,255,.08); box-shadow: 0 6px 24px rgba(0,0,0,.24);
      unicode-bidi: plaintext; text-align: start;
    }
    .vt-wrap.light .vt-interim { background: rgba(255,255,255,.97); color: #17181c; border-color: rgba(0,0,0,.08); }
    .vt-interim .vt-final { opacity: .72; }
    .vt-interim .vt-pending { font-weight: 600; }
    .vt-toast {
      margin-top: 6px; padding: 8px 10px; border-radius: 10px; max-width: min(460px, 80vw);
      background: rgba(159, 25, 25, .96); color: #fff; font-size: 12.5px; line-height: 1.7;
      box-shadow: 0 6px 24px rgba(0,0,0,.3);
    }
    .vt-toast.warn { background: rgba(146, 84, 8, .96); }
    .vt-toast.info { background: rgba(24, 60, 130, .96); }
    .vt-hidden { display: none !important; }
    .vt-min { display: none; }
    .vt-wrap.minimized .vt-expanded { display: none; }
    .vt-wrap.minimized .vt-min { display: inline-flex; align-items: center; gap: 6px; }
  `;

  const ui = {
    root: null,
    host: null,
    shadow: null,
    els: null,
    dragging: false,
    dragMoved: false,
    mountReason: '',

    isTopFrame() {
      return window.top === window;
    },

    shouldMount() {
      if (!this.isTopFrame()) {
        // in an iframe: only mount when the user is actually typing inside this frame
        return Boolean(VT.tracker?.host);
      }
      return true;
    },

    mount(force = false) {
      if (this.host && this.host.isConnected) return this.host;
      if (!force && !this.shouldMount()) return null;
      const position = VT.state.conf.floatingPosition || { x: 24, y: 24 };
      const host = document.createElement('div');
      host.id = VT.mountId;
      host.dataset.voicetype = 'root';
      host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLE;

      const wrap = document.createElement('div');
      wrap.className = 'vt-wrap';
      wrap.setAttribute('dir', 'rtl');
      wrap.style.right = `${position.x}px`;
      wrap.style.bottom = `${position.y}px`;
      wrap.innerHTML = `
        <div class="vt-pill" part="pill" role="status" aria-live="polite">
          <span class="vt-dot" part="dot"></span>
          <span class="vt-label">${STATE_LABEL.idle}</span>
          <span class="vt-lang vt-hidden" dir="ltr"></span>
          <span class="vt-meter"><i></i></span>
          <button class="vt-btn" data-action="toggle" title="شروع / توقف (Ctrl+Shift+Space)">شروع</button>
          <button class="vt-btn" data-action="copy" title="کپی آخرین متن">کپی</button>
          <button class="vt-btn" data-action="minimize" title="جمع کردن">–</button>
          <button class="vt-btn" data-action="hide" title="پنهان کردن">×</button>
          <span class="vt-min">
            <span class="vt-dot"></span>
            <span class="vt-label-min" style="display:none"></span>
          </span>
        </div>
        <div class="vt-expanded">
          <div class="vt-interim vt-hidden"></div>
          <div class="vt-toast vt-hidden" role="alert"></div>
        </div>
      `;

      shadow.append(style, wrap);
      (document.body || document.documentElement).appendChild(host);

      this.host = host;
      this.shadow = shadow;
      this.root = wrap;
      this.els = {
        wrap,
        pill: wrap.querySelector('.vt-pill'),
        dot: wrap.querySelector('.vt-dot'),
        label: wrap.querySelector('.vt-label'),
        lang: wrap.querySelector('.vt-lang'),
        meter: wrap.querySelector('.vt-meter > i'),
        interim: wrap.querySelector('.vt-interim'),
        toast: wrap.querySelector('.vt-toast'),
        toggle: wrap.querySelector('[data-action="toggle"]'),
        copy: wrap.querySelector('[data-action="copy"]'),
        minimize: wrap.querySelector('[data-action="minimize"]'),
        hide: wrap.querySelector('[data-action="hide"]')
      };

      this.bindEvents();
      this.render();
      return host;
    },

    bindEvents() {
      const { pill } = this.els;
      pill.addEventListener('pointerdown', (event) => this.startDrag(event));
      window.addEventListener('pointermove', (event) => this.onDrag(event), true);
      window.addEventListener('pointerup', () => this.endDrag(), true);

      this.shadow.addEventListener('click', (event) => {
        const action = event.target?.dataset?.action;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        this.handleAction(action);
      });
    },

    handleAction(action) {
      switch (action) {
        case 'toggle':
          VT.bridge?.send({ type: 'toggle-dictation' });
          break;
        case 'copy':
          VT.bridge?.send({ type: 'copy-last' });
          break;
        case 'minimize':
          this.setMinimized(!VT.state.conf.floatingMinimized);
          break;
        case 'hide':
          VT.bridge?.send({ type: 'set-settings', settings: { ui: { floatingHidden: true } } });
          this.unmount();
          break;
        default:
          break;
      }
    },

    startDrag(event) {
      if (event.button !== 0) return;
      this.dragging = true;
      this.dragMoved = false;
      const rect = this.root.getBoundingClientRect();
      this.dragOffset = { x: event.clientX - rect.right, y: event.clientY - rect.bottom };
      event.preventDefault();
    },

    onDrag(event) {
      if (!this.dragging || !this.root) return;
      const x = Math.max(0, Math.round(window.innerWidth - event.clientX + this.dragOffset.x));
      const y = Math.max(0, Math.round(window.innerHeight - event.clientY + this.dragOffset.y));
      this.dragMoved = true;
      this.root.style.right = `${x}px`;
      this.root.style.bottom = `${y}px`;
    },

    endDrag() {
      if (!this.dragging) return;
      this.dragging = false;
      if (!this.dragMoved || !this.root) return;
      const x = parseInt(this.root.style.right, 10) || 24;
      const y = parseInt(this.root.style.bottom, 10) || 24;
      VT.state.conf.floatingPosition = { x, y };
      VT.bridge?.send({ type: 'set-settings', settings: { ui: { floatingPosition: { x, y } } } });
    },

    setMinimized(minimized) {
      VT.state.conf.floatingMinimized = minimized;
      this.root?.classList.toggle('minimized', minimized);
      VT.bridge?.send({ type: 'set-settings', settings: { ui: { floatingMinimized: minimized } } });
    },

    unmount() {
      if (this.host) {
        try { this.host.remove(); } catch { /* noop */ }
      }
      this.host = null;
      this.shadow = null;
      this.root = null;
      this.els = null;
    },

    setState(stateName, { session } = {}) {
      VT.state.session = stateName;
      VT.state.active = Boolean(session?.active ?? (stateName !== 'idle'));
      if (stateName === 'idle' && !VT.state.conf.floatingAlways) {
        // keep the panel only while it is useful
        if (!this.els) return;
        this.render();
        return;
      }
      this.mount();
      this.render();
    },

    setInterim(text) {
      VT.state.interim = text || '';
      if (!VT.state.conf.showInterim) return;
      this.mount();
      this.render();
    },

    setLang(lang, mixed) {
      VT.state.lang = lang;
      VT.state.mixed = Boolean(mixed);
      this.render();
    },

    setLevel(level) {
      VT.state.micLevel = level;
      if (!this.els) return;
      this.els.meter.style.width = `${Math.min(100, Math.round(level * 100))}%`;
    },

    render() {
      if (!this.els) return;
      const state = VT.state.session || 'idle';
      const conf = VT.state.conf;
      const { dot, label, lang, interim, toggle, wrap } = this.els;
      dot.className = `vt-dot ${state}`;
      label.textContent = STATE_LABEL[state] || state;
      wrap?.classList.toggle('minimized', Boolean(conf.floatingMinimized));
      wrap?.classList.toggle('light', conf.theme === 'light'
        || (conf.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: light)').matches));
      toggle.textContent = (state === 'idle' || state === 'error') ? 'شروع' : 'توقف';

      if (conf.showLanguageBadge !== false && VT.state.lang) {
        lang.classList.remove('vt-hidden');
        lang.textContent = VT.state.lang;
        lang.classList.toggle('mixed', Boolean(VT.state.mixed));
      } else {
        lang.classList.add('vt-hidden');
      }

      const showInterim = conf.showInterim !== false && VT.state.interim;
      if (showInterim) {
        interim.classList.remove('vt-hidden');
        const text = VT.state.interim;
        interim.textContent = '';
        const pending = document.createElement('span');
        pending.className = 'vt-pending';
        pending.textContent = text;
        interim.appendChild(pending);
      } else {
        interim.classList.add('vt-hidden');
        interim.textContent = '';
      }
    },

    toast(message, level = 'error', durationMs = 6000) {
      if (!message) return;
      this.mount(true);
      if (!this.els) return;
      const { toast } = this.els;
      toast.textContent = message;
      toast.className = `vt-toast${level === 'warn' ? ' warn' : level === 'info' ? ' info' : ''}`;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        if (this.els) this.els.toast.classList.add('vt-hidden');
      }, durationMs);
    },

    showError(code, message) {
      const text = message || ERROR_LABEL[code] || 'خطای نامشخص';
      this.toast(text, code && code.startsWith('mic-') ? 'warn' : 'error');
    }
  };

  VT.ui = ui;
  VT.errorLabels = ERROR_LABEL;
}(window.__VOICETYPE__));
