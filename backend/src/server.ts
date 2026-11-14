import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool, poolStats } from './db/pool.js';
import { logger, serializeError } from './shared/logger.js';

const env = loadEnv();
const pool = createPool(env);
const app = createApp({ pool });

const server = app.listen(env.PORT, () => {
  logger.info('EarlStock API listening', { port: env.PORT, environment: env.NODE_ENV });
});

/** Stop accepting HTTP traffic, let in-flight requests finish, then release DB connections. */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info('shutting down', { signal, pool: poolStats(pool) });
  let exitCode = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err) {
    logger.error('failed to close the HTTP server', { error: serializeError(err) });
    exitCode = 1;
  }

  try {
    await pool.end();
  } catch (err) {
    logger.error('failed to close the database pool', { error: serializeError(err) });
    exitCode = 1;
  }

  process.exit(exitCode);
}

process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));
