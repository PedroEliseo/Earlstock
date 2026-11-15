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
  const { startNodeSDK, createAddHookMessageChannel, metrics } =
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

  const sdk = startNodeSDK({ elasticSetupShutdownHandlers: false, views });
  // Read by src/shared/telemetry.ts; absent when telemetry is off.
  globalThis[Symbol.for('earlstock.telemetry')] = { shutdown: () => sdk.shutdown() };

  await waitForAllMessagesAcknowledged();
}
