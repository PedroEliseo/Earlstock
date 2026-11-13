import { Router } from 'express';
import { createStocksController } from './stocks.controller.js';
import type { StocksService } from './stocks.service.js';

export function stocksRouter(service: StocksService): Router {
  const controller = createStocksController(service);
  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.getById);
  router.delete('/:id', controller.remove);
  return router;
}
