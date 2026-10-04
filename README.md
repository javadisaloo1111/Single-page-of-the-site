# VoiceType Pro

**واژه‌نگاری صوتی چندزبانه برای Chrome — Persian / English / Arabic با پشتیبانی از گفتار مخلوط (Code-Switching)**

افزونه‌ای مبتنی بر Manifest V3 که با یک میانبر، میکروفون را فعال می‌کند و هر چه می‌گویید را دقیقاً در محل نشانگر مرورگر تایپ می‌کند — با حفظ زبان واقعی هر کلمه:

> «سلام، من امروز می‌خوام پروژه **React** رو کامل کنم، بعد **Backend** رو با **Laravel** می‌نویسم و **API** رو به **Frontend** وصل می‌کنم.»
>
> خروجی: `سلام، من امروز می‌خوام پروژه React رو کامل کنم، بعد Backend رو با Laravel می‌نویسم و API رو به Frontend وصل می‌کنم.`

---

## فهرست

- [نصب سریع](#نصب-سریع)
- [قابلیت‌ها](#قابلیتها)
- [معماری](#معماری)
- [موتورهای تشخیص گفتار](#موتورهای-تشخیص-گفتار)
- [حریم خصوصی](#حریم-خصوصی)
- [توسعه و تست](#توسعه-و-تست)
- [ساختار پروژه](#ساختار-پروژه)
- [مستندات بیشتر](#مستندات-بیشتر)

## نصب سریع

```bash
# 1) دریافت کد
git clone <repo-url> && cd Single-page-of-the-site

# 2) ساخت آیکن‌ها (بدون وابستگی خارجی) و اجرای بررسی‌های ایستا
npm run icons
npm run verify
npm test
```

سپس در Chrome:

1. به `chrome://extensions` بروید و **Developer mode** را روشن کنید.
2. **Load unpacked** را بزنید و پوشه ریشه پروژه (همان‌جایی که `manifest.json` است) را انتخاب کنید.
3. میانبر پیش‌فرض: **Ctrl+Shift+Space** (در مک: ⌘+Shift+Space). برای تغییر: `chrome://extensions/shortcuts`.
4. اولین بار که میانبر را می‌زنید، Chrome اجازه میکروفون می‌خواهد — **Allow** را انتخاب کنید.
5. روی هر فیلد متنی (input، textarea، contenteditable، Gmail، ChatGPT، وردپرس، ادیتورهای غنی) کلیک کنید و صحبت کنید.

نکته: برای تست سریع بدون نیاز به سایت، از **کنسول صوتی** افزونه استفاده کنید (Popup → «کنسول صوتی»).

## قابلیت‌ها

### تشخیص گفتار
- Real-time transcription با نمایش **متن موقت** و **متن نهایی**
- حالت پیوسته (Continuous) + **راه‌اندازی مجدد خودکار** پس از قطع شدن جلسه توسط Chrome
- **ثبت جمله پس از مکث** (VAD): متن موقت پس از سکوت به متن نهایی تبدیل و درج می‌شود، بنابراین صحبت طولانی کلمه از دست نمی‌دهد
- **حذف تکراری‌ها**: Reconciler هم‌پوشانی و تکرارهای موتور را در سطح کلمه تشخیص می‌دهد
- مدیریت کامل خطاها: میکروفون رد شده / در دسترس نیست / مشغول، قطع اینترنت، عدم پشتیبانی مرورگر، timeout

### زبان
- **تشخیص خودکار زبان** (فارسی، انگلیسی، عربی، و زبان‌های دیگر با اسکریپت متفاوت)
- تغییر خودکار زبان جلسه در مرز جمله‌ها، با شرط اطمینان (hysteresis) تا لرزش زبان رخ ندهد
- **حفظ زبان واقعی کلمات**: «ری‌اکت» → `React`، «لاراول» → `Laravel`، «ای پی آی» → `API`، «نکست جی اس» → `Next.js`
- حالت آزمایشی **دو موتوره** (دو جلسه هم‌زمان فارسی + انگلیسی با داور امتیازدهی اسکریپتی)
- موتور **Whisper روی سرور خودتان** برای دقت حداکثری در گفتار مخلوط

### پردازش متن
- اصلاح نیم‌فاصله فارسی (`می‌کنم`، `کتاب‌ها`) با محافظت از واژه‌هایی مثل «تنها»، «بیشتر»، «میزان»
- یکسان‌سازی حروف: ي→ی، ك→ک (فقط برای فارسی؛ متن عربی دست‌نخورده می‌ماند)
- **اعداد گفتاری → رقم**: «بیست و پنج میلیون تومان» → «۲۵ میلیون تومان»، «نسخه دو نقطه پنج» → «۲.۵»
- ارقام فارسی/انگلیسی/بدون‌تغییر (قابل انتخاب)
- **علائم نگارشی هوشمند** در سه سطح (ایمن / متعادل / تهاجمی) با تشخیص پرسشی و پایانی
- Capitalization انگلیسی، حفاظت از URL و Email و نام‌های فنی
- واژه‌نامه فنی داخلی (۱۷۰+ واژه) + واژه‌های سفارشی کاربر + قواعد جایگزینی (کلمه/زیررشته/فاصله‌انعطاف‌پذیر/regex)

### دستورهای صوتی
`خط جدید`، `پاراگراف جدید`، `پاک کن`، `همه رو پاک کن`، `کپی`، `بچسبون`، `برگرد`، `دوباره انجام بده`، `نقطه`، `ویرگول`، `علامت سوال`، `دو نقطه`، `نقطه ویرگول` و ۲۰+ دستور دیگر — با معادل انگلیسی، و قوانین ایمنی که مانع تبدیل گفتار عادی به دستور می‌شود.

### درج متن
- `input`، `textarea`، `contenteditable`، ادیتورهای غنی
- سازگار با **React** (native value setter + `InputEvent` واقعی)، Vue، Angular، Gmail، Google Docs، ChatGPT، وردپرس
- ترجیح `document.execCommand('insertText')` برای ادیتورهای contenteditable تا **undo و state فریم‌ورک** حفظ شود
- **حفظ نشانگر**: متن در محل Cursor درج می‌شود، انتخاب (Selection) با Insert جایگزین می‌شود و نشانگر دقیقاً بعد از متن جدید قرار می‌گیرد
- Journal درج: «پاک کن» و «همه رو پاک کن» دقیقاً همان چیزی را برمی‌گردانند که افزونه نوشته است

### رابط کاربری
- **Popup** با وضعیت میکروفون/تشخیص/زبان، Start/Stop، آخرین متن، تنظیمات سریع، وضعیت حریم خصوصی
- **نشانگر شناور** داخل صفحه (Shadow DOM): Drag، Minimize، Hide، ذخیره موقعیت، نمایشگر سطح صدا و زبان
- **صفحه تنظیمات** کامل و schema-driven (زبان، تشخیص، موتورها، متن، دستورها، واژه‌نامه، میانبر، تاریخچه، حریم خصوصی، دیباگ)
- **کنسول صوتی**: محیط اختصاصی افزونه برای تمرین، مرور بخش‌ها و مشاهده جریان دیباگ

## معماری

```
┌─────────────────────────── Chrome MV3 ───────────────────────────┐
│                                                                  │
│  popup / options / panel  ⇄  service worker (router + state)      │
│                                     ⇅  chrome.offscreen            │
│                              ┌──────────────────────────────┐     │
│                              │ offscreen document           │     │
│                              │  VoiceController             │     │
│                              │   ├─ MicCapture (VAD)        │     │
│                              │   ├─ SpeechEngine …          │     │
│                              │   │   ├ WebSpeechEngine      │     │
│                              │   │   ├ DualWebSpeechEngine  │     │
│                              │   │   └ HttpWhisperEngine    │     │
│                              │   └─ TextPipeline            │     │
│                              │        detect → numbers →    │     │
│                              │        code-switch → commands│     │
│                              │        → punctuation → dedupe│     │
│                              └──────────────────────────────┘     │
│                                     │ ordered ops                 │
│                                     ▼                             │
│  content script per tab: tracker → inserter (DOM) + floating UI    │
└──────────────────────────────────────────────────────────────────┘
```

**چرا offscreen؟** در MV3 سرویس‌ورکر DOM ندارد و `getUserMedia`/`SpeechRecognition` فقط در یک document واقعی کار می‌کند. Offscreen document فقط زمانی ساخته می‌شود که دیکته شروع شود و بعد از توقف بسته می‌شود؛ پس در حالت بیکاری هیچ میکروفون، CPU یا حافظه‌ای مصرف نمی‌شود.

**چرا سرویس‌ورکر فقط router است؟** سرویس‌ورکر هر لحظه ممکن است suspend شود. بنابراین وضعیت جلسه در سرویس‌ورکر «کش» است و با بیدار شدن، خود را با `OFF_PING`/`diagnostics` با واقعیت offscreen هم‌گام می‌کند.

جزئیات کامل: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## موتورهای تشخیص گفتار

| موتور | دقت فارسی | گفتار مخلوط | زمان‌بندی | حریم خصوصی | وضعیت |
|---|---|---|---|---|---|
| **Web Speech (Chrome)** | خوب | محدود (یک زبان در هر جلسه) | Real-time | صدا به سرور Google می‌رود | ✅ فعال (پیش‌فرض) |
| **Dual Web Speech** | خوب | بهتر (داوری اسکریپتی) | Real-time | همان Web Speech (۲ برابر) | ✅ فعال (آزمایشی) |
| **Whisper روی سرور شما** | بسیار خوب | **بهترین** (زبان هر کلمه) | ۱–۳ ثانیه تأخیر | فقط به سرور خودتان | ✅ فعال |
| **Local AI (مرورگر)** | — | — | — | کاملاً محلی | 🚧 در دست توسعه |

مقایسه کامل با معیارهای Accuracy / Latency / Cost / Privacy / Offline / Compatibility: [`docs/SPEECH-ENGINES.md`](docs/SPEECH-ENGINES.md)

## حریم خصوصی

| پرسش | پاسخ |
|---|---|
| صدا کجا پردازش می‌شود؟ | Web Speech → سرویس Google (رفتار استاندارد Chrome؛ در حالت `processLocally` روی دستگاه). Whisper → فقط سرور انتخابی شما. |
| آیا افزونه صدا را ذخیره می‌کند؟ | **هرگز.** فقط قطعه‌های Whisper در حافظه و برای همان درخواست ساخته می‌شوند. |
| آیا متن ذخیره می‌شود؟ | فقط اگر تاریخچه را روشن کنید، در `chrome.storage.local` همان مرورگر، با محدودیت تعداد و قابل پاک کردن. |
| آیا محتوای صفحه خوانده می‌شود؟ | **خیر.** فقط فیلد متنی فعال شناسایی می‌شود تا متن در محل نشانگر درج شود. |
| داده‌ای به توسعه‌دهنده ارسال می‌شود؟ | **خیر.** هیچ سروری برای افزونه وجود ندارد. |

## توسعه و تست

```bash
npm run verify   # بررسی ایستا: manifest، ترتیب content scriptها، CSP، ایمپورت‌ها، eval/remote-code
npm run lint     # ESLint (no-undef، بدون var، قواعد کیفیت کد)
npm test         # ۱۲۸ تست خودکار (NLP، موتورها، کنترلر، درج DOM، سناریوهای end-to-end، امنیت)
npm run icons    # بازتولید آیکن‌ها بدون وابستگی خارجی
npm run check    # verify + lint + test
```

پس از هر تغییر در `src/content/*`، در `chrome://extensions` دکمه **Reload** را بزنید و صفحه هدف را دوباره بارگذاری کنید.

راهنمای تست دستی (۲۰ سناریوی پذیرش) و نتایج: [`docs/TESTING.md`](docs/TESTING.md)

## ساختار پروژه

```
manifest.json                  MV3 + commands + CSP سخت‌گیرانه
src/
  common/     constants.js settings.js util.js      ← قرارداد پیام‌ها، طرح تنظیمات
  nlp/        tokenize numbers persian technicalTerms codeSwitch
              languageDetect punctuation commands dedupe pipeline
  engines/    base webSpeechEngine dualWebSpeechEngine httpWhisperEngine
              localAiEngine arbitration scriptStats factory audioCapture
  offscreen/  offscreen.html offscreen.js controller.js
  background/ service-worker.js offscreenHost.js messaging.js storage.js
  content/    00-namespace … 99-main (ترتیب بارگذاری در manifest)
  ui/         theme.css dom.js api.js              ← کیت مشترک رابط کاربری
  popup/ options/ panel/  assets/icons/
tools/        make-icons.mjs verify.mjs
eslint.config.mjs
tests/        nlp(51) engines(22) insertion(21) scenarios(23) security(11)
docs/         ARCHITECTURE.md SPEECH-ENGINES.md TESTING.md
```

هیچ build step اجباری وجود ندارد: افزونه همان‌طور که هست در Chrome بار می‌شود (ES modules، بدون bundler، بدون کد از راه دور).

## مستندات بیشتر

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — معماری، جریان داده، قرارداد پیام‌ها، تصمیم‌های طراحی
- [`docs/SPEECH-ENGINES.md`](docs/SPEECH-ENGINES.md) — محدودیت‌های واقعی Web Speech API و مقایسه موتورها + نقشه راه Whisper محلی
- [`docs/TESTING.md`](docs/TESTING.md) — سناریوهای تست، جدول نتایج و چک‌لیست تست دستی در مرورگر
