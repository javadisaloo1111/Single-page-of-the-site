import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const requiredKeys = ["manifest_version", "name", "version", "background", "action", "options_ui", "commands"];
for (const key of requiredKeys) {
  if (!(key in manifest)) throw new Error(`manifest.json is missing ${key}`);
}
if (manifest.manifest_version !== 3) throw new Error("This project must remain Manifest V3");
if (manifest.background.type !== "module") throw new Error("The service worker must be an ES module");
if (manifest.background.service_worker !== "background.js") throw new Error("Unexpected service worker path");
if (manifest.action.default_popup !== "popup.html" || manifest.options_ui.page !== "options.html") {
  throw new Error("Popup or Options page path is inconsistent");
}
if (!manifest.commands["toggle-dictation"]?.global) throw new Error("The toggle shortcut must be global and configurable");
if (manifest.permissions.includes("<all_urls>") || manifest.host_permissions?.includes("<all_urls>")) {
  throw new Error("Broad all-sites permission is not allowed");
}
if (manifest.host_permissions?.length || manifest.optional_host_permissions?.length) {
  throw new Error("This Chrome-only build must not request host permissions");
}
if (!manifest.content_security_policy?.extension_pages?.includes("script-src 'self'")) {
  throw new Error("A restrictive extension-page CSP is required");
}

const offscreenSource = await readFile(new URL("offscreen.js", root), "utf8");
if (!/self\.SpeechRecognition\s*\|\|\s*self\.webkitSpeechRecognition/.test(offscreenSource)) {
  throw new Error("Chrome's built-in SpeechRecognition API must be the only recognition engine");
}
const speechEngineSource = await readFile(new URL("webspeech-engine.js", root), "utf8");
if (/\bWebSocket\b|fetch\s*\(/u.test(`${offscreenSource}\n${speechEngineSource}`)) {
  throw new Error("Offscreen recognition must not implement a separate network STT client");
}

const files = [
  "background.js", "offscreen.html", "offscreen.js", "webspeech-engine.js", "popup.html", "popup.js",
  "popup.css", "options.html", "options.js", "options.css", "content.js", "shared.js",
  "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"
];
for (const file of files) await access(new URL(file, root));

for (const [size, iconPath] of Object.entries(manifest.icons || {})) {
  const data = await readFile(new URL(iconPath, root));
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`${iconPath} is not a PNG`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== Number(size) || height !== Number(size)) throw new Error(`${iconPath} has unexpected dimensions`);
}

console.log(`Extension check passed: MV3, ${files.length} required files and ${Object.keys(manifest.icons || {}).length} icons verified.`);
