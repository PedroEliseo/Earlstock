/**
 * Lifecycle of the optional telemetry SDK started by telemetry/register.mjs, and the application's
 * own spans. Without that preload (tests, migrations, telemetry not configured) every function here
 * is a no-op: the OpenTelemetry API then hands out non-recording spans.
 */
import { type Attributes, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { DatasetNotLoadedError, NotFoundError, ValidationError } from './errors.js';

const tracer = trace.getTracer('earlstock');

/** Outcomes the application expects and answers normally (4xx, or 503 while no dataset is loaded). */
function isExpectedError(err: unknown): boolean {
  return (
    err instanceof NotFoundError ||
    err instanceof ValidationError ||
    err instanceof DatasetNotLoadedError
  );
}

/**
 * Runs `operation` inside an active span named `name` (a stable, low-cardinality name), so the
 * database spans it causes become its children. Result and errors pass through unchanged. An
 * unexpected error marks the span as failed; the exception itself is not recorded here, since the
 * Express instrumentation already records it on the request handler span (once per request).
 *
 * Known limitation: the Express instrumentation records an exception and sets ERROR on the request
 * handler span for every error passed to `next()`, including expected 400/404 responses, and it has
 * no option to filter them. The HTTP server span (ERROR only for 5xx) and these `stocks.*` spans
 * (ERROR only for unexpected errors) keep the correct semantics; error rates and alerts should be
 * based on them or on the HTTP status code, not on the Express layer spans.
 */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await operation(span);
    } catch (err) {
      if (!isExpectedError(err)) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('error.type', err instanceof Error ? err.name : 'unknown');
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

interface TelemetryHandle {
  shutdown(): Promise<void>;
}

const HANDLE_KEY = Symbol.for('earlstock.telemetry');

/** Upper bound on how long flushing telemetry may delay process exit. */
export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 3000;

export type TelemetryShutdownResult = 'disabled' | 'flushed' | 'failed' | 'timed-out';

/**
 * Flushes and stops telemetry, waiting at most `timeoutMs`. Never throws: losing telemetry must not
 * change the outcome of the operation that is shutting down.
 */
export async function shutdownTelemetry(
  timeoutMs = TELEMETRY_SHUTDOWN_TIMEOUT_MS,
): Promise<TelemetryShutdownResult> {
  const handle = (globalThis as Record<symbol, TelemetryHandle | undefined>)[HANDLE_KEY];
  if (!handle) return 'disabled';

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timed-out');
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([
      handle.shutdown().then(
        () => 'flushed' as const,
        () => 'failed' as const,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
