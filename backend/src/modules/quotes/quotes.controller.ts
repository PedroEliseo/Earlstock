import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validation.js';
import {
  createQuoteSchema,
  quoteHistoryQuerySchema,
  stockIdParamsSchema,
} from './quotes.schemas.js';
import type { QuotesService } from './quotes.service.js';

export function createQuotesController(service: QuotesService) {
  return {
    create: async (req, res) => {
      const { stockId } = parseInput(stockIdParamsSchema, req.params);
      const input = parseInput(createQuoteSchema, req.body);
      res.status(201).json({ data: await service.create(stockId, input) });
    },

    getLatest: async (req, res) => {
      const { stockId } = parseInput(stockIdParamsSchema, req.params);
      res.json({ data: await service.getLatest(stockId) });
    },

    listHistory: async (req, res) => {
      const { stockId } = parseInput(stockIdParamsSchema, req.params);
      const query = parseInput(quoteHistoryQuerySchema, req.query);
      const { items, total } = await service.listHistory(stockId, query);
      res.json({ data: items, pagination: { limit: query.limit, offset: query.offset, total } });
    },
  } satisfies Record<string, RequestHandler>;
}
