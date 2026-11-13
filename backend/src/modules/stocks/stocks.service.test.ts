import { DatabaseError } from 'pg';
import { PgErrorCode } from '../../db/errors.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type { Stock, StocksRepository } from './stocks.repository.js';
import { createStocksService } from './stocks.service.js';

const ID = '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c';
const input = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD' };
const stock: Stock = { id: ID, ...input, createdAt: new Date() };

function pgError(code: string): DatabaseError {
  return Object.assign(new DatabaseError('database error', 0, 'error'), { code });
}

function fakeRepository(overrides: Partial<StocksRepository> = {}): StocksRepository {
  return {
    findPage: () => Promise.resolve({ items: [stock], total: 1 }),
    findById: () => Promise.resolve(stock),
    create: () => Promise.resolve(stock),
    deleteById: () => Promise.resolve(true),
    ...overrides,
  };
}

describe('stocks service', () => {
  describe('getById', () => {
    it('returns the stock', async () => {
      await expect(createStocksService(fakeRepository()).getById(ID)).resolves.toBe(stock);
    });

    it('throws NotFoundError when the stock does not exist', async () => {
      const service = createStocksService(
        fakeRepository({ findById: () => Promise.resolve(null) }),
      );

      await expect(service.getById(ID)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('create', () => {
    it('returns the created stock', async () => {
      await expect(createStocksService(fakeRepository()).create(input)).resolves.toBe(stock);
    });

    it('translates a unique violation into ConflictError', async () => {
      const service = createStocksService(
        fakeRepository({ create: () => Promise.reject(pgError(PgErrorCode.UniqueViolation)) }),
      );

      const error = await service.create(input).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toHaveProperty('message', 'Stock NASDAQ:AAPL already exists');
    });

    it('rethrows unrelated errors unchanged', async () => {
      const failure = new Error('connection lost');
      const service = createStocksService(
        fakeRepository({ create: () => Promise.reject(failure) }),
      );

      await expect(service.create(input)).rejects.toBe(failure);
    });
  });

  describe('delete', () => {
    it('resolves when the stock was deleted', async () => {
      await expect(createStocksService(fakeRepository()).delete(ID)).resolves.toBeUndefined();
    });

    it('throws NotFoundError when nothing was deleted', async () => {
      const service = createStocksService(
        fakeRepository({ deleteById: () => Promise.resolve(false) }),
      );

      await expect(service.delete(ID)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('translates a foreign key violation into ConflictError', async () => {
      const service = createStocksService(
        fakeRepository({
          deleteById: () => Promise.reject(pgError(PgErrorCode.ForeignKeyViolation)),
        }),
      );

      await expect(service.delete(ID)).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
