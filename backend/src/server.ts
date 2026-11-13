import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import { createMarketData } from './modules/market-data/market-data.factory.js';

const env = loadEnv();
const pool = createPool(env);
const marketData = createMarketData(env, pool);
const app = createApp({ pool, marketData });

const server = app.listen(env.PORT, () => {
  console.log(`EarlStock API listening on port ${String(env.PORT)} (${env.NODE_ENV})`);
  console.log(`Market data provider: ${marketData.provider.id}`);
});

/** Stop accepting HTTP traffic, let in-flight requests finish, then release DB connections. */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`${signal} received, shutting down`);
  let exitCode = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err) {
    console.error(err);
    exitCode = 1;
  }

  try {
    await pool.end();
  } catch (err) {
    console.error(err);
    exitCode = 1;
  }

  process.exit(exitCode);
}

process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));
