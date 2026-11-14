import { describe, expect, it } from 'vitest';
import { loadConsistent, SnapshotCoordinator } from '../../api/snapshot';
import { addMonths } from '../../domain/dates';
import { makeBars, stockServer } from '../../test/fixtures';
import { requestUrl, stubFetch } from '../../test/stubFetch';
import { loadStockView, readDetailViewState, withViewChanges } from './stockView';

const bars = makeBars(120);
const last = bars.at(-1)?.date ?? '';

describe('loadStockView', () => {
  it('resolves the range from the stock’s coverage and loads its bars', async () => {
    stubFetch(stockServer({ AAA: bars }));
    const { data } = await loadConsistent(
      (fetch) => loadStockView(fetch, 'AAA', { kind: 'preset', preset: '1M' }),
      { coordinator: new SnapshotCoordinator() },
    );
    expect(data.range).toMatchObject({ from: addMonths(last, -1), to: last, selection: '1M' });
    expect(data.bars).toEqual(bars.filter((bar) => bar.date >= addMonths(last, -1)));
    expect(data.detail.ticker).toBe('AAA');
  });

  it('never combines metadata from one snapshot with prices from another', async () => {
    // The metadata answers at snapshot 1, then the dataset is replaced (snapshot 2).
    const fetch = stubFetch(stockServer({ AAA: bars }, (call) => (call === 0 ? 1 : 2)));
    const result = await loadConsistent((f) => loadStockView(f, 'AAA', { kind: 'default' }), {
      coordinator: new SnapshotCoordinator(),
    });
    expect(result.snapshot).toBe(2);
    const paths = fetch.mock.calls.map(([input]) => requestUrl(input).pathname);
    expect(paths).toEqual([
      '/api/stocks/AAA',
      '/api/stocks/AAA/prices', // snapshot 2: mismatch, everything is discarded
      '/api/stocks/AAA',
      '/api/stocks/AAA/prices',
    ]);
  });

  it('encodes special characters in the ticker', async () => {
    const fetch = stubFetch(stockServer({ '^GSPC': bars }));
    await loadConsistent((f) => loadStockView(f, '^GSPC', { kind: 'default' }), {
      coordinator: new SnapshotCoordinator(),
    });
    // The raw request path, as passed to fetch (URL parsing would encode '^' by itself).
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/stocks/%5EGSPC');
  });
});

describe('detail view state in the URL', () => {
  it('reads defaults and valid values', () => {
    expect(readDetailViewState(new URLSearchParams(''))).toEqual({
      range: { kind: 'default' },
      chartType: 'candles',
      lineField: 'close',
      invalid: false,
    });
    expect(readDetailViewState(new URLSearchParams('range=3M&chart=line&series=adjClose'))).toEqual(
      {
        range: { kind: 'preset', preset: '3M' },
        chartType: 'line',
        lineField: 'adjClose',
        invalid: false,
      },
    );
  });

  it('reports unknown values and falls back to defaults', () => {
    expect(readDetailViewState(new URLSearchParams('chart=pie&series=open&range=1W'))).toEqual({
      range: { kind: 'default' },
      chartType: 'candles',
      lineField: 'close',
      invalid: true,
    });
  });

  it('writes changes, omitting defaults and clearing stale custom bounds', () => {
    const from = addMonths(last, -2);
    const custom = withViewChanges(new URLSearchParams('chart=line'), {
      range: { kind: 'custom', from, to: last },
    });
    expect(custom.toString()).toBe(`chart=line&range=custom&from=${from}&to=${last}`);
    const preset = withViewChanges(custom, {
      range: { kind: 'preset', preset: '1Y' },
      chartType: 'candles',
    });
    expect(preset.toString()).toBe('range=1Y');
  });
});
