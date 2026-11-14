import { describe, expect, it } from 'vitest';
import { ResponseFormatError, SnapshotMismatchError } from './errors';
import { loadConsistent, SnapshotCoordinator } from './snapshot';
import { loadStockList, STOCK_LIST_PAGE_SIZE, stockPath } from './stocks';
import { manyStocks, stockListServer } from '../test/fixtures';
import { jsonResponse, requestUrl, stubFetch } from '../test/stubFetch';

const load = (signal?: AbortSignal) =>
  loadConsistent(loadStockList, { coordinator: new SnapshotCoordinator(), signal });

describe('loadStockList', () => {
  it('fetches every page with the maximum page size, without repeating pages', async () => {
    const stocks = manyStocks(250);
    const fetch = stubFetch(stockListServer(stocks));

    const result = await load();

    expect(result).toEqual({ snapshot: 1, data: stocks });
    const offsets = fetch.mock.calls.map(([input]) => requestUrl(input).searchParams);
    expect(offsets.map((p) => [p.get('limit'), p.get('offset')])).toEqual([
      [String(STOCK_LIST_PAGE_SIZE), '0'],
      [String(STOCK_LIST_PAGE_SIZE), '100'],
      [String(STOCK_LIST_PAGE_SIZE), '200'],
    ]);
  });

  it('makes one request for an empty dataset', async () => {
    const fetch = stubFetch(stockListServer([]));
    await expect(load()).resolves.toEqual({ snapshot: 1, data: [] });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('discards accumulated pages and restarts from the first page when the snapshot changes', async () => {
    const stocks = manyStocks(150);
    // Call 0 (page 1) at snapshot 1, then the dataset is replaced: every later call is snapshot 2.
    const fetch = stubFetch(stockListServer(stocks, (call) => (call === 0 ? 1 : 2)));

    const result = await load();

    expect(result).toEqual({ snapshot: 2, data: stocks });
    const offsets = fetch.mock.calls.map(([input]) => requestUrl(input).searchParams.get('offset'));
    expect(offsets).toEqual(['0', '100', '0', '100']);
  });

  it('fails with a recoverable error if the snapshot keeps changing', async () => {
    stubFetch(stockListServer(manyStocks(150), (call) => call + 1));
    await expect(load()).rejects.toBeInstanceOf(SnapshotMismatchError);
  });

  it('stops and propagates cancellation', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = load(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    [
      'a total that changes within one snapshot',
      (offset: number) => ({
        data: manyStocks(150).slice(offset, offset + 100),
        pagination: { limit: 100, offset, total: offset === 0 ? 150 : 151 },
      }),
    ],
    [
      'an empty page before the reported total',
      (offset: number) => ({
        data: offset === 0 ? manyStocks(100) : [],
        pagination: { limit: 100, offset, total: 150 },
      }),
    ],
    [
      'repeated tickers across pages',
      (offset: number) => ({
        data: manyStocks(100).slice(0, offset === 0 ? 100 : 50),
        pagination: { limit: 100, offset, total: 150 },
      }),
    ],
  ])('rejects %s', async (_name, page) => {
    stubFetch((url) => jsonResponse(page(Number(url.searchParams.get('offset'))), { snapshot: 1 }));
    await expect(load()).rejects.toBeInstanceOf(ResponseFormatError);
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
