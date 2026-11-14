import { describe, expect, it } from 'vitest';
import { loadConsistent, SnapshotCoordinator } from '../../api/snapshot';
import { addMonths } from '../../domain/dates';
import { makeBars, stockServer } from '../../test/fixtures';
import { jsonResponse, requestUrl, stubFetch } from '../../test/stubFetch';
import { loadComparison, StockNotFoundError } from './comparisonData';

const aaa = makeBars(300, 1);
const bbb = makeBars(200, 1); // starts later
const ccc = makeBars(50, 400); // ends long before the others

const load = (tickers: string[], signal?: AbortSignal) =>
  loadConsistent((fetch) => loadComparison(fetch, tickers, { kind: 'preset', preset: 'MAX' }), {
    coordinator: new SnapshotCoordinator(),
    signal,
  });

describe('loadComparison', () => {
  it('loads every stock and resolves the range on the COMMON coverage', async () => {
    stubFetch(stockServer({ AAA: aaa, BBB: bbb }));
    const { data } = await load(['AAA', 'BBB']);

    expect(data.common).toEqual({ firstDate: bbb[0]?.date, lastDate: aaa.at(-1)?.date });
    expect(data.range).toMatchObject({
      from: bbb[0]?.date,
      to: aaa.at(-1)?.date,
      selection: 'MAX',
    });
    expect(data.stocks.map((s) => [s.ticker, s.bars.length])).toEqual([
      ['AAA', 200],
      ['BBB', 200],
    ]);
  });

  it('anchors presets to the earliest last date of the selection', async () => {
    const endsEarlier = makeBars(300, 30);
    stubFetch(stockServer({ AAA: aaa, OLD: endsEarlier }));
    const { data } = await loadConsistent(
      (fetch) => loadComparison(fetch, ['AAA', 'OLD'], { kind: 'preset', preset: '1M' }),
      { coordinator: new SnapshotCoordinator() },
    );
    const last = endsEarlier.at(-1)?.date ?? '';
    expect(data.range).toMatchObject({ from: addMonths(last, -1), to: last });
  });

  it('reports no common coverage without loading prices', async () => {
    const fetch = stubFetch(stockServer({ AAA: aaa, CCC: ccc }));
    const { data } = await load(['AAA', 'CCC']);
    expect(data).toMatchObject({ common: null, range: null });
    expect(
      fetch.mock.calls.every(([input]) => !requestUrl(input).pathname.endsWith('/prices')),
    ).toBe(true);
  });

  it('pages through long histories for every stock', async () => {
    const long = makeBars(6000, 1);
    const longer = makeBars(6100, 1);
    const fetch = stubFetch(stockServer({ L1: long, L2: longer }));
    const { data } = await load(['L1', 'L2']);
    expect(data.stocks.map((s) => s.bars.length)).toEqual([6000, 6000]);
    const pricePages = fetch.mock.calls.filter(([input]) =>
      requestUrl(input).pathname.endsWith('/prices'),
    );
    expect(pricePages).toHaveLength(4); // two pages of up to 5000 bars per stock
  });

  it('restarts everything if any response comes from another snapshot', async () => {
    // The second metadata response is already from a new dataset.
    stubFetch(stockServer({ AAA: aaa, BBB: bbb }, (call) => (call === 0 ? 1 : 2)));
    const result = await load(['AAA', 'BBB']);
    expect(result.snapshot).toBe(2);
    expect(result.data.stocks).toHaveLength(2);
  });

  it('names a ticker the dataset does not contain', async () => {
    stubFetch(stockServer({ AAA: aaa }));
    await expect(load(['AAA', 'ZZZ'])).rejects.toEqual(new StockNotFoundError('ZZZ'));
  });

  it('propagates cancellation', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = load(['AAA', 'BBB'], controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed price pages', async () => {
    const server = stockServer({ AAA: aaa, BBB: bbb });
    stubFetch((url, init) =>
      url.pathname.endsWith('/prices')
        ? jsonResponse(
            { data: [aaa[1], aaa[0]], page: { limit: 5000, nextAfter: null } },
            { snapshot: 1 },
          )
        : server(url, init),
    );
    await expect(load(['AAA', 'BBB'])).rejects.toMatchObject({ name: 'ResponseFormatError' });
  });
});
