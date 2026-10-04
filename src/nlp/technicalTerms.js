/**
 * Technical vocabulary + Persian/Arabic transliteration knowledge base.
 *
 * `kind`:
 *   - "proper"  : brand / product / protocol name. Its Persian-script transliteration is
 *                 ALWAYS rewritten to the canonical Latin spelling (React, Laravel, GitHub…).
 *                 This is exactly the "don't write ری‌اکت" requirement.
 *   - "generic" : common technical noun (server, cache, json…). Latin input is re-cased to the
 *                 canonical form ("api" -> "API"), but Persian loanwords are left untouched
 *                 unless the user turns on `text.englishizeGenericTerms`.
 *
 * The list is data — the UI lets users extend it (Settings → Dictionary) and export it.
 */

/** @typedef {{term:string, kind:'proper'|'generic', category:string, fa?:string[], en?:string[]}} Term */

/** @type {Term[]} */
export const TECHNICAL_TERMS = [
  // ---------- JS / Frontend frameworks ----------
  { term: 'React', kind: 'proper', category: 'frontend', fa: ['ری‌اکت', 'ری اکت', 'ریاکت', 'ریآکت', 'رآکت'], en: ['reactjs', 'react js', 'react.js'] },
  { term: 'React Native', kind: 'proper', category: 'mobile', fa: ['ری‌اکت نیتیو', 'ری اکت نیتیو', 'ریکت نیتیو'], en: ['reactnative'] },
  { term: 'Next.js', kind: 'proper', category: 'frontend', fa: ['نکست جی اس', 'نکست‌جی‌اس', 'نکستجیاس', 'نکست', 'ناکست جی اس'], en: ['nextjs', 'next js', 'next.js'] },
  { term: 'Nuxt.js', kind: 'proper', category: 'frontend', fa: ['ناکست جی اس', 'نوکست'], en: ['nuxtjs', 'nuxt js'] },
  { term: 'Vue', kind: 'proper', category: 'frontend', fa: ['ویو', 'وو'], en: ['vuejs', 'vue js', 'vue.js'] },
  { term: 'Angular', kind: 'proper', category: 'frontend', fa: ['انگولار', 'آنگولار'], en: ['angularjs'] },
  { term: 'Svelte', kind: 'proper', category: 'frontend', fa: ['اسولت', 'اسولت جی اس'], en: [] },
  { term: 'JavaScript', kind: 'proper', category: 'language', fa: ['جاوا اسکریپت', 'جاوااسکریپت', 'جاواسکریپت', 'جاوا اسکریپ'], en: ['javascript', 'java script'] },
  { term: 'TypeScript', kind: 'proper', category: 'language', fa: ['تایپ اسکریپت', 'تایپ‌اسکریپت', 'تایپاسکریپت'], en: ['typescript', 'type script'] },
  { term: 'Tailwind', kind: 'proper', category: 'css', fa: ['تیلویند', 'تیل ویند', 'تیل‌ویند'], en: ['tailwindcss', 'tailwind css'] },
  { term: 'Bootstrap', kind: 'proper', category: 'css', fa: ['بوت استرپ', 'بوت‌استرپ', 'بوتسترپ'], en: [] },
  { term: 'Vite', kind: 'proper', category: 'tooling', fa: ['ویت', 'ویته'], en: ['vitejs'] },
  { term: 'Webpack', kind: 'proper', category: 'tooling', fa: ['وب‌پک', 'وب پک'], en: [] },
  { term: 'HTML', kind: 'proper', category: 'web', fa: ['اچ تی ام ال', 'اچ‌تی‌ام‌ال', 'اچ تی ام'], en: [] },
  { term: 'CSS', kind: 'proper', category: 'web', fa: ['سی اس اس', 'سی‌اس‌اس', 'سی اس'], en: ['stylesheet'] },
  { term: 'SCSS', kind: 'proper', category: 'css', fa: ['اس سی اس اس', 'ساس'], en: ['sass', 'less'] },

  // ---------- Backend / languages ----------
  { term: 'Laravel', kind: 'proper', category: 'backend', fa: ['لاراول', 'لارول', 'لاراویل'], en: [] },
  { term: 'PHP', kind: 'proper', category: 'language', fa: ['پی اچ پی', 'پی‌اچ‌پی', 'پی اچ'], en: [] },
  { term: 'Python', kind: 'proper', category: 'language', fa: ['پایتون', 'پایتن'], en: [] },
  { term: 'Flask', kind: 'proper', category: 'backend', fa: ['فلسک', 'فلاسک'], en: [] },
  { term: 'FastAPI', kind: 'proper', category: 'backend', fa: ['فست ای پی آی', 'فست‌ای‌پی‌آی', 'فست api'], en: ['fast api'] },
  { term: 'Django', kind: 'proper', category: 'backend', fa: ['جنگو', 'جنگو'], en: [] },
  { term: 'Node.js', kind: 'proper', category: 'backend', fa: ['نود جی اس', 'نود‌جی‌اس', 'نودجیاس'], en: ['nodejs', 'node js', 'node.js'] },
  { term: 'Express', kind: 'proper', category: 'backend', fa: ['اکسپرس', 'اکسپرس جی اس'], en: ['expressjs', 'express js'] },
  { term: 'Java', kind: 'proper', category: 'language', fa: ['جاوا'], en: [] },
  { term: 'Kotlin', kind: 'proper', category: 'language', fa: ['کاتلین'], en: [] },
  { term: 'Swift', kind: 'proper', category: 'language', fa: ['سوئیفت', 'سویفت'], en: [] },
  { term: 'Flutter', kind: 'proper', category: 'mobile', fa: ['فلاتر'], en: [] },
  { term: 'Rust', kind: 'proper', category: 'language', fa: ['راست‌لنگ'], en: [] },
  { term: 'Go', kind: 'proper', category: 'language', fa: ['زبان گو', 'گولنگ'], en: ['golang', 'go lang'] },
  { term: 'C++', kind: 'proper', category: 'language', fa: ['سی پلاس پلاس', 'سی‌پلاس‌پلاس'], en: ['cpp', 'c plus plus'] },
  { term: 'C#', kind: 'proper', category: 'language', fa: ['سی شارپ'], en: ['csharp', 'c sharp'] },
  { term: '.NET', kind: 'proper', category: 'framework', fa: ['دات نت', 'دات‌نت'], en: ['dotnet', 'net core', 'asp.net', 'aspnet'] },

  // ---------- APIs / data ----------
  { term: 'API', kind: 'proper', category: 'api', fa: ['ای پی آی', 'ای‌پی‌آی', 'ای پی ای', 'آپی'], en: ['api'] },
  { term: 'REST API', kind: 'proper', category: 'api', fa: ['رست ای پی آی', 'رست‌ای‌پی‌آی', 'رست api'], en: ['restapi', 'rest api', 'restful'] },
  { term: 'GraphQL', kind: 'proper', category: 'api', fa: ['گراف کیو ال', 'گراف‌کیو‌ال', 'گرافکیوال', 'گراف کیو'], en: ['graph ql'] },
  { term: 'WebSocket', kind: 'proper', category: 'api', fa: ['وب سوکت', 'وب‌سوکت'], en: ['web socket', 'websockets'] },
  { term: 'JSON', kind: 'proper', category: 'data', fa: ['جیسون', 'جی سون', 'جی‌سون'], en: ['json'] },
  { term: 'XML', kind: 'proper', category: 'data', fa: ['اکس ام ال'], en: [] },
  { term: 'JWT', kind: 'proper', category: 'security', fa: ['جی دبلیو تی', 'جی‌دبلیو‌تی', 'جیوت'], en: ['jwt token'] },
  { term: 'OAuth', kind: 'proper', category: 'security', fa: ['او آث', 'اوآث', 'اُ آث'], en: ['oauth'] },
  { term: 'MySQL', kind: 'proper', category: 'database', fa: ['مای اس کیو ال', 'مای‌اس‌کیو‌ال', 'مای اس کیو'], en: ['mysql', 'my sql'] },
  { term: 'PostgreSQL', kind: 'proper', category: 'database', fa: ['پستگرس', 'پستگرس کیو ال', 'پستگرسکیوال', 'پستگرس‌کیو‌ال'], en: ['postgres', 'postgre sql', 'psql'] },
  { term: 'MongoDB', kind: 'proper', category: 'database', fa: ['مونگو دی بی', 'مونگو‌دی‌بی', 'مانگو دی بی', 'مونگودیبی'], en: ['mongo', 'mongo db'] },
  { term: 'SQLite', kind: 'proper', category: 'database', fa: ['اس کیو لایت', 'اس‌کیو‌لایت'], en: ['sql lite'] },
  { term: 'SQL', kind: 'proper', category: 'database', fa: ['اس کیو ال', 'اس‌کیو‌ال', 'سیکوئل'], en: ['sql'] },
  { term: 'Redis', kind: 'proper', category: 'database', fa: ['ردیس', 'رِدیس'], en: [] },
  { term: 'Firebase', kind: 'proper', category: 'backend', fa: ['فایربیس', 'فایر بیس', 'فایر‌بیس'], en: [] },
  { term: 'Supabase', kind: 'proper', category: 'backend', fa: ['سوپابیس', 'سوپا بیس'], en: [] },

  // ---------- CMS / e-commerce ----------
  { term: 'WordPress', kind: 'proper', category: 'cms', fa: ['وردپرس', 'ورد پرس', 'ووردپرس'], en: ['wordpress'] },
  { term: 'WooCommerce', kind: 'proper', category: 'ecommerce', fa: ['ووکامرس', 'وو کامرس', 'ووکامرس'], en: ['woo commerce', 'woocommerce'] },
  { term: 'Elementor', kind: 'proper', category: 'cms', fa: ['المنتور', 'المانتور'], en: [] },
  { term: 'Shopify', kind: 'proper', category: 'ecommerce', fa: ['شاپیفای', 'شاپی فای'], en: [] },
  { term: 'Magento', kind: 'proper', category: 'ecommerce', fa: ['مجنتو', 'مگنتو'], en: [] },

  // ---------- DevOps / infra ----------
  { term: 'Git', kind: 'proper', category: 'vcs', fa: ['گیت'], en: [] },
  { term: 'GitHub', kind: 'proper', category: 'vcs', fa: ['گیت هاب', 'گیت‌هاب', 'گیتهاب', 'گیت هاب'], en: ['github', 'git hub'] },
  { term: 'GitLab', kind: 'proper', category: 'vcs', fa: ['گیت لب', 'گیت‌لب', 'گیتلب'], en: ['gitlab', 'git lab'] },
  { term: 'Bitbucket', kind: 'proper', category: 'vcs', fa: ['بیت باکت', 'بیت‌باکت'], en: [] },
  { term: 'Docker', kind: 'proper', category: 'devops', fa: ['داکر', 'داکر'], en: [] },
  { term: 'Kubernetes', kind: 'proper', category: 'devops', fa: ['کوبرنتیز', 'کوبرنتس'], en: ['k8s'] },
  { term: 'Linux', kind: 'proper', category: 'os', fa: ['لینوکس'], en: ['ubuntu linux'] },
  { term: 'Ubuntu', kind: 'proper', category: 'os', fa: ['اوبونتو', 'اوبونتو'], en: [] },
  { term: 'Debian', kind: 'proper', category: 'os', fa: ['دبیان'], en: [] },
  { term: 'Windows', kind: 'proper', category: 'os', fa: ['ویندوز', 'ویندوز'], en: [] },
  { term: 'macOS', kind: 'proper', category: 'os', fa: ['مک او اس', 'مک‌او‌اس'], en: ['mac os', 'macosx'] },
  { term: 'AWS', kind: 'proper', category: 'cloud', fa: ['ای دبلیو اس', 'آمازون'], en: [] },
  { term: 'Azure', kind: 'proper', category: 'cloud', fa: ['آژور', 'اژور'], en: [] },
  { term: 'Google Cloud', kind: 'proper', category: 'cloud', fa: ['گوگل کلود', 'جی سی پی'], en: [] },
  { term: 'Vercel', kind: 'proper', category: 'hosting', fa: ['ورسل', 'ورسل'], en: [] },
  { term: 'Netlify', kind: 'proper', category: 'hosting', fa: ['نتلیفای', 'نتلی فای'], en: [] },
  { term: 'Cloudflare', kind: 'proper', category: 'hosting', fa: ['کلادفلر', 'کلاد فلر', 'کلاودفلر'], en: ['cloud flare'] },
  { term: 'Nginx', kind: 'proper', category: 'server', fa: ['انجینکس', 'اِن جینکس'], en: ['engine x'] },
  { term: 'Apache', kind: 'proper', category: 'server', fa: ['آپاچی'], en: [] },
  { term: 'CI/CD', kind: 'proper', category: 'devops', fa: ['سی آی سی دی', 'سی‌آی‌سی‌دی'], en: ['ci cd', 'cicd'] },
  { term: 'DevOps', kind: 'proper', category: 'devops', fa: ['دواپس', 'دِواپس'], en: ['dev ops'] },

  // ---------- Tools ----------
  { term: 'NPM', kind: 'proper', category: 'tooling', fa: ['ان پی ام', 'ان‌پی‌ام', 'ان پی ام'], en: ['npm'] },
  { term: 'Yarn', kind: 'proper', category: 'tooling', fa: ['یارن'], en: [] },
  { term: 'PNPM', kind: 'proper', category: 'tooling', fa: ['پی ان پی ام', 'پی‌ان‌پی‌ام'], en: ['pnpm'] },
  { term: 'ESLint', kind: 'proper', category: 'tooling', fa: ['ای اس لینت', 'ای‌اس‌لینت'], en: ['es lint'] },
  { term: 'Prettier', kind: 'proper', category: 'tooling', fa: ['پریتی‌آر', 'پریتی آر'], en: [] },
  { term: 'Jest', kind: 'proper', category: 'testing', fa: ['جست'], en: [] },
  { term: 'Cypress', kind: 'proper', category: 'testing', fa: ['سایپرس', 'سایپرس'], en: [] },
  { term: 'Playwright', kind: 'proper', category: 'testing', fa: ['پلی‌رایت', 'پلی رایت'], en: [] },
  { term: 'Chrome', kind: 'proper', category: 'browser', fa: ['کروم', 'گوگل کروم'], en: ['google chrome'] },
  { term: 'Chrome Extension', kind: 'proper', category: 'browser', fa: ['کروم اکستنشن', 'اکستنشن کروم', 'کروم‌اکستنشن'], en: ['chrome extensions', 'chrome addon'] },
  { term: 'Chrome DevTools', kind: 'proper', category: 'browser', fa: ['کروم دولوپر تولز', 'دولوپر تولز'], en: ['devtools', 'dev tools'] },
  { term: 'Firefox', kind: 'proper', category: 'browser', fa: ['فایرفاکس'], en: [] },
  { term: 'Safari', kind: 'proper', category: 'browser', fa: ['سافاری'], en: [] },
  { term: 'VS Code', kind: 'proper', category: 'editor', fa: ['وی اس کد', 'وی‌اس‌کد'], en: ['vscode', 'vs studio code'] },
  { term: 'JetBrains', kind: 'proper', category: 'editor', fa: ['جت‌برینز', 'جت برینز'], en: [] },
  { term: 'Postman', kind: 'proper', category: 'tooling', fa: ['پستمن', 'پست‌من'], en: [] },
  { term: 'Figma', kind: 'proper', category: 'design', fa: ['فیگما'], en: [] },
  { term: 'Photoshop', kind: 'proper', category: 'design', fa: ['فتوشاپ'], en: [] },

  // ---------- AI / ML ----------
  { term: 'OpenAI', kind: 'proper', category: 'ai', fa: ['اوپن ای آی', 'اوپن‌ای‌آی', 'اوپن ای'], en: ['open ai'] },
  { term: 'ChatGPT', kind: 'proper', category: 'ai', fa: ['چت جی پی تی', 'چت‌جی‌پی‌تی', 'چت جی بی تی'], en: ['chat gpt'] },
  { term: 'Whisper', kind: 'proper', category: 'ai', fa: ['ویسپر', 'ویسپِر'], en: [] },
  { term: 'TensorFlow', kind: 'proper', category: 'ai', fa: ['تنسورفلو', 'تنسور فلو'], en: ['tensor flow'] },
  { term: 'PyTorch', kind: 'proper', category: 'ai', fa: ['پای‌تورچ', 'پای تورچ'], en: ['py torch'] },
  { term: 'LLM', kind: 'proper', category: 'ai', fa: ['ال ال ام'], en: ['large language model'] },

  // ---------- Web / SEO / product ----------
  { term: 'SEO', kind: 'proper', category: 'marketing', fa: ['اس ای او', 'اس‌ای‌او'], en: ['seo'] },
  { term: 'URL', kind: 'proper', category: 'web', fa: ['یو آر ال', 'یو‌آر‌ال', 'یو ار ال'], en: ['url'] },
  { term: 'HTTP', kind: 'proper', category: 'web', fa: ['اچ تی تی پی', 'اچ‌تی‌تی‌پی'], en: ['http'] },
  { term: 'HTTPS', kind: 'proper', category: 'web', fa: ['اچ تی تی پی اس', 'اچ‌تی‌تی‌پی‌اس'], en: ['https'] },
  { term: 'HTTP/2', kind: 'proper', category: 'web', fa: ['اچ تی تی پی دو'], en: ['http2'] },
  { term: 'CDN', kind: 'proper', category: 'web', fa: ['سی دی ان', 'سی‌دی‌ان'], en: ['cdn'] },
  { term: 'DNS', kind: 'proper', category: 'network', fa: ['دی ان اس', 'دی‌ان‌اس'], en: ['dns'] },
  { term: 'SSH', kind: 'proper', category: 'network', fa: ['اس اس اچ', 'اس‌اس‌اچ'], en: ['ssh'] },
  { term: 'FTP', kind: 'proper', category: 'network', fa: ['اف تی پی'], en: [] },
  { term: 'VPN', kind: 'proper', category: 'network', fa: ['وی پی ان', 'وی‌پی‌ان'], en: ['vpn'] },
  { term: 'CRM', kind: 'proper', category: 'product', fa: ['سی آر ام', 'سی‌آر‌ام'], en: ['crm'] },
  { term: 'ERP', kind: 'proper', category: 'product', fa: ['ای آر پی'], en: [] },
  { term: 'UI', kind: 'proper', category: 'design', fa: ['یو آی', 'یو‌آی'], en: ['ui'] },
  { term: 'UX', kind: 'proper', category: 'design', fa: ['یو ایکس', 'یو‌ایکس'], en: ['ux'] },
  { term: 'Figma Design', kind: 'proper', category: 'design', fa: ['فیگما دیزاین'], en: [] },
  { term: 'Frontend', kind: 'proper', category: 'web', fa: ['فرانت اند', 'فرانت‌اند', 'فرانت‌اِند', 'فرونت اند'], en: ['front end', 'front-end'] },
  { term: 'Backend', kind: 'proper', category: 'web', fa: ['بک اند', 'بک‌اند', 'بک‌اِند'], en: ['back end', 'back-end'] },
  { term: 'Full Stack', kind: 'proper', category: 'web', fa: ['فول استک', 'فول‌استک', 'فول استک'], en: ['fullstack', 'full-stack'] },
  { term: 'Landing Page', kind: 'proper', category: 'marketing', fa: ['لندینگ پیج', 'صفحه فرود'], en: ['landingpage'] },
  { term: 'Responsive', kind: 'proper', category: 'web', fa: ['ریسپانسیو', 'ریسپانسیو'], en: ['responsive design'] },
  { term: 'Dashboard', kind: 'proper', category: 'product', fa: ['داشبورد', 'داش بورد'], en: [] },
  { term: 'Framework', kind: 'generic', category: 'web', fa: ['فریمورک', 'فریم ورک'], en: ['framework'] },
  { term: 'Debug', kind: 'generic', category: 'dev', fa: ['دیباگ', 'دیباگ کردن'], en: ['debugging'] },
  { term: 'Deploy', kind: 'generic', category: 'devops', fa: ['دیپلوی', 'دیپلوی کردن'], en: ['deployment', 'deploying'] },
  { term: 'Commit', kind: 'generic', category: 'vcs', fa: ['کامیت'], en: ['git commit'] },
  { term: 'Merge Request', kind: 'generic', category: 'vcs', fa: ['مرج ریکوئست', 'پول ریکوئست'], en: [] },
  { term: 'Database', kind: 'generic', category: 'database', fa: ['دیتابیس', 'دیتا بیس'], en: [] },
  { term: 'Server', kind: 'generic', category: 'infra', fa: ['سرور'], en: [] },
  { term: 'Cache', kind: 'generic', category: 'dev', fa: ['کش'], en: ['caching'] },
  { term: 'Bug', kind: 'generic', category: 'dev', fa: ['باگ'], en: [] },
  { term: 'Code Review', kind: 'generic', category: 'dev', fa: ['کد ریویو', 'ریویو'], en: [] },
  { term: 'Authentication', kind: 'generic', category: 'security', fa: ['اتنتیکیشن', 'احراز هویت'], en: ['auth', 'authentication'] },
  { term: 'Authorization', kind: 'generic', category: 'security', fa: ['اتوریزیشن'], en: ['authorisation'] },
  { term: 'Session', kind: 'generic', category: 'security', fa: ['سشن'], en: [] },
  { term: 'Cookie', kind: 'generic', category: 'web', fa: ['کوکی'], en: [] },
  { term: 'Component', kind: 'generic', category: 'frontend', fa: ['کامپوننت', 'کامپوننت‌'], en: [] },
  { term: 'Hook', kind: 'generic', category: 'frontend', fa: ['هوک'], en: [] },
  { term: 'Props', kind: 'generic', category: 'frontend', fa: ['پراپس', 'پراپ'], en: [] },
  { term: 'State', kind: 'generic', category: 'frontend', fa: ['استیت'], en: [] },
  { term: 'Lorem Ipsum', kind: 'generic', category: 'design', fa: ['لورم ایپسوم'], en: [] }
];

/** Latin-word casing fixes applied even without a lexicon hit (very common in dictation). */
export const CASING_HINTS = Object.freeze({
  i: 'I',
  api: 'API', apis: 'APIs',
  ui: 'UI', ux: 'UX',
  id: 'ID', ids: 'IDs',
  url: 'URL', urls: 'URLs',
  http: 'HTTP', https: 'HTTPS',
  html: 'HTML', css: 'CSS',
  json: 'JSON', xml: 'XML', jwt: 'JWT', sql: 'SQL', php: 'PHP',
  npm: 'NPM', pnpm: 'PNPM', seo: 'SEO', crm: 'CRM', erp: 'ERP', cdn: 'CDN', dns: 'DNS',
  ssh: 'SSH', ftp: 'FTP', vpn: 'VPN', aws: 'AWS', gcp: 'GCP', ci: 'CI', cd: 'CD'
});

/** Persian function words — language detection + smart punctuation rely on these. */
export const FA_STOPWORDS = Object.freeze([
  'و', 'در', 'به', 'از', 'که', 'این', 'را', 'با', 'است', 'برای', 'آن', 'یک', 'خود', 'تا', 'هم',
  'همچنین', 'اما', 'یا', 'اگر', 'چون', 'بر', 'بی', 'من', 'تو', 'او', 'ما', 'شما', 'آنها', 'آن‌ها',
  'می‌خواهم', 'می‌خوام', 'میشه', 'می‌شود', 'شود', 'کرد', 'کردم', 'کند', 'کنم', 'دارم', 'دارد',
  'بود', 'هست', 'نیست', 'باید', 'می‌توان', 'می‌توانم', 'میتوانم', 'الان', 'حالا', 'چطور', 'چی',
  'کجا', 'چرا', 'کی', 'چند', 'چقدر', 'آیا', 'مگه', 'بعد', 'قبل', 'روی', 'توی', 'داخل', 'بیرون',
  'همه', 'هر', 'بعضی', 'چندتا', 'خوب', 'بد', 'بزرگ', 'کوچک', 'جدید', 'قبلی', 'امروز', 'دیروز',
  'فردا', 'صبح', 'شب', 'سلام', 'ممنون', 'مرسی', 'لطفاً', 'لطفا', 'بله', 'نه', 'آره', 'خب'
]);

export const EN_STOPWORDS = Object.freeze([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'have', 'has', 'had', 'will',
  'would', 'can', 'could', 'should', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that',
  'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'not', 'no', 'yes', 'hello', 'thanks',
  'today', 'tomorrow', 'yesterday', 'please', 'about', 'from', 'into', 'because', 'so', 'what',
  'where', 'when', 'why', 'how', 'which', 'who'
]);

export const AR_STOPWORDS = Object.freeze([
  'من', 'في', 'على', 'إلى', 'الى', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'كان', 'كانت', 'يكون',
  'هو', 'هي', 'هم', 'نحن', 'أنا', 'انا', 'لا', 'ما', 'أن', 'ان', 'قد', 'كل', 'بعد', 'قبل', 'مع',
  'عن', 'حتى', 'لكن', 'أو', 'او', 'ثم', 'هناك', 'هنالك', 'شكرا', 'مرحبا', 'السلام', 'عليكم'
]);

/** Words that must never be rewritten by the half-space / transliteration rules. */
export const PROTECTED_FA_WORDS = Object.freeze([
  'تنها', 'آنها', 'انها', 'اینها', 'بیشتر', 'کمتر', 'بهتر', 'دختر', 'دفتر', 'اختر', 'بستر',
  'خواهش', 'دانش', 'کوشش', 'گردش', 'بخش', 'میلیون', 'میلیارد', 'میزان', 'میز', 'میان', 'میوه',
  'میهن', 'میدان', 'میکرو', 'میلی', 'میراث', 'میلادی', 'میلیمتر', 'نظام', 'تمام', 'آرام',
  'کدام', 'حرام', 'سلام', 'کلام', 'بنام', 'تمام‌', 'کارها', 'راه‌ها', 'بهترین', 'تهی', 'نهی'
]);
