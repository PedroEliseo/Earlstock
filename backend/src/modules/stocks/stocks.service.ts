import { NotFoundError } from '../../shared/errors.js';
import type { Page, Pagination } from '../../shared/http/pagination.js';
import type { Stock, StocksRepository } from './stocks.repository.js';

export function createStocksService(repository: StocksRepository) {
  return {
    list(pagination: Pagination): Promise<Page<Stock>> {
      return repository.findPage(pagination);
    },

    async getById(id: string): Promise<Stock> {
      const stock = await repository.findById(id);
      if (!stock) throw new NotFoundError(`Stock ${id} not found`);
      return stock;
    },
  };
}

export type StocksService = ReturnType<typeof createStocksService>;
