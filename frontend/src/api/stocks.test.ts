import { describe, expect, it } from 'vitest';
import { getStockListPage, stockPath } from './stocks';
import { manyStocks, stockListServer } from '../test/fixtures';
import { requestUrl, stubFetch } from '../test/stubFetch';

describe('getStockListPage', () => {
  it('requests exactly one page with its search and order, and returns it with its snapshot', async () => {
    const stocks = manyStocks(120);
    const fetch = stubFetch(stockListServer(stocks, () => 7));

    const result = await getStockListPage({
      limit: 50,
      offset: 50,
      q: ' t1 ',
      sort: 'lastDate',
      dir: 'desc',
    });

    expect(fetch).toHaveBeenCalledOnce();
    const params = requestUrl(fetch.mock.calls[0]?.[0] ?? '').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      limit: '50',
      offset: '50',
      q: 't1',
      sort: 'lastDate',
      dir: 'desc',
    });
    expect(result.snapshot).toBe(7);
    expect(result.data.pagination.total).toBe(21); // T100-T120 (tickers are zero-padded: T001…)
  });

  it('omits a blank search term and unset parameters', async () => {
    const fetch = stubFetch(stockListServer(manyStocks(3)));
    await getStockListPage({ limit: 20, offset: 0, q: '   ' });
    expect(Object.fromEntries(requestUrl(fetch.mock.calls[0]?.[0] ?? '').searchParams)).toEqual({
      limit: '20',
      offset: '0',
    });
  });

  it('propagates cancellation', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = getStockListPage({ limit: 50, offset: 0 }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('stockPath', () => {
  it.each([
    ['AAPL', '/stocks/AAPL'],
    ['BRK.B', '/stocks/BRK.B'],
    ['^GSPC', '/stocks/%5EGSPC'],
    ['EURUSD=X', '/stocks/EURUSD%3DX'],
  ])('encodes %s', (ticker, path) => {
    expect(stockPath(ticker)).toBe(path);
  });
});
