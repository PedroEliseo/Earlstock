import type { RequestHandler } from 'express';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { parseInput } from '../../shared/http/validation.js';
import { createStockSchema, stockIdParamsSchema } from './stocks.schemas.js';
import type { StocksService } from './stocks.service.js';

/** Maps HTTP to service calls: validate input, call the service, shape the response. */
export function createStocksController(service: StocksService) {
  return {
    list: async (req, res) => {
      const pagination = parseInput(paginationQuerySchema, req.query);
      const { items, total } = await service.list(pagination);
      res.json({ data: items, pagination: { ...pagination, total } });
    },

    getById: async (req, res) => {
      const { id } = parseInput(stockIdParamsSchema, req.params);
      res.json({ data: await service.getById(id) });
    },

    create: async (req, res) => {
      const input = parseInput(createStockSchema, req.body);
      const stock = await service.create(input);
      res.status(201).location(`${req.baseUrl}/${stock.id}`).json({ data: stock });
    },

    remove: async (req, res) => {
      const { id } = parseInput(stockIdParamsSchema, req.params);
      await service.delete(id);
      res.status(204).end();
    },
  } satisfies Record<string, RequestHandler>;
}
