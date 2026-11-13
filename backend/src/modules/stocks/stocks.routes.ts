import { Router } from 'express';
import { createStocksController } from './stocks.controller.js';
import type { StocksService } from './stocks.service.js';

/** Read-only: stock data is written exclusively by the data importer. */
export function stocksRouter(service: StocksService): Router {
  const controller = createStocksController(service);
  const router = Router();
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  return router;
}
