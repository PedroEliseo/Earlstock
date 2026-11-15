/*
 * Local-development OTLP relay for browser telemetry (EDOT Browser). NOT production-ready.
 *
 *   browser ──POST /otlp/v1/{traces,logs}──► Vite dev server ──/v1/{traces,logs}──► this relay
 *           ──► OTEL_EXPORTER_OTLP_ENDPOINT/v1/{traces,logs} (Elastic Managed OTLP)
 *
 * The browser never sees credentials: the upstream endpoint and its headers (the Authorization
 * header) come from the same ignored .env.observability.local the backend uses, loaded by
 * `npm run otlp-relay` with --env-file. Only the two OTLP signal paths EDOT Browser exports are
 * relayed (it has no metrics SDK), to one fixed upstream: this is not a general proxy.
 *
 * Controls: listens on 127.0.0.1 only; POST only; JSON or protobuf bodies up to a size limit;
 * expected Host and Origin (the Vite dev server); a global rate limit; a bounded upstream timeout
 * and no retries (the browser exporter retries a few times on 429/502/503/504). Responses are
 * generic and never include the upstream body. Nothing logged contains headers or payloads.
 *
 * Settings (all optional): EARLSTOCK_OTLP_RELAY_PORT (4319), EARLSTOCK_OTLP_RELAY_ORIGINS
 * (comma-separated; http://localhost:5173,http://127.0.0.1:5173), EARLSTOCK_OTLP_RELAY_MAX_BYTES
 * (1048576), EARLSTOCK_OTLP_RELAY_RATE_PER_MINUTE (120), EARLSTOCK_OTLP_RELAY_TIMEOUT_MS (5000).
 */
/* global fetch, AbortSignal -- Node.js globals (fetch is undici's) */
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createServer } from 'node:http';
import process from 'node:process';
import { URL } from 'node:url';

const HOST = '127.0.0.1';
const SIGNAL_PATHS = new Set(['/v1/traces', '/v1/logs']);
const CONTENT_TYPES = new Set(['application/json', 'application/x-protobuf']);
const CONTENT_ENCODINGS = new Set(['gzip']);

const port = intSetting('EARLSTOCK_OTLP_RELAY_PORT', 4319);
const maxBytes = intSetting('EARLSTOCK_OTLP_RELAY_MAX_BYTES', 1024 * 1024);
const ratePerMinute = intSetting('EARLSTOCK_OTLP_RELAY_RATE_PER_MINUTE', 120);
const timeoutMs = intSetting('EARLSTOCK_OTLP_RELAY_TIMEOUT_MS', 5000);
const allowedOrigins = new Set(
  (process.env.EARLSTOCK_OTLP_RELAY_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
// The Vite proxy keeps the browser's Host header (changeOrigin: false).
const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host));

const upstreamBase = parseEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
const upstreamHeaders = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
if (!upstreamBase) {
  console.error('otlp-relay: OTEL_EXPORTER_OTLP_ENDPOINT is not set; nothing to relay to.');
  process.exit(1);
}

// Token bucket shared by all clients (one developer's browser): `ratePerMinute` sustained, with
// bursts up to a quarter of it, so normal exporter batching (one request per signal every few
// seconds, plus a flush when a page is hidden) is never limited.
const capacity = Math.max(1, Math.ceil(ratePerMinute / 4));
let tokens = capacity;
let refilledAt = Date.now();
function takeToken() {
  const now = Date.now();
  tokens = Math.min(capacity, tokens + ((now - refilledAt) * ratePerMinute) / 60_000);
  refilledAt = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

const server = createServer((req, res) => {
  void handle(req, res).catch(() => {
    reply(res, 502);
  });
});
server.requestTimeout = timeoutMs * 2;
server.headersTimeout = timeoutMs;
server.listen(port, HOST, () => {
  console.log(
    `otlp-relay: listening on http://${HOST}:${String(port)}; relaying ${[...SIGNAL_PATHS].join(', ')} to the configured OTLP endpoint`,
  );
});

async function handle(req, res) {
  const path = (req.url ?? '').split('?', 1)[0];
  if (!SIGNAL_PATHS.has(path)) return reject(req, res, 404);
  if (req.method !== 'POST') return reject(req, res, 405, { Allow: 'POST' });
  if (!allowedHosts.has(req.headers.host ?? '')) return reject(req, res, 403);
  if (!allowedOrigins.has(req.headers.origin ?? '')) return reject(req, res, 403);

  const contentType = (req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (!CONTENT_TYPES.has(contentType)) return reject(req, res, 415);
  const encoding = (req.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (encoding && !CONTENT_ENCODINGS.has(encoding)) return reject(req, res, 415);

  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) return reject(req, res, 413);
  if (!takeToken()) return reject(req, res, 429, { 'Retry-After': '10' });

  const body = await readBody(req);
  if (body === null) return reject(req, res, 413);

  // Fresh headers: only the payload description and the configured upstream headers. Nothing from
  // the browser (cookies, authorization, origin) is forwarded.
  const headers = { ...upstreamHeaders, 'content-type': contentType };
  if (encoding) headers['content-encoding'] = encoding;

  let upstream;
  try {
    upstream = await fetch(new URL(path.slice(1), upstreamBase), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    await upstream.body?.cancel();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    console.warn(`otlp-relay: ${path} upstream ${timedOut ? 'timed out' : 'unreachable'}`);
    return reply(res, timedOut ? 504 : 502);
  }
  if (upstream.ok) return reply(res, 200, {}, contentType);
  console.warn(`otlp-relay: ${path} upstream answered ${String(upstream.status)}`);
  // 429 and 5xx are worth a (bounded) retry by the browser exporter; anything else is not.
  if (upstream.status === 429) return reply(res, 429, { 'Retry-After': '10' });
  return reply(res, upstream.status >= 500 ? 502 : 400);
}

/** The request body, or null once it exceeds the size limit (the rest is discarded). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(tooLarge ? null : Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function reject(req, res, status, headers = {}) {
  console.warn(`otlp-relay: rejected ${req.method ?? '?'} request with ${String(status)}`);
  req.resume();
  reply(res, status, headers);
}

/** Generic responses only: an empty OTLP success body, or no body at all. */
function reply(res, status, headers = {}, contentType = 'application/json') {
  if (res.headersSent) return;
  if (status === 200) {
    const body = contentType === 'application/json' ? '{}' : '';
    res.writeHead(200, { ...headers, 'content-type': contentType, 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  res.writeHead(status, { ...headers, 'cache-control': 'no-store' });
  res.end();
}

function intSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** The base URL with a trailing slash, so `v1/traces` resolves below it. */
function parseEndpoint(value) {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch {
    console.error('otlp-relay: OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL.');
    process.exit(1);
  }
}

/** OTEL_EXPORTER_OTLP_HEADERS format: comma-separated key=value pairs, values URL-encoded. */
function parseHeaders(value) {
  const headers = {};
  for (const pair of (value ?? '').split(',')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim().toLowerCase();
    if (key) headers[key] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return headers;
}
