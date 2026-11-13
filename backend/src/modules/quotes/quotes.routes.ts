import { Router } from 'express';
import { createQuotesController } from './quotes.controller.js';
import type { QuotesService } from './quotes.service.js';

/** Mounted under /api/stocks/:stockId/quotes; mergeParams exposes :stockId to the handlers. */
export function quotesRouter(service: QuotesService): Router {
  const controller = createQuotesController(service);
  const router = Router({ mergeParams: true });
  router.get('/', controller.listHistory);
  router.post('/', controller.create);
  router.get('/latest', controller.getLatest);
  return router;
}
