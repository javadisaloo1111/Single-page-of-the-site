import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "0.0.0.0";
const SONIOX_API_KEY = process.env.SONIOX_API_KEY || "";
const BROKER_ACCESS_TOKEN = process.env.BROKER_ACCESS_TOKEN || "";
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
const rateLimit = new Map();

function writeJson(response, status, body, origin = "") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {})
  });
  response.end(JSON.stringify(body));
}

function isAllowedOrigin(origin) {
  // No Origin header is allowed for local health checks and server-to-server diagnostics;
  // it does not bypass the Authorization check on the token endpoint.
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function constantTimeTokenMatch(received) {
  if (!BROKER_ACCESS_TOKEN || !received) return false;
  const expected = Buffer.from(BROKER_ACCESS_TOKEN);
  const actual = Buffer.from(received);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function rateLimited(key) {
  const now = Date.now();
  const item = rateLimit.get(key) || { start: now, count: 0 };
  if (now - item.start >= 60_000) {
    item.start = now;
    item.count = 0;
  }
  item.count++;
  rateLimit.set(key, item);
  if (rateLimit.size > 2000) {
    for (const [address, record] of rateLimit) if (now - record.start > 60_000) rateLimit.delete(address);
  }
  return item.count > 15;
}

async function readJson(request, maxBytes = 2048) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!total) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (!isAllowedOrigin(origin)) return writeJson(response, 403, { error: "Origin is not allowed." });
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";

  if (request.method === "OPTIONS") {
    if (!allowOrigin) return writeJson(response, 403, { error: "Origin is not allowed." });
    response.writeHead(204, {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    });
    return response.end();
  }

  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (request.method === "GET" && pathname === "/health") {
    return writeJson(response, 200, { ok: true, providerConfigured: Boolean(SONIOX_API_KEY), time: new Date().toISOString() }, allowOrigin);
  }

  if (request.method !== "POST" || pathname !== "/v1/session-token") {
    return writeJson(response, 404, { error: "Not found." }, allowOrigin);
  }
  if (!SONIOX_API_KEY || !BROKER_ACCESS_TOKEN) {
    return writeJson(response, 503, { error: "Broker is not configured. Set SONIOX_API_KEY and BROKER_ACCESS_TOKEN on the server." }, allowOrigin);
  }
  const address = request.socket.remoteAddress || "unknown";
  if (rateLimited(address)) return writeJson(response, 429, { error: "Too many token requests. Try again later." }, allowOrigin);
  const authorization = request.headers.authorization || "";
  const receivedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeTokenMatch(receivedToken)) return writeJson(response, 401, { error: "Invalid Broker Access Token." }, allowOrigin);

  let body;
  try { body = await readJson(request); }
  catch { return writeJson(response, 400, { error: "Invalid or oversized JSON body." }, allowOrigin); }
  const clientReferenceId = typeof body.client_reference_id === "string" ? body.client_reference_id.slice(0, 100) : "vocatyp-session";

  try {
    const providerResponse = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SONIOX_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        usage_type: "transcribe_websocket",
        expires_in_seconds: 60,
        single_use: true,
        max_session_duration_seconds: 1800,
        client_reference_id: clientReferenceId
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok || typeof payload.api_key !== "string") {
      // Never log or return the permanent key or request headers.
      console.warn("Soniox temporary-key request failed with status", providerResponse.status);
      return writeJson(response, 502, { error: "Soniox did not issue a temporary session key. Check the server key permissions and billing." }, allowOrigin);
    }
    return writeJson(response, 200, { api_key: payload.api_key, expires_at: payload.expires_at }, allowOrigin);
  } catch {
    console.warn("Soniox temporary-key service could not be reached.");
    return writeJson(response, 502, { error: "Could not connect to Soniox. Check server network access." }, allowOrigin);
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 17_000;
server.listen(PORT, HOST, () => {
  console.log(`VocaType token broker listening on ${HOST}:${PORT}`);
  if (!SONIOX_API_KEY || !BROKER_ACCESS_TOKEN) console.warn("Broker credentials are missing; token issuance is disabled.");
  if (ALLOWED_ORIGINS.size === 0) console.warn("ALLOWED_ORIGINS is empty; browser cross-origin requests will be rejected.");
});
