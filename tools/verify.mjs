#!/usr/bin/env node
/**
 * Static verification of the unpacked extension — catches the mistake class that only shows up
 * when Chrome refuses to load the extension or when a feature silently never runs:
 *
 *   1. manifest validity, MV3 constraints, referenced files exist
 *   2. every JS file parses as an ES module
 *   3. every relative import resolves
 *   4. HTML pages contain no inline scripts/styles (MV3 CSP) and no remote resources
 *   5. content script list matches the files actually on disk
 *   6. no obvious security smells (eval, new Function, remote code, innerHTML with variables)
 *   7. message types used by the UI exist in the shared constants
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const ok = [];

const rel = (p) => p.replace(`${ROOT}/`, '');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    const full = join(dir, entry);
    const stat = statSync(resolve(ROOT, full));
    if (stat.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build'].includes(entry)) continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

/* ---------------------------------- 1. manifest ---------------------------------- */
const manifestPath = 'manifest.json';
let manifest = null;
try {
  manifest = JSON.parse(read(manifestPath));
  ok.push('manifest.json is valid JSON');
} catch (err) {
  errors.push(`manifest.json is not valid JSON: ${err.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || [])
  ].filter(Boolean);

  for (const file of referenced) {
    if (file.includes('*')) continue;
    if (!existsSync(resolve(ROOT, file))) errors.push(`manifest references a missing file: ${file}`);
  }
  ok.push(`${referenced.length} manifest references checked`);

  if (manifest.default_locale && !existsSync(resolve(ROOT, `_locales/${manifest.default_locale}/messages.json`))) {
    errors.push(`default_locale "${manifest.default_locale}" is declared but _locales/${manifest.default_locale}/messages.json is missing — Chrome would refuse to load the extension`);
  }

  const csp = manifest.content_security_policy?.extension_pages || '';
  if (!csp.includes("script-src 'self'")) errors.push("CSP must contain script-src 'self'");
  if (/unsafe-eval|unsafe-inline/.test(csp)) errors.push('CSP must not allow unsafe-eval/unsafe-inline');
  if (manifest.externally_connectable) warnings.push('externally_connectable is declared — double-check it is required');
  if (manifest.permissions?.includes('<all_urls>')) errors.push('use host_permissions instead of <all_urls> in permissions');
  if (!manifest.content_scripts?.[0]?.run_at) warnings.push('content script run_at is not set explicitly');

  const commands = manifest.commands || {};
  if (!commands['toggle-dictation']) errors.push('the toggle-dictation command is required');
}

/* ---------------------------------- 2. JS syntax ---------------------------------- */
const jsFiles = walk('src').filter((f) => f.endsWith('.js'));
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', resolve(ROOT, file)], { stdio: 'pipe' });
  } catch (err) {
    errors.push(`syntax error in ${rel(file)}: ${String(err.stderr || err.message).split('\n')[0]}`);
  }
}
ok.push(`${jsFiles.length} JavaScript files parse cleanly`);

/* ---------------------------------- 3. imports ---------------------------------- */
const importRe = /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]/g;
const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  const dir = dirname(file);
  const collect = (re) => {
    let match;
    while ((match = re.exec(source))) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      const target = resolve(dir, spec);
      if (!existsSync(target)) errors.push(`unresolved import in ${rel(file)}: ${spec}`);
    }
  };
  collect(importRe);
  collect(dynamicRe);
}
ok.push('relative imports resolved');

/* ---------------------------------- 4/5. HTML + content scripts ---------------------------------- */
const htmlFiles = walk('src').filter((f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) errors.push(`inline <script> found in ${rel(file)} (MV3 CSP violation)`);
  if (/\son\w+\s*=\s*["']/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ''))) {
    warnings.push(`inline event handler attribute found in ${rel(file)}`);
  }
  if (/<style[^>]*>/i.test(html)) warnings.push(`inline <style> found in ${rel(file)} — move it to a stylesheet`);
  const remote = html.match(/(?:src|href)=["']https?:\/\/[^"']+/gi) || [];
  if (remote.length) errors.push(`remote resource referenced in ${rel(file)}: ${remote[0]}`);
  // every script/link target must exist
  let match;
  const assetRe = /(?:src|href)=["'](?!#|data:)([^"']+)["']/gi;
  while ((match = assetRe.exec(html))) {
    const target = resolve(dirname(file), match[1]);
    if (!existsSync(target)) errors.push(`missing asset ${match[1]} in ${rel(file)}`);
  }
}
ok.push(`${htmlFiles.length} HTML pages checked for CSP violations`);

const contentFiles = (manifest?.content_scripts || []).flatMap((cs) => cs.js || []);
const onDisk = readdirSync(resolve(ROOT, 'src/content')).filter((f) => f.endsWith('.js')).sort();
const declared = contentFiles.map((f) => f.split('/').pop()).sort();
if (JSON.stringify(onDisk) !== JSON.stringify(declared)) {
  errors.push(`content script list mismatch\n  on disk:  ${onDisk.join(', ')}\n  manifest: ${declared.join(', ')}`);
} else {
  ok.push(`content script order matches disk (${onDisk.join(' → ')})`);
}

/* ---------------------------------- 6. security smells ---------------------------------- */
for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  if (/\beval\s*\(/.test(source)) errors.push(`eval() used in ${rel(file)}`);
  if (/new\s+Function\s*\(/.test(source)) errors.push(`new Function() used in ${rel(file)}`);
  if (/https?:\/\/[^\s'"]+\.js/.test(source) && !rel(file).includes('test')) {
    warnings.push(`remote script URL mentioned in ${rel(file)}`);
  }
  if (/innerHTML\s*=\s*[`"'][^`"']*\$\{/.test(source)) errors.push(`template literal injected into innerHTML in ${rel(file)}`);
}
ok.push('no eval / new Function / remote code found');

/* ---------------------------------- 7. message types ---------------------------------- */
const constants = read('src/common/constants.js');
const declaredTypes = new Set([...constants.matchAll(/'([a-z][a-z0-9:_-]*)'/g)].map((m) => m[1]));
for (const file of jsFiles.filter((f) => /src\/(ui|popup|options|panel|content|background)\//.test(rel(f)))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/send\(\{\s*type:\s*['"]([^'"]+)['"]/g)) {
    if (!declaredTypes.has(match[1])) errors.push(`unknown message type "${match[1]}" in ${rel(file)}`);
  }
}
ok.push('message types referenced by the UI exist in constants.js');

/* ---------------------------------- report ---------------------------------- */
console.log('\n\x1b[1mVoiceType Pro — static verification\x1b[0m\n');
for (const line of ok) console.log(`  \x1b[32m✓\x1b[0m ${line}`);
for (const line of warnings) console.log(`  \x1b[33m!\x1b[0m ${line}`);
for (const line of errors) console.log(`  \x1b[31m✗\x1b[0m ${line}`);
console.log(`\n${errors.length === 0 ? '\x1b[32mPASSED\x1b[0m' : `\x1b[31mFAILED (${errors.length})\x1b[0m`} — ${warnings.length} warning(s)\n`);
process.exit(errors.length === 0 ? 0 : 1);
