import { isPgError, PgErrorCode } from '../../db/errors.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type { Page, Pagination } from '../../shared/http/pagination.js';
import type { CreateStockInput } from './stocks.schemas.js';
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

    /** Relies on UNIQUE (exchange, symbol) rather than a pre-check, which would race with concurrent inserts. */
    async create(input: CreateStockInput): Promise<Stock> {
      try {
        return await repository.create(input);
      } catch (err) {
        if (isPgError(err, PgErrorCode.UniqueViolation)) {
          throw new ConflictError(`Stock ${input.exchange}:${input.symbol} already exists`, {
            cause: err,
          });
        }
        throw err;
      }
    },

    /** A stock still referenced by another table cannot be deleted; its foreign key enforces this atomically. */
    async delete(id: string): Promise<void> {
      let deleted: boolean;
      try {
        deleted = await repository.deleteById(id);
      } catch (err) {
        if (isPgError(err, PgErrorCode.ForeignKeyViolation)) {
          throw new ConflictError(`Stock ${id} is still referenced and cannot be deleted`, {
            cause: err,
          });
        }
        throw err;
      }
      if (!deleted) throw new NotFoundError(`Stock ${id} not found`);
    },
  };
}

export type StocksService = ReturnType<typeof createStocksService>;
