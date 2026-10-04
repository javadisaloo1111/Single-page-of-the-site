# VocaType Token Broker

این سرور کوچک کلید دائمی Soniox را نگه می‌دارد و به Extension یک کلید کوتاه‌عمر، تک‌مصرف و محدود به WebSocket transcription می‌دهد. بدون API Key واقعی اجرا نمی‌شود.

## شروع

```bash
cp .env.example .env
# مقادیر امن را داخل .env قرار دهید
node --env-file=.env server.mjs
```

`SONIOX_API_KEY` را در هیچ‌کدام از فایل‌های Extension، ZIP یا مخزن عمومی قرار ندهید. برای نصب شخصی، `BROKER_ACCESS_TOKEN` را طولانی و تصادفی انتخاب کنید و در Options اکستنشن وارد کنید. این توکن دسترسی صدور کلید موقت است و باید محرمانه بماند.

در نصب Unpacked، Origin باید دقیقاً `chrome-extension://<extension-id>` باشد. `ALLOWED_ORIGINS` می‌تواند چند Origin را با کاما جدا کند. برای انتشار عمومی، این نمونه کافی نیست: احراز هویت مجزا برای هر کاربر، rate limit پایدار (مثلاً Redis)، HTTPS، مانیتورینگ و محدودیت بودجهٔ Soniox اضافه کنید. CORS به‌تنهایی احراز هویت محسوب نمی‌شود.

این Broker روی `0.0.0.0` گوش می‌دهد تا در محیط توسعهٔ کانتینری هم قابل دسترسی باشد؛ برای استفادهٔ واقعی آن را پشت TLS و reverse proxy امن قرار دهید.
