/**
 * Entry point of browser telemetry. Not imported by the application: when VITE_EARLSTOCK_TELEMETRY=1,
 * vite.config.ts adds it to index.html as a module script placed before the application's, so it
 * runs first (module scripts run in document order), before any API request and before the page's
 * `load` event.
 *
 * Starting before `load` matters with EDOT Browser 0.5.0: it enables every instrumentation before
 * disabling the unwanted ones, and navigation timing emits at once if the page has already loaded,
 * which would export the raw page URL (query string included) despite being disabled.
 *
 * Best-effort: if starting fails, the application runs without telemetry.
 */
import { startTelemetry } from './startTelemetry';

try {
  startTelemetry();
} catch {
  // Telemetry unavailable; nothing in the application depends on it.
}
