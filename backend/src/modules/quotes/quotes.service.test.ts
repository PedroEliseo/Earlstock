import { DatabaseError } from 'pg';
import { PgErrorCode } from '../../db/errors.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type { Stock } from '../stocks/stocks.repository.js';
import type { Quote, QuotesRepository } from './quotes.repository.js';
import { createQuotesService } from './quotes.service.js';

const STOCK_ID = '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c';
const input = {
  price: '189.25',
  volume: null,
  observedAt: '2026-01-02T15:30:00Z',
  provider: 'manual',
};
const quote: Quote = {
  id: '1',
  stockId: STOCK_ID,
  price: '189.25',
  volume: null,
  observedAt: new Date(input.observedAt),
  provider: 'manual',
  createdAt: new Date(),
};
const stock: Stock = {
  id: STOCK_ID,
  symbol: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'NASDAQ',
  currency: 'USD',
  createdAt: new Date(),
};
const query = { limit: 20, offset: 0 };

function pgError(code: string): DatabaseError {
  return Object.assign(new DatabaseError('database error', 0, 'error'), { code });
}

function fakeRepository(overrides: Partial<QuotesRepository> = {}): QuotesRepository {
  return {
    create: () => Promise.resolve(quote),
    insertMany: (_stockId, quotes) => Promise.resolve(quotes.length),
    findLatest: () => Promise.resolve(quote),
    findPage: () => Promise.resolve({ items: [quote], total: 1 }),
    ...overrides,
  };
}

const existingStock = { getById: () => Promise.resolve(stock) };
const missingStock = {
  getById: (id: string) => Promise.reject(new NotFoundError(`Stock ${id} not found`)),
};

describe('quotes service', () => {
  describe('create', () => {
    it('returns the created quote', async () => {
      const service = createQuotesService(fakeRepository(), existingStock);

      await expect(service.create(STOCK_ID, input)).resolves.toBe(quote);
    });

    it('translates a foreign key violation (unknown stock) into NotFoundError', async () => {
      const service = createQuotesService(
        fakeRepository({ create: () => Promise.reject(pgError(PgErrorCode.ForeignKeyViolation)) }),
        existingStock,
      );

      await expect(service.create(STOCK_ID, input)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('translates a unique violation (duplicate quote) into ConflictError', async () => {
      const service = createQuotesService(
        fakeRepository({ create: () => Promise.reject(pgError(PgErrorCode.UniqueViolation)) }),
        existingStock,
      );

      const error = await service.create(STOCK_ID, input).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toHaveProperty(
        'message',
        `A quote from provider "manual" observed at 2026-01-02T15:30:00Z already exists for stock ${STOCK_ID}`,
      );
    });

    it('rethrows unrelated errors unchanged', async () => {
      const failure = new Error('connection lost');
      const service = createQuotesService(
        fakeRepository({ create: () => Promise.reject(failure) }),
        existingStock,
      );

      await expect(service.create(STOCK_ID, input)).rejects.toBe(failure);
    });
  });

  describe('getLatest', () => {
    it('returns the latest quote', async () => {
      const service = createQuotesService(fakeRepository(), existingStock);

      await expect(service.getLatest(STOCK_ID)).resolves.toBe(quote);
    });

    it('returns null when the stock exists but has no quotes', async () => {
      const service = createQuotesService(
        fakeRepository({ findLatest: () => Promise.resolve(null) }),
        existingStock,
      );

      await expect(service.getLatest(STOCK_ID)).resolves.toBeNull();
    });

    it('throws NotFoundError for an unknown stock without querying quotes', async () => {
      let queried = false;
      const service = createQuotesService(
        fakeRepository({
          findLatest: () => {
            queried = true;
            return Promise.resolve(null);
          },
        }),
        missingStock,
      );

      await expect(service.getLatest(STOCK_ID)).rejects.toBeInstanceOf(NotFoundError);
      expect(queried).toBe(false);
    });
  });

  describe('listHistory', () => {
    it('returns a page of quotes', async () => {
      const service = createQuotesService(fakeRepository(), existingStock);

      await expect(service.listHistory(STOCK_ID, query)).resolves.toEqual({
        items: [quote],
        total: 1,
      });
    });

    it('throws NotFoundError for an unknown stock', async () => {
      const service = createQuotesService(fakeRepository(), missingStock);

      await expect(service.listHistory(STOCK_ID, query)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
