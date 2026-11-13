import { NotFoundError } from '../../shared/errors.js';
import type { Stock, StocksRepository } from './stocks.repository.js';
import { createStocksService } from './stocks.service.js';

const ID = '019a7d3c-8f2e-7a51-9c3b-2d4e6f8a0b1c';
const stock: Stock = { id: ID, ticker: 'AAPL', createdAt: new Date() };

function fakeRepository(overrides: Partial<StocksRepository> = {}): StocksRepository {
  return {
    findPage: () => Promise.resolve({ items: [stock], total: 1 }),
    findById: () => Promise.resolve(stock),
    ...overrides,
  };
}

describe('stocks service', () => {
  it('lists a page of stocks', async () => {
    await expect(
      createStocksService(fakeRepository()).list({ limit: 20, offset: 0 }),
    ).resolves.toEqual({ items: [stock], total: 1 });
  });

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
});
