/**
 * Browser telemetry with EDOT Browser (Elastic Distribution of OpenTelemetry Browser), a Technical
 * Preview: its configuration may change between releases, so the version is pinned exactly.
 *
 * Started by boot.ts, only when VITE_EARLSTOCK_TELEMETRY=1, before the application's own script, so
 * `fetch` is instrumented before any API request. Telemetry goes to the same origin (`/otlp`), which the
 * Vite dev server forwards to the local OTLP relay (backend `npm run otlp-relay`); the relay adds
 * the credentials, so none exist in the browser. Exports are batched and best-effort: if the relay
 * or Elastic is down, they fail quietly and the application is unaffected.
 *
 * Same-origin `/api` requests carry W3C trace context (`traceparent`), so the API's spans join the
 * browser's fetch span in one trace.
 */
import { startBrowserSdk } from '@elastic/opentelemetry-browser';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { setErrorReporter } from './reportError';
import { sanitizeUrl } from './sanitizeUrl';

export function startTelemetry(): void {
  startBrowserSdk({
    serviceName: 'earlstock-web',
    serviceVersion: '1.0.0',
    resourceAttributes: { 'deployment.environment.name': 'local' },
    logLevel: 'warn',
    exportConfig: { url: `${window.location.origin}/otlp` },
    // xhr: the application only uses fetch. navigation-timing and resource-timing export raw URLs
    // (no sanitizer hook), including third-party logo URLs that name tickers.
    disableInstrumentations: ['xhr', 'navigation-timing', 'resource-timing'],
    // Per-instrumentation settings use EDOT's advanced passthrough (it logs a warning at startup);
    // it is the only way to set the URL sanitizer.
    instrumentations: {
      fetch: { sanitizeUrl },
      navigation: { sanitizeUrl },
      'web-vitals': { sanitizeUrl },
    },
  });

  const logger = logs.getLogger('earlstock-web');
  setErrorReporter((error) => {
    // Same shape as EDOT's uncaught-error records, plus where it was caught. Only the error itself:
    // no component props, state or URL.
    logger.emit({
      eventName: 'exception',
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      attributes: {
        'exception.type': error.name,
        'exception.message': error.message,
        ...(error.stack ? { 'exception.stacktrace': error.stack } : {}),
        'earlstock.error.source': 'react.error_boundary',
      },
    });
  });
}
