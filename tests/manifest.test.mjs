import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest declares a least-privilege MV3 extension with a remappable shortcut", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.commands["toggle-dictation"].global);
  assert.equal(manifest.commands["toggle-dictation"].suggested_key.default, "Ctrl+Shift+2");
  assert.ok(!manifest.permissions.includes("<all_urls>"));
  assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
});
