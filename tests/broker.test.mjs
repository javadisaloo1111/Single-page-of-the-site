import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

let child;
let baseUrl;
let capturedOutput = "";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [fileURLToPath(new URL("../broker/server.mjs", import.meta.url))], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      SONIOX_API_KEY: "test-only-not-a-real-provider-key",
      BROKER_ACCESS_TOKEN: "test-broker-access-token",
      ALLOWED_ORIGINS: "chrome-extension://vocatyp-test-id"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { capturedOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { capturedOutput += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Broker exited early: ${capturedOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* wait for the listener */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Broker failed to start: ${capturedOutput}`);
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1500))]);
  if (child.exitCode === null) child.kill("SIGKILL");
});

test("health endpoint reveals readiness without exposing server credentials", async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.providerConfigured, true);
  assert.ok(!JSON.stringify(body).includes("test-only-not-a-real-provider-key"));
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("allows the configured extension CORS preflight and rejects other origins", async () => {
  const allowed = await fetch(`${baseUrl}/v1/session-token`, {
    method: "OPTIONS",
    headers: {
      Origin: "chrome-extension://vocatyp-test-id",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type"
    }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "chrome-extension://vocatyp-test-id");

  const blocked = await fetch(`${baseUrl}/v1/session-token`, {
    method: "OPTIONS",
    headers: { Origin: "chrome-extension://untrusted-id", "Access-Control-Request-Method": "POST" }
  });
  assert.equal(blocked.status, 403);
});

test("rejects invalid Broker tokens before calling the external provider", async () => {
  const response = await fetch(`${baseUrl}/v1/session-token`, {
    method: "POST",
    headers: { Origin: "chrome-extension://vocatyp-test-id", Authorization: "Bearer wrong-token", "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Invalid Broker Access Token/);
});

test("returns JSON 404 for unknown routes", async () => {
  const response = await fetch(`${baseUrl}/unknown`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Not found.");
});
