/**
 * Reports errors caught by React error boundaries to telemetry. Such errors never reach the global
 * error handlers, so the browser SDK cannot see them on its own. Until (unless) telemetry is
 * started, reporting does nothing; this module has no telemetry dependency of its own, so it costs
 * nothing when telemetry is disabled.
 */
type ErrorReporter = (error: Error) => void;

let reporter: ErrorReporter | undefined;

export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

export function reportCaughtError(error: Error): void {
  try {
    reporter?.(error);
  } catch {
    // Telemetry is best-effort: a failing reporter must never affect the application.
  }
}
