import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_SETTINGS, getWebSpeechLanguage, sanitizeSettings } from "../shared.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("uses only Chrome's built-in Web Speech API with a least-privilege MV3 manifest", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "1.3.0");
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.commands["toggle-dictation"].global);
  assert.equal(manifest.commands["toggle-dictation"].suggested_key.default, "Ctrl+Shift+2");
  assert.ok(!manifest.permissions.includes("<all_urls>"));
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
  assert.equal(DEFAULT_SETTINGS.engine, "webspeech");
  assert.equal(DEFAULT_SETTINGS.language, "fa");
  assert.equal(getWebSpeechLanguage("auto"), "fa-IR");
  assert.equal(getWebSpeechLanguage("fa"), "fa-IR");
  assert.equal(getWebSpeechLanguage("en"), "en-US");
  assert.equal(getWebSpeechLanguage("ar"), "ar-SA");
  assert.equal(sanitizeSettings({ language: "auto" }).language, "fa");
  const migrated = sanitizeSettings({ engine: "soniox", tokenBrokerUrl: "https://example.test", brokerAccessToken: "obsolete" });
  assert.equal(migrated.engine, "webspeech");
  assert.equal("tokenBrokerUrl" in migrated, false);
  assert.equal("brokerAccessToken" in migrated, false);
});

test("recognition source has no third-party STT provider or token-broker dependency", async () => {
  const files = ["../background.js", "../offscreen.js", "../options.html", "../options.js", "../README.md"];
  for (const relative of files) {
    const text = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(text, /soniox|token broker|temporary-api-key/iu, relative);
  }
  const offscreen = await readFile(new URL("../offscreen.js", import.meta.url), "utf8");
  assert.match(offscreen, /SpeechRecognition\s*\|\|\s*self\.webkitSpeechRecognition/);
});
