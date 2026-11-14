import { shutdownTelemetry, TELEMETRY_SHUTDOWN_TIMEOUT_MS } from '../shared/telemetry.js';
import { main } from './cli.js';

/**
 * How long the process may stay alive after telemetry shutdown before the CLI exits explicitly. It is
 * taken from the telemetry shutdown limit, so telemetry delays the exit by at most that limit.
 */
const EXIT_GRACE_MS = 200;

/** Resolves once everything already written to `stream` has been handed to the OS. */
function drained(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.write('', () => {
      resolve();
    });
  });
}

// Entry point of `npm run import` (and of dist/importer/main.js in a build).
try {
  process.exitCode = await main(process.argv.slice(2));
} finally {
  // Short-lived process: flush telemetry before exiting (bounded; never changes the exit code).
  const telemetry = await shutdownTelemetry(TELEMETRY_SHUTDOWN_TIMEOUT_MS - EXIT_GRACE_MS);
  if (telemetry !== 'disabled') {
    // An unreachable telemetry endpoint can leave connection attempts open well beyond the
    // shutdown limit, keeping the process alive. This timer does not keep the process alive itself:
    // it only fires if something still does, and then ends the CLI with its own exit code once
    // pending output is written. Without telemetry the process ends naturally, as before.
    setTimeout(() => {
      void Promise.all([drained(process.stdout), drained(process.stderr)]).then(() => {
        process.exit(process.exitCode);
      });
    }, EXIT_GRACE_MS).unref();
  }
}
