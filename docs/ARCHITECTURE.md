# معماری VoiceType Pro

سندی برای توسعه‌دهندگان: چرا اجزا این‌گونه چیده شده‌اند، جریان داده چگونه است و از کجا باید
توسعه داد.

---

## 1. لایه‌ها

| لایه | فایل‌ها | مسئولیت | چرا اینجا |
|---|---|---|---|
| **Service worker** | `src/background/*` | مسیریابی پیام‌ها، وضعیت جلسه (کش)، دکمه/میانبر/منو، تاریخچه و لاگ | تنها جایی که همیشه در دسترس است و به `chrome.*` دسترسی دارد؛ DOM ندارد |
| **Offscreen document** | `src/offscreen/*` | میکروفون، موتور تشخیص، خط لوله پردازش متن | `getUserMedia` و `SpeechRecognition` در MV3 فقط در یک document واقعی کار می‌کنند |
| **Content script** | `src/content/*` | ردیابی فیلد فعال، درج متن، نشانگر شناور | تنها لایه‌ای که به DOM صفحه دسترسی دارد |
| **UI (extension pages)** | `src/popup`, `src/options`, `src/panel`, `src/ui` | کنترل و تنظیمات | صفحات افزونه، جدا از صفحه کاربر، با CSP سخت |
| **Shared pure logic** | `src/nlp/*`, `src/engines/*`, `src/common/*` | تشخیص زبان، پردازش متن، موتورها، تنظیمات | بدون وابستگی به DOM/chrome ⇒ قابل تست در Node |

اصل حاکم: **هر منطقی که قابل تست بدون مرورگر است، از لایه‌های مرورگری جدا است.** به همین دلیل
۹۰٪ کد (کل پردازش زبان و کنترل جلسه) با `node --test` تست می‌شود.

---

## 2. جریان داده یک جمله

```
[میکروفون]
    │  (MicCapture: level/VAD، تشخیص سکوت)
    ▼
[SpeechEngine]  ── interim ─┐
    │  final                │  (Web Speech / Whisper / Dual)
    ▼                       │
[VoiceController]           │
    │  normalise detection  │
    ▼                       │
[TextPipeline.processFinal] │
    │  1. spacing + Persian chars (فقط اگر زبان فارسی باشد)
    │  2. numbers  (پیش از دستورها: «دو نقطه پنج» ⇒ ۲.۵)
    │  3. code-switching + واژه‌نامه کاربر  (ری‌اکت ⇒ React)
    │  4. voice commands  ⇒ ops  (text / key / edit / clipboard / lang)
    │  5. punctuation + half-space + normalize
    │  6. dedupe در برابر متن commit‌شده
    ▼
[ops]  ──service worker──▶ [content script: inserter] ──▶ فیلد متنی
    │
    └──▶ [history/logs/stats] + [floating UI] + [popup/panel]
```

نکته مهم: **موتور فقط متن خام می‌دهد؛ هیچ‌جای دیگری متن را تغییر نمی‌دهد.** همه اصلاحات در
`TextPipeline` متمرکز است، بنابراین هر موتور جدیدی که اضافه شود همان رفتار و همان تست‌ها را دارد.

---

## 3. قرارداد پیام‌ها

سه فضای نام در `src/common/constants.js`:

| پیشوند | مسیر | نمونه |
|---|---|---|
| (بدون پیشوند) | UI ⇄ service worker | `start-dictation`, `set-settings`, `get-history` |
| `off:` | service worker ⇄ offscreen | `off:start`, `off:stop`, `off:diagnostics` |
| `cs:` | service worker ⇄ content script | `cs:insert`, `cs:state`, `cs:interim` |

قواعد:

1. **هر پیام اعتبارسنجی می‌شود**: `sanitizeIncoming()` فقط انواع شناخته‌شده را می‌پذیرد، رشته‌ها را
   محدود می‌کند، پیام‌های بزرگ‌تر از ۶۰۰KB را رد می‌کند و payload را deep-copy می‌کند.
2. **فرستنده بررسی می‌شود**: `sender.id === chrome.runtime.id` — هیچ صفحه وب یا افزونه دیگری
   نمی‌تواند با افزونه حرف بزند (`externally_connectable` تعریف نشده است).
3. **پاسخ‌ها همیشه شیء هستند**: `{ ok: true|false, reason?, … }` و caller هرگز exception نمی‌گیرد.
4. **ops** زبان مشترک درج است: `{type:'text'|'key'|'edit'|'clipboard'|'control', …}`.

---

## 4. تصمیم‌های طراحی کلیدی

### ۴.۱ چرا offscreen و نه یک tab پنهان؟
`chrome.offscreen` (Chrome 109+) با دلیل `USER_MEDIA` دقیقاً برای این مورد طراحی شده: بدون نوار
تب، بدون دخالت در پروفایل کاربر و بدون کد اضافه. سند فقط در طول دیکته باز است
(ساخت در `start`, بستن ۲ ثانیه پس از پایان)، پس در حالت بیکاری مصرف صفر است.

### ۴.۲ چرا Reconciler جدا از موتور؟
موتورها (به‌ویژه Web Speech) سه رفتار آزاردهنده دارند: (۱) interim‌ها کل جمله تا آن لحظه را تکرار
می‌کنند، (۲) پس از ری‌استارت، چند کلمه آخر را دوباره می‌فرستند، (۳) `stop()` متن معلق را final
می‌کند. `Reconciler` مالک متن commit‌شده است و:
- final‌های یکسان را دور می‌ریزد،
- هم‌پوشانی انتهای متن commit‌شده با ابتدای بخش جدید را ادغام می‌کند (فقط اگر کلمه هم‌پوشان
  «متمایز» باشد؛ «به»، «و»، «the» هرگز ادغام نمی‌شوند تا متن واقعی حذف نشود)،
- `interim` را به «دنباله‌ی commit‌نشده» کاهش می‌دهد تا UI دوباره‌گویی نشان ندهد.

### ۴.۳ چرا ترتیب پردازش مهم است؟
- **اعداد قبل از دستورها**: «نسخه دو نقطه پنج» اگر اول به دستور «دو نقطه» برسد، به
  `نسخه 2: 5` تبدیل می‌شود. اعداد ابتدا `2.5` می‌سازند.
- **کدسوییچ قبل از دستورها**: نام واژه‌ها را یکدست می‌کند (`لاراول` → `Laravel`) تا فاصله‌گذاری و
  تطبیق دستور روی شکل نهایی انجام شود.
- **علائم بعد از دستورها**: هر op متنی جداگانه پردازش می‌شود و فقط op پایانی علامت پایان جمله
  می‌گیرد (وگرنه «خط اول. خط دوم.» می‌شد).

### ۴.۴ درج متن: چرا execCommand و نه `value = …`
| عنصر | روش | دلیل |
|---|---|---|
| `<input>`/`<textarea>` | native value setter + `InputEvent('insertText')` | `el.value = …` توسط value-tracker ری‌اکت نادیده گرفته می‌شود و state فریم‌ورک از DOM جدا می‌ماند |
| `contenteditable` | `document.execCommand('insertText')` و در صورت نبود، Range surgery | execCommand رویدادهای `beforeinput`/`input` واقعی تولید می‌کند و در undo stack مرورگر ثبت می‌شود |
| Google Docs | کادر پنهان `docs-texteventtarget-iframe` | ادیتور روی canvas است؛ API عمومی دیگری وجود ندارد |
| Fallback | درج `TextNode` (هرگز `innerHTML`) | متن کاربر هرگز به HTML تفسیر نمی‌شود (بدون XSS) |

هر درج در یک **journal** ثبت می‌شود (`host`, range/offset, متن) تا:
- «پاک کن» دقیقاً آخرین تکه افزونه را حذف کند (نه یک Backspace کورکورانه)،
- «همه رو پاک کن» کامل پاک کند،
- پس از حذف، نشانگر سر جای درست بنشیند.

### ۴.۵ تشخیص خودکار زبان و گفتار مخلوط
Web Speech API در هر جلسه فقط **یک** زبان دارد؛ Chang کردن آن یعنی ری‌استارت. بنابراین:

1. `languageDetect` امتیاز هر زبان را از روی اسکریپت + stopword + واژه‌های فنی می‌سازد و
   `confidence` می‌دهد.
2. `VoiceController` فقط در **مرز جمله** (بدون interim معلق) و با شرط اطمینان بالا یا دو تشخیص
   پیوسته زبان را عوض می‌کند (`shouldSwitchLanguage` + hysteresis).
3. حالت **دو موتوره** (آزمایشی) دو جلسه فارسی/انگلیسی را هم‌زمان می‌گیرد و با
   `arbitration.js` (نسبت اسکریپت + تعداد واژه‌های فنی + غنای متن) یکی را برمی‌گزیند.
4. حالت **Whisper** زبان را در هر درخواست آزاد می‌گذارد ⇒ عملاً مشکل حل می‌شود.

### ۴.۶ چرا «حفظ اصطلاحات» با regex تنها نیست
اگر فقط regex روی متن نهایی بزنیم، دو مشکل پیش می‌آید: (۱) کلمه انگلیسی که کاربر انگلیسی گفته هم
دستکاری می‌شود، (۲) واژه‌های ترکیبی مثل `Next.js` خراب می‌شوند. راه‌حل پیاده‌شده:

- واژه‌نامه ساخت‌یافته (`term`, `fa[]`, `en[]`, `kind`) به‌جای فهرست صرف؛
- look-up روی توکن‌های **اسکریپت فارسی** با پنجره ۱..۴ کلمه‌ای (پس «نکست جی اس» و «نکستجیاس» هر دو
  دیده می‌شوند) و تطبیق فازی محدود (Levenshtein با سطل طول، max ۱–۲)؛
- **محافظ ترکیب‌ها**: توکنی که به `.`/`/`/`-`/`@` چسبیده باشد هرگز بازنویسی نمی‌شود
  (`Next.js` سالم می‌ماند و `js` داخلش به JavaScript تبدیل نمی‌شود)؛
- `kind: 'generic'` (سرور، دیتابیس، کش…) به‌صورت پیش‌فرض فارسی می‌ماند تا متن طبیعی باشد؛
- اولویت با واژه‌نامه کاربر است؛ خروجی قواعد کاربر با sentinel محافظت می‌شود تا پاس داخلی آن را
  خراب نکند.

### ۴.۷ نشانگر شناور
Shadow DOM با `all: initial` ⇒ استایل صفحه نه به UI نشت می‌کند و نه برعکس. ماوس/لمس با Pointer
Events (drag آسان روی دستگاه لمسی)، موقعیت در `storage` ذخیره می‌شود، و در فریم‌های تودرتو فقط
وقتی کاربر داخل همان فریم در حال تایپ است می‌شود.

---

## 5. چرخه عمر جلسه

```
Ctrl+Shift+Space
   └─ chrome.commands.onCommand
        └─ SW: startDictation()
             ├─ ensureContentScript(activeTab)      (تب‌های قدیمی‌تر از نصب)
             ├─ ensureOffscreen()                    (ساخت سند در صورت نیاز)
             └─ off:start
                  └─ VoiceController.startSession()
                       ├─ #ensureMicrophone()        (خطا → mic-denied/unavailable/busy)
                       ├─ engineFactory()            (Web Speech / Dual / Whisper)
                       └─ engine.start() → LISTENING
```

پایان جلسه (میانبر/دکمه/دستور صوتی/بسته شدن تب/محدودیت زمانی):

```
stop/abort → engine.stop({flush:true}) → pipeline.reset() → mic.close()
           → SW.finishSession() → badge خالی → scheduleOffscreenClose() (۲ ثانیه)
```

ری‌استارت خودکار: `engine.onend` بدون درخواست کاربر ⇒ SW نه، خودِ کنترلر با backoff
(`restartDelayMs` × شماره تلاش، سقف ۳ ثانیه) دوباره `start()` می‌کند؛ پس از `maxRestarts` خطای
`restart-failed` و پایان تمیز جلسه. Watchdog هر ۱۵ ثانیه: جلسه حداکثری، میکروفون مرده و
موتور بی‌پاسخ را تشخیص می‌دهد.

---

## 6. توسعه: افزودن موتور جدید

۱. فایل `src/engines/myEngine.js` را از `SpeechEngine` ارث‌بری کنید و رویدادهای استاندارد را emit کنید:

```js
import { SpeechEngine } from './base.js';

export class MyEngine extends SpeechEngine {
  get capabilities() { return { id: 'my-engine', streaming: true, multiLanguage: true, /* … */ }; }
  static async probe() { return { available: true, reason: 'ok' }; }
  async start() { /* … */ this.setState(STATE.LISTENING); return true; }
  async stop() { /* … */ this.emit({ type: 'flush' }); }
  async setLang(lang) { this.lang = lang; return true; }
  onAudioLevel(level, speaking) { /* VAD */ }
  requestFinalize() { /* true اگر متنی flush شد */ }
}
```

۲. در `src/common/constants.js` یک `ENGINES.X` اضافه کنید.
۳. در `src/engines/factory.js` به `createEngine` و `engineCatalog` وصلش کنید.
۴. تمام. UI (تنظیمات → موتورها)، دیباگ، تاریخچه و متن کدسوییچ بدون تغییر کار می‌کنند.

---

## 7. عملکرد و مصرف

| مورد | تصمیم |
|---|---|
| سرویس‌ورکر | هیچ state حیاتی در حافظه ندارد (کش + هم‌گام‌سازی)، هیچ تایمر دوره‌ای |
| Offscreen | فقط در طول دیکته؛ بستن خودکار ۲ ثانیه پس از پایان |
| میکروفون | فقط در طول دیکته؛ در پایان `track.stop()` + آزادسازی AudioContext |
| Content script | بدون polling؛ فقط رویدادهای DOM + یک handshake؛ listenerها بدون تکرار (گارد تزریق مضاعف) |
| واژه‌نامه | ایندکس ساخت‌یافته با کش بر اساس هش؛ جست‌وجوی فازی با سطل طول (نه O(n) روی کل واژه‌نامه) |
| پردازش متن | خط لوله O(طول متن) با توکنایزر دوسطری و بدون regex بازگشتی |
| لاگ | فقط با `debug.enabled`؛ در حالت عادی هیچ log یا ذخیره‌سازی غیرضروری |
| کیفیت کد | `npm run lint` با `no-undef` روی همه لایه‌ها (بدون `var`، بدون متغیر تعریف‌نشده) |

نتیجه: ۳۰۰ جمله (~۳۰KB متن) در کمتر از ۳ ثانیه پردازش می‌شود (تست `scenarios.test.js`)، در حالی
که پردازش یک جمله معمولی زیر یک میلی‌ثانیه است.

---

## 8. مرزهای اعتماد

| مرز | تهدید | دفاع |
|---|---|---|
| صفحه وب → content script | استایل/اسکریپت صفحه UI را خراب کند | Shadow DOM + `all: initial`؛ هیچ متن کاربر با `innerHTML` درج نمی‌شود |
| content script → سرویس‌ورکر | پیام جعلی | `sender.id` + اعتبارسنجی نوع/طول/اندازه |
| تنظیمات کاربر → موتور regex | ReDoS | `looksUnsafeRegex` (گروه تودرتو با تکرار، backreference) + محدودیت طول الگو |
| فایل پشتیبان → تنظیمات | آلودگی prototype / مقادیر خطرناک | `sanitizeSettings` همه مسیرها را مجدداً اعتبارسنجی می‌کند؛ `deepMerge` کلیدهای `__proto__` را رد می‌کند |
| شبکه | ارسال صدا به سرور ناشناس | فقط `connect-src https:` و endpoint انتخابی کاربر؛ بدون fetch خودکار |
| افزونه دیگر | دسترسی به APIهای ما | `externally_connectable` تعریف نشده ⇒ پیام بیرونی ممکن نیست |
