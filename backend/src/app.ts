import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { isDatabaseReachable } from './db/health.js';
import { healthRouter } from './modules/health/health.routes.js';
import { createDemoProvider } from './modules/market-data/demo.provider.js';
import type { MarketData } from './modules/market-data/market-data.factory.js';
import { createSyncLock } from './modules/market-data/sync.lock.js';
import { syncRouter } from './modules/market-data/sync.routes.js';
import { createSyncService } from './modules/market-data/sync.service.js';
import { createQuotesRepository } from './modules/quotes/quotes.repository.js';
import { quotesRouter } from './modules/quotes/quotes.routes.js';
import { createQuotesService } from './modules/quotes/quotes.service.js';
import { createStocksRepository } from './modules/stocks/stocks.repository.js';
import { stocksRouter } from './modules/stocks/stocks.routes.js';
import { createStocksService } from './modules/stocks/stocks.service.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handlers.js';

export interface AppDependencies {
  pool: Pool;
  /** Defaults to the synthetic demo provider, which needs no API key or network access. */
  marketData?: MarketData;
}

/**
 * Composition root for the HTTP layer. Builds the Express app without binding
 * a port, so tests can drive it in-process. The pool goes to repositories only;
 * controllers receive services, never the pool.
 */
export function createApp({
  pool,
  marketData = { provider: createDemoProvider(), budget: null },
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.use('/health', healthRouter({ checkDatabase: () => isDatabaseReachable(pool) }));
  const stocksService = createStocksService(createStocksRepository(pool));
  const quotesService = createQuotesService(createQuotesRepository(pool), stocksService);
  const syncService = createSyncService({
    marketData,
    stocks: stocksService,
    quotes: quotesService,
    lock: createSyncLock(pool),
  });

  app.use('/api/stocks/:stockId/quotes', quotesRouter(quotesService));
  app.use('/api/stocks', stocksRouter(stocksService));
  app.use('/api/sync', syncRouter(syncService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
