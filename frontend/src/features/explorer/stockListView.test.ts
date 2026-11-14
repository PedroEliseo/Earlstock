import { describe, expect, it } from 'vitest';
import { daysAgo, stock } from '../../test/fixtures';
import { filterStocks, paginate, readViewState, sortStocks } from './stockListView';

const stocks = [
  stock('MSFT', 300, 1),
  stock('AAPL', 400, 1),
  stock('BRK.B', 400, 5),
  stock('aaa-lower', 100, 1), // only to prove case-insensitive matching on arbitrary data
  stock('^GSPC', 300, 5),
];

describe('filterStocks', () => {
  it('matches substrings case-insensitively', () => {
    expect(filterStocks(stocks, 'aa').map((s) => s.ticker)).toEqual(['AAPL', 'aaa-lower']);
    expect(filterStocks(stocks, 'Rk.').map((s) => s.ticker)).toEqual(['BRK.B']);
    expect(filterStocks(stocks, '^g').map((s) => s.ticker)).toEqual(['^GSPC']);
  });

  it('returns everything for a blank query, and a copy, never the input', () => {
    const result = filterStocks(stocks, '   ');
    expect(result).toEqual(stocks);
    expect(result).not.toBe(stocks);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterStocks(stocks, 'zzz')).toEqual([]);
  });
});

describe('sortStocks', () => {
  it('sorts tickers byte-wise in both directions', () => {
    expect(sortStocks(stocks, { key: 'ticker', direction: 'asc' }).map((s) => s.ticker)).toEqual([
      'AAPL',
      'BRK.B',
      'MSFT',
      '^GSPC',
      'aaa-lower',
    ]);
    expect(sortStocks(stocks, { key: 'ticker', direction: 'desc' }).map((s) => s.ticker)).toEqual([
      'aaa-lower',
      '^GSPC',
      'MSFT',
      'BRK.B',
      'AAPL',
    ]);
  });

  it('sorts by date and breaks ties by ticker ascending in both directions', () => {
    expect(sortStocks(stocks, { key: 'firstDate', direction: 'asc' }).map((s) => s.ticker)).toEqual(
      ['AAPL', 'BRK.B', 'MSFT', '^GSPC', 'aaa-lower'],
    );
    expect(sortStocks(stocks, { key: 'lastDate', direction: 'desc' }).map((s) => s.ticker)).toEqual(
      ['AAPL', 'MSFT', 'aaa-lower', 'BRK.B', '^GSPC'],
    );
  });

  it('is deterministic regardless of input order and never mutates the input', () => {
    const reversed = [...stocks].reverse();
    const frozen = Object.freeze([...stocks]);
    const order = { key: 'lastDate', direction: 'asc' } as const;
    expect(sortStocks(reversed, order)).toEqual(sortStocks(frozen, order));
    expect(frozen.map((s) => s.ticker)).toEqual(stocks.map((s) => s.ticker));
  });

  it('compares dates as calendar order', () => {
    const near = stock('NEAR', 2, 1);
    const far = stock('FAR', 2000, 1);
    expect(sortStocks([near, far], { key: 'firstDate', direction: 'asc' })[0]?.firstDate).toBe(
      daysAgo(2000),
    );
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 120 }, (_, i) => i + 1);

  it('returns the requested page with its range', () => {
    expect(paginate(items, 2, 50)).toMatchObject({
      page: 2,
      pageCount: 3,
      from: 51,
      to: 100,
      total: 120,
    });
    expect(paginate(items, 3, 50).items).toEqual(items.slice(100));
  });

  it.each([0, -1, 99, 1.5, Number.NaN])('clamps the invalid page %s into range', (page) => {
    const slice = paginate(items, page, 50);
    expect(slice.page).toBeGreaterThanOrEqual(1);
    expect(slice.page).toBeLessThanOrEqual(3);
  });

  it('handles an empty list as one empty page', () => {
    expect(paginate([], 1, 50)).toEqual({
      items: [],
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    });
  });
});

describe('readViewState', () => {
  it('reads valid parameters', () => {
    expect(readViewState(new URLSearchParams('q=aa&sort=lastDate&dir=desc&page=3'))).toEqual({
      query: 'aa',
      sortKey: 'lastDate',
      sortDirection: 'desc',
      page: 3,
    });
  });

  it('falls back to defaults for missing or invalid parameters', () => {
    expect(readViewState(new URLSearchParams('sort=price&dir=up&page=-2'))).toEqual({
      query: '',
      sortKey: 'ticker',
      sortDirection: 'asc',
      page: 1,
    });
  });
});
