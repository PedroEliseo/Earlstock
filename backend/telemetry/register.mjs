/*
 * Optional EDOT Node.js preload: `node --import ./telemetry/register.mjs …`.
 *
 * Does the same as EDOT's documented `--import @elastic/opentelemetry-node` entry point (register
 * the ESM hook, start the SDK, wait for the loader), using only the package's public exports, with
 * two differences:
 *   - nothing is loaded unless an OTLP endpoint is configured, so the app behaves exactly as without
 *     telemetry when the observability settings are absent;
 *   - EDOT's own process handlers are disabled (they call process.exit on SIGTERM, racing the API's
 *     graceful shutdown); the app calls the returned shutdown() itself, with a time limit.
 */
import { register } from 'node:module';
import process from 'node:process';
import { isMainThread } from 'node:worker_threads';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

if (endpoint && isMainThread) {
  const { startNodeSDK, createAddHookMessageChannel, getInstrumentations, metrics } =
    await import('@elastic/opentelemetry-node/sdk');
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register('@elastic/opentelemetry-node/hook.mjs', import.meta.url, registerOptions);

  // Defaults for this application; an explicitly set variable still takes precedence.
  // - router: Express 5 delegates to the `router` package, which would duplicate every Express
  //   span; dns/net add a span per connection with no diagnostic value here (fs is off in EDOT).
  // - detectors: local process attributes only, so startup makes no cloud metadata requests.
  //   `serviceinstance` is required by Kibana's service metrics views.
  process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS ??= 'router,dns,net';
  process.env.OTEL_NODE_RESOURCE_DETECTORS ??= 'env,process,serviceinstance,os,host';

  // The pg instrumentation's pool metrics are updated from pool events, so they lag one event behind
  // (an idle pool still reports a used connection) and report max 0 after the pool ends. They are
  // dropped here with standard metric views; src/db/pool-metrics.ts exports accurate replacements
  // (earlstock.db.pool.*). The instrumentation's spans and its query-duration histogram are kept.
  const views = [
    'db.client.connection.count',
    'db.client.connection.pending_requests',
    'db.client.connection.max',
  ].map((instrumentName) => ({
    meterName: '@opentelemetry/instrumentation-pg',
    instrumentName,
    aggregation: { type: metrics.AggregationType.DROP },
  }));

  // URL privacy on HTTP server spans: `url.path` is one of the API's own route paths, with the ticker
  // replaced by `{ticker}`, or `/{unmatched}` for any other request, so no ticker, search text or
  // arbitrary path segment is exported; `url.query`, `server.address`/`server.port` (from the client's
  // Host header) and the client's network address are never exported. The allowlist mirrors the
  // routes in src/app.ts and src/modules/*/*.routes.ts (update it with them); it matches the way
  // Express does by default (case-insensitive, optional trailing slash) and exports the canonical
  // form. `http.route`, the status and span names are unchanged. instrumentation-http applies the
  // hook's attributes after its own, and the SDK ignores undefined attribute values.
  const ROUTE_PATHS = [
    [/^\/health\/?$/i, '/health'],
    [/^\/health\/ready\/?$/i, '/health/ready'],
    [/^\/api\/stocks\/?$/i, '/api/stocks'],
    [/^\/api\/stocks\/[^/]+\/?$/i, '/api/stocks/{ticker}'],
    [/^\/api\/stocks\/[^/]+\/prices\/?$/i, '/api/stocks/{ticker}/prices'],
  ];
  const exportedPath = (url) => {
    const path = (url ?? '').split(/[?#]/, 1)[0];
    return ROUTE_PATHS.find(([pattern]) => pattern.test(path))?.[1] ?? '/{unmatched}';
  };
  const httpConfig = {
    startIncomingSpanHook: (request) => ({
      'url.path': exportedPath(request.url),
      'url.query': undefined,
      // Taken from the client's Host header, so also user-controlled.
      'server.address': undefined,
      'server.port': undefined,
      // The client's IP address and port: not needed for diagnostics (user_agent.original is kept).
      'client.address': undefined,
      'network.peer.address': undefined,
      'network.peer.port': undefined,
    }),
  };
  // startNodeSDK disables host-metrics when metrics are off before building its default list; the
  // list is built here instead, so do the same.
  if (/(^|,)\s*none\s*(,|$)/.test(process.env.OTEL_METRICS_EXPORTER ?? '')) {
    const disabled = process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS;
    process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS = disabled
      ? `${disabled},host-metrics`
      : 'host-metrics';
  }
  // Expected client errors (4xx) passed to `next()`: the Express instrumentation records the error on
  // the request handler span, message and stack included, and has no option to filter it. Their
  // messages can echo request input ("Stock <ticker> not found", Express's own decoding errors), so
  // for them only the exception type is recorded and the span status keeps ERROR without the
  // message. Any other error (5xx) is recorded unchanged. requestHook receives each layer span when
  // it starts; the wrappers only change what these two calls record.
  const CLIENT_ERROR_NAMES = new Set(['NotFoundError', 'ValidationError']);
  const isClientError = (error) =>
    typeof error === 'object' &&
    error !== null &&
    (CLIENT_ERROR_NAMES.has(error.name) ||
      (Number.isInteger(error.status) && error.status >= 400 && error.status < 500));
  const expressConfig = {
    requestHook: (span) => {
      const recordException = span.recordException.bind(span);
      const setStatus = span.setStatus.bind(span);
      let clientError = false;
      span.recordException = (exception, time) => {
        clientError = isClientError(exception);
        return recordException(clientError ? { name: exception.name } : exception, time);
      };
      span.setStatus = (status) => setStatus(clientError ? { code: status.code } : status);
    },
  };

  const instrumentations = getInstrumentations({
    '@opentelemetry/instrumentation-http': httpConfig,
    '@opentelemetry/instrumentation-express': expressConfig,
  });

  const sdk = startNodeSDK({ elasticSetupShutdownHandlers: false, views, instrumentations });
  // Read by src/shared/telemetry.ts; absent when telemetry is off.
  globalThis[Symbol.for('earlstock.telemetry')] = { shutdown: () => sdk.shutdown() };

  await waitForAllMessagesAcknowledged();
}
