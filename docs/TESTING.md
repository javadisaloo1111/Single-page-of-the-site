# تست VoiceType Pro

دو لایه تست وجود دارد:

1. **تست‌های خودکار** (`npm test`) — منطق زبان، موتورها، کنترلر جلسه، درج در DOM (jsdom)،
   سناریوهای end-to-end و امنیت. بدون نیاز به مرورگر.
2. **چک‌لیست تست دستی در Chrome** — مواردی که فقط با میکروفون واقعی و سرویس واقعی Google/Whisper
   قابل سنجش‌اند (دقت، سناریوهای سایت‌های واقعی).

---

## 1. اجرای تست‌های خودکار

```bash
npm install     # jsdom (تست DOM) + ESLint
npm run verify  # بررسی ایستا: manifest, CSP, ترتیب content scripts, ایمپورت‌ها, eval/remote-code
npm run lint    # ESLint با no-undef (گرفتن خطای نام متغیر/ایمپورت)
npm test        # 128 تست
npm run check   # هر سه
```

نتیجه اجرای فعلی:

```
# tests 128
# pass 128
# fail 0

VoiceType Pro — static verification
  ✓ manifest.json is valid JSON
  ✓ 21 manifest references checked
  ✓ 40 JavaScript files parse cleanly
  ✓ relative imports resolved
  ✓ 4 HTML pages checked for CSP violations
  ✓ content script order matches disk (00-namespace → … → 99-main)
  ✓ no eval / new Function / remote code found
  ✓ message types referenced by the UI exist in constants.js
PASSED — 0 warning(s)
```

### پوشش فایل‌های تست

| فایل | تعداد | چه چیزی را تضمین می‌کند |
|---|---|---|
| `tests/nlp.test.js` | 51 | کدسوییچینگ (ری‌اکت→React)، نیم‌فاصله، اعداد، تشخیص زبان، دستورها، علائم، dedupe، sanitize، امنیت regex |
| `tests/engines.test.js` | 22 | آماره‌های اسکریپت، داوری دو موتوره، نگاشت خطا، کنترلر: شروع/توقف، میکروفون رد‌شده، ری‌استارت، سوییچ زبان |
| `tests/insertion.test.js` | 21 | درج در input/textarea/contenteditable، React-controlled، حفظ نشانگر، journal (پاک کن/همه رو پاک کن)، عدم XSS |
| `tests/scenarios.test.js` | 23 | زنجیره کامل موتور→کنترلر→پایپ‌لاین→DOM مطابق ۲۰ سناریوی پذیرش |
| `tests/security.test.js` | 11 | اعتبارسنجی پیام، prototype pollution، سهمیه اندازه پیام، فایل پشتیبان آلوده، ReDoS |

---

## 2. جدول سناریوهای پذیرش

| # | سناریو | نوع | نتیجه | شاهد |
|---|---|---|---|---|
| 1 | فارسی کامل | خودکار | ✅ | `scenario 1` — «میخواهم»→«می‌خواهم»، «کتابها»→«کتاب‌ها» |
| 2 | انگلیسی کامل | خودکار | ✅ | `scenario 2` — Capitalization + نقطه پایانی |
| 3 | فارسی + انگلیسی | خودکار | ✅ | `scenario 3+4` — React/Laravel/API/WordPress بدون فارسی‌نویسی |
| 4 | فارسی + English + اصطلاحات فنی | خودکار | ✅ | `nlp.test.js` – «نکست جی اس»→Next.js، «گیتهاب»→GitHub، «کلادفلر»→Cloudflare |
| 5 | عربی | خودکار | ✅ | `scenario 5` — متن عربی فارسی‌سازی نمی‌شود (y/ي و ك حفظ می‌شوند) |
| 6 | جملات طولانی | خودکار | ✅ | `scenario 6` — بخش‌های پیوسته بدون افت/تکرار؛ ۳۰۰ جمله در تست کارایی |
| 7 | صحبت سریع | خودکار | ✅ | `scenario 7+8` — نتیجه یکسان با ورودی یکسان |
| 8 | صحبت آهسته | خودکار | ✅ | همان |
| 9 | مکث‌های طولانی | خودکار | ✅ | `scenario 9` — flush در سکوت ⇒ ثبت جمله؛ `silenceFinalizeMs` |
| 10 | قطع و وصل میکروفون | خودکار + دستی | ✅ | `scenario 10` (watchdog) و `mic-denied/busy/unavailable` در `engines.test.js` |
| 11 | قطع اینترنت | خودکار | ✅ | `scenario 11` — خطای recoverable + ری‌استارت؛ پیام «ارتباط قطع شد» |
| 12 | تغییر Tab | خودکار | ✅ | `scenario 12+13` — جلسه ادامه می‌یابد و هدف درج به فیلد فعال جدید منتقل می‌شود |
| 13 | تغییر Window | خودکار | ✅ | همان + `windows.onFocusChanged` در سرویس‌ورکر |
| 14 | Input | خودکار | ✅ | `scenario 14–16 — input` |
| 15 | Textarea | خودکار | ✅ | `scenario 14–16 — textarea` |
| 16 | Contenteditable | خودکار | ✅ | `scenario 14–16 — contenteditable` + حالت بدون execCommand |
| 17 | React Input | خودکار | ✅ | `scenario 17` — native setter + `InputEvent` و هم‌گامی state |
| 18 | Gmail | دستی | ⏳ | چک‌لیست زیر (نیازمند حساب واقعی) |
| 19 | ChatGPT | دستی | ⏳ | چک‌لیست زیر |
| 20 | وردپرس / ادیتور غنی | دستی | ⏳ | چک‌لیست زیر |

> ⏳ یعنی تست خودکار آن ممکن نیست (نیازمند سرویس واقعی/لاگین). مسیر کد آن‌ها همان مسیر
> contenteditable/execCommand است که خودکار تست شده است.

---

## 3. چک‌لیست تست دستی در Chrome

### آماده‌سازی
1. `chrome://extensions` → Developer mode → Load unpacked → پوشه پروژه.
2. `chrome://extensions/shortcuts` → اطمینان از ثبت `Ctrl+Shift+Space`.
3. افزونه را باز کنید → «کنسول صوتی» → «آزمایش میکروفون» (باید سطح صدا حرکت کند).

### دقت زبان (مهم‌ترین بخش)
در هر فیلد، این جمله‌ها را بگویید و خروجی را با انتظار مقایسه کنید:

| جمله گفتاری | خروجی مورد انتظار |
|---|---|
| «سلام، من امروز می‌خوام پروژه React رو کامل کنم، بعد Backend رو با Laravel می‌نویسم و API رو به Frontend وصل می‌کنم» | همان، با حفظ کامل کلمات انگلیسی |
| «سلام من امروز روی پروژه Next.js کار کردم و مشکل authentication رو حل کردم» | همان |
| «من توی Next.js یه API با Laravel ساختم» | Python… نه: `من توی Next.js یه API با Laravel ساختم` |
| «نسخه دو نقطه پنج React» | `نسخه ۲.۵ React` |
| «بیست و پنج میلیون تومان» | `۲۵ میلیون تومان` |
| «سلام خوبی امروز چطوری» | `سلام، خوبی؟ امروز چطوری؟` (سطح متعادل/تهاجمی) |
| «متن تست خط جدید متن بعدی» | دو خط |
| «این جمله رو پاک کن» | جمله حذف می‌شود |

### سناریوهای سایت (۱۸–۲۰)
| سایت | چه چیزی را تست کنیم | معیار قبولی |
|---|---|---|
| **Gmail** | کادر «New message» و پاسخ سریع | متن بدون جابه‌جایی کاراکتر درج شود؛ Undo (Ctrl+Z) کار کند |
| **ChatGPT** | کادر پیام (`contenteditable`/textarea آینده) | دکمه ارسال فعال شود (state فریم‌ورک هم‌گام)؛ متن در محل نشانگر |
| **Google Docs** | سند جدید، وسط متن فارسی/انگلیسی | درج در محل نشانگر بدون شکستن قالب‌بندی |
| **وردپرس (کلاسیک + بلاک)** | ادیتور کلاسیک TinyMCE و بلوک پاراگراف | متن در محل نشانگر؛ Undo مرورگر متن افزونه را حذف کند |
| **React (localhost)** | یک input کنترل‌شده با `onChange` + نمایش state | مقدار input و state یکی باشد |
| **Vue/Angular** | `v-model` / `[(ngModel)]` | همان |
| **Notion / Slack / LinkedIn** | ادیتورهای غنی | درج بدون خرابی ساختار |

### بررسی خطاها
| سناریو | کار مورد انتظار |
|---|---|
| اجازه میکروفون را «Block» کنید و میانبر بزنید | پیام «دسترسی میکروفون…» در صفحه و در Popup |
| با یک تماس تصویری میکروفون را اشغال کنید | پیام «میکروفون توسط برنامه دیگری در حال استفاده است» |
| WiFi را قطع کنید (Web Speech) | پیام قطع اینترنت + ری‌استارت خودکار هنگام بازگشت |
| زبان مرورگر را به زبانی بدون پشتیبانی تغییر دهید | پیام «زبان پشتیبانی نمی‌شود» بدون Crash |
| ۲۰ دقیقه صحبت پیوسته | جلسه پایدار؛ `restarts` در کنسول صوتی افزایش منطقی داشته باشد |

### بررسی مصرف و عملکرد
1. `chrome://extensions` → دکمه Service worker → در حالت بیکاری حافظه باید ثابت بماند.
2. در حالی که دیکته فعال نیست، در Task Manager مرورگر (Shift+Esc) مصرف CPU افزونه ~۰٪ باشد.
3. حین دیکته، فقط یک نمونه offscreen document وجود داشته باشد
   (`chrome://extensions` → Inspect views → offscreen.html یک عدد).
4. نشانگر شناور را جابه‌جا کنید، صفحه را reload کنید ⇒ موقعیت حفظ شود.

---

## 4. عیب‌یابی

| نشانه | علت احتمالی | راهکار |
|---|---|---|
| افزونه بارگذاری نمی‌شود | manifest خراب یا فایل ارجاع‌شده ناموجود | `npm run verify` |
| میانبر کار نمی‌کند | تداخل با میانبر دیگر یا پنجره غیرفعال | `chrome://extensions/shortcuts` |
| متن درج نمی‌شود | فیلد فعال نیست / iframe متفاوت | روی فیلد کلیک کنید؛ در کنسول صوتی امتحان کنید؛ `no-editable-target` را در Popup ببینید |
| متن دوبار درج می‌شود | تزریق مضاعف content script (بعد از Reload افزونه) | صفحه را reload کنید؛ گارد تزریق در `00-namespace.js` جلوی تکرار را می‌گیرد |
| زبان اشتباه انتخاب می‌شود | متن کوتاه/دو‌زبانه | `language.switchConfidence` را بالا ببرید یا حالت دستی را انتخاب کنید |
| Whisper خطا می‌دهد | endpoint یا کلید نادرست / CORS | `whisper-config` و `whisper-http` را در دیباگ ببینید؛ سرور باید CORS را برای origin افزونه مجاز کند |

لاگ‌ها: تنظیمات → «دیباگ و عیب‌یابی» → «حالت دولوپر» → «اجرای عیب‌یابی» → «کپی گزارش».
