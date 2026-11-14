import { DatasetNotLoadedError, NotFoundError } from '../../shared/errors.js';
import type { ActiveSnapshot } from '../dataset/dataset.repository.js';
import type { DailyBar, StockDetail, StocksRepository } from './stocks.repository.js';
import { createStocksService } from './stocks.service.js';

const SNAPSHOT: ActiveSnapshot = { importId: 7, activatedAt: 'T0' };

const bar = (date: string): DailyBar => ({
  date,
  open: '10',
  high: '12',
  low: '9',
  close: '11',
  adjClose: '10.5',
  volume: '1000',
});

const detail: StockDetail = {
  ticker: 'AAPL',
  name: 'Apple Inc.',
  coverage: { firstDate: 'D1', lastDate: 'D3', tradingDays: 3 },
  latest: bar('D3'),
};

function fakeRepository(overrides: Partial<StocksRepository> = {}): StocksRepository {
  return {
    list: () => Promise.resolve({ snapshot: SNAPSHOT, total: 1, items: [] }),
    findDetail: () => Promise.resolve({ snapshot: SNAPSHOT, stock: detail }),
    findBars: () => Promise.resolve({ snapshot: SNAPSHOT, stockFound: true, bars: [] }),
    ...overrides,
  };
}

const noSnapshot = { snapshot: null } as const;

describe('stocks service', () => {
  describe('when no dataset snapshot is active', () => {
    const service = createStocksService(
      fakeRepository({
        list: () => Promise.resolve({ ...noSnapshot, total: 0, items: [] }),
        findDetail: () => Promise.resolve({ ...noSnapshot, stock: null }),
        findBars: () => Promise.resolve({ ...noSnapshot, stockFound: false, bars: [] }),
      }),
    );

    it.each([
      ['list', () => service.list({ limit: 20, offset: 0, sort: 'ticker', dir: 'asc' })],
      ['getStock', () => service.getStock('AAPL')],
      ['getPrices', () => service.getPrices('AAPL', {}, 10)],
    ])('%s throws DatasetNotLoadedError (before any not-found check)', async (_name, call) => {
      await expect(call()).rejects.toBeInstanceOf(DatasetNotLoadedError);
    });
  });

  it('returns the list together with the snapshot it was read from', async () => {
    await expect(
      createStocksService(fakeRepository()).list({
        limit: 20,
        offset: 0,
        sort: 'ticker',
        dir: 'asc',
      }),
    ).resolves.toEqual({ snapshot: SNAPSHOT, value: { items: [], total: 1 } });
  });

  it('getStock throws NotFoundError for a ticker without data in the snapshot', async () => {
    const service = createStocksService(
      fakeRepository({ findDetail: () => Promise.resolve({ snapshot: SNAPSHOT, stock: null }) }),
    );

    await expect(service.getStock('NOPE')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getPrices throws NotFoundError for an unknown ticker', async () => {
    const service = createStocksService(
      fakeRepository({
        findBars: () => Promise.resolve({ snapshot: SNAPSHOT, stockFound: false, bars: [] }),
      }),
    );

    await expect(service.getPrices('NOPE', {}, 10)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('getPrices pagination', () => {
    it('asks the repository for one extra bar and passes the range through', async () => {
      const calls: unknown[] = [];
      const service = createStocksService(
        fakeRepository({
          findBars: (...args) => {
            calls.push(args);
            return Promise.resolve({ snapshot: SNAPSHOT, stockFound: true, bars: [] });
          },
        }),
      );

      await service.getPrices('AAPL', { from: 'F', to: 'T', after: 'A' }, 2);

      expect(calls).toEqual([['AAPL', { from: 'F', to: 'T', after: 'A' }, 3]]);
    });

    it('returns nextAfter = last returned date when more bars exist', async () => {
      const service = createStocksService(
        fakeRepository({
          findBars: () =>
            Promise.resolve({
              snapshot: SNAPSHOT,
              stockFound: true,
              bars: [bar('D1'), bar('D2'), bar('D3')],
            }),
        }),
      );

      const { value } = await service.getPrices('AAPL', {}, 2);

      expect(value.bars.map((b) => b.date)).toEqual(['D1', 'D2']);
      expect(value.nextAfter).toBe('D2');
    });

    it('returns nextAfter = null on the last page, including an empty one', async () => {
      const exact = createStocksService(
        fakeRepository({
          findBars: () =>
            Promise.resolve({ snapshot: SNAPSHOT, stockFound: true, bars: [bar('D1'), bar('D2')] }),
        }),
      );
      const empty = createStocksService(fakeRepository());

      expect((await exact.getPrices('AAPL', {}, 2)).value.nextAfter).toBeNull();
      expect((await empty.getPrices('AAPL', {}, 2)).value).toEqual({ bars: [], nextAfter: null });
    });
  });
});
