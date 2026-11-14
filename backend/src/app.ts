import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { createDatabase } from './db/database.js';
import { createDatasetRepository } from './modules/dataset/dataset.repository.js';
import { healthRouter } from './modules/health/health.routes.js';
import { createReadinessCheck } from './modules/health/health.service.js';
import { createStocksRepository } from './modules/stocks/stocks.repository.js';
import { stocksRouter } from './modules/stocks/stocks.routes.js';
import { createStocksService } from './modules/stocks/stocks.service.js';
import { createErrorHandler, notFoundHandler } from './shared/http/error-handlers.js';
import { logger as defaultLogger, type Logger } from './shared/logger.js';

export interface AppDependencies {
  pool: Pool;
  logger?: Logger;
}

/**
 * Composition root for the HTTP layer. Builds the Express app without binding a port, so tests can
 * drive it in-process. The pool is wrapped in the Database layer and handed to repositories only;
 * services and controllers never see it.
 */
export function createApp({ pool, logger = defaultLogger }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // No body parser: the API is read-only and accepts no request bodies.

  const database = createDatabase(pool, { logger });
  const datasetRepository = createDatasetRepository(database);
  const checkReadiness = createReadinessCheck(datasetRepository, logger);

  app.use('/health', healthRouter({ checkReadiness }));
  app.use('/api/stocks', stocksRouter(createStocksService(createStocksRepository(database))));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
