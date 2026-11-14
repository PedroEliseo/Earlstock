/**
 * Lifecycle of the optional telemetry SDK started by telemetry/register.mjs. Without that preload
 * (tests, migrations, telemetry not configured) every function here is a no-op.
 */
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
