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
  const { startNodeSDK, createAddHookMessageChannel } =
    await import('@elastic/opentelemetry-node/sdk');
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register('@elastic/opentelemetry-node/hook.mjs', import.meta.url, registerOptions);

  const sdk = startNodeSDK({ elasticSetupShutdownHandlers: false });
  // Read by src/shared/telemetry.ts; absent when telemetry is off.
  globalThis[Symbol.for('earlstock.telemetry')] = { shutdown: () => sdk.shutdown() };

  await waitForAllMessagesAcknowledged();
}
