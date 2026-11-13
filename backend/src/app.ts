import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { isDatabaseReachable } from './db/health.js';
import { healthRouter } from './modules/health/health.routes.js';
import { createStocksRepository } from './modules/stocks/stocks.repository.js';
import { stocksRouter } from './modules/stocks/stocks.routes.js';
import { createStocksService } from './modules/stocks/stocks.service.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handlers.js';

export interface AppDependencies {
  pool: Pool;
}

/**
 * Composition root for the HTTP layer. Builds the Express app without binding
 * a port, so tests can drive it in-process. The pool goes to repositories only;
 * controllers receive services, never the pool.
 */
export function createApp({ pool }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.use('/health', healthRouter({ checkDatabase: () => isDatabaseReachable(pool) }));
  app.use('/api/stocks', stocksRouter(createStocksService(createStocksRepository(pool))));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
