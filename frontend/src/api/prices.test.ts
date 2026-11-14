import { describe, expect, it } from 'vitest';
import { ResponseFormatError } from './errors';
import { loadConsistent, SnapshotCoordinator } from './snapshot';
import { loadPriceHistory } from './stocks';
import { makeBars, stockServer } from '../test/fixtures';
import { jsonResponse, requestUrl, stubFetch } from '../test/stubFetch';

const bars = makeBars(12);
const all = { from: bars[0]?.date ?? '', to: bars.at(-1)?.date ?? '' };
const load = (range = all, pageSize = 5, signal?: AbortSignal) =>
  loadConsistent((fetch) => loadPriceHistory(fetch, 'AAA', range, pageSize), {
    coordinator: new SnapshotCoordinator(),
    signal,
  });

describe('loadPriceHistory', () => {
  it('follows the exclusive cursor across pages, without duplicates, oldest first', async () => {
    const fetch = stubFetch(stockServer({ AAA: bars }));

    const result = await load();

    expect(result.data).toEqual(bars);
    const queries = fetch.mock.calls.map(([input]) => requestUrl(input).searchParams);
    expect(queries.map((q) => q.get('after'))).toEqual([null, bars[4]?.date, bars[9]?.date]);
    expect(queries.every((q) => q.get('from') === all.from && q.get('to') === all.to)).toBe(true);
    expect(queries.every((q) => q.get('limit') === '5')).toBe(true);
  });

  it('requests the inclusive bounds and returns only bars within them', async () => {
    stubFetch(stockServer({ AAA: bars }));
    const range = { from: bars[2]?.date ?? '', to: bars[6]?.date ?? '' };
    expect((await load(range, 100)).data).toEqual(bars.slice(2, 7));
  });

  it('returns an empty history for a range without trading days', async () => {
    stubFetch(stockServer({ AAA: bars }));
    const after = bars.at(-1)?.date ?? '';
    expect((await load({ from: after, to: after }, 100)).data).toHaveLength(1);
    stubFetch(() =>
      jsonResponse({ data: [], page: { limit: 100, nextAfter: null } }, { snapshot: 1 }),
    );
    expect((await load(all, 100)).data).toEqual([]);
  });

  it('restarts from the first page when the snapshot changes between pages', async () => {
    const fetch = stubFetch(stockServer({ AAA: bars }, (call) => (call === 0 ? 1 : 2)));
    const result = await load();
    expect(result).toEqual({ snapshot: 2, data: bars });
    const afters = fetch.mock.calls.map(([input]) => requestUrl(input).searchParams.get('after'));
    expect(afters).toEqual([null, bars[4]?.date, null, bars[4]?.date, bars[9]?.date]);
  });

  it('propagates cancellation', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = load(all, 5, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  const page = (data: unknown[], nextAfter: string | null) => ({
    data,
    page: { limit: 5, nextAfter },
  });
  it.each([
    [
      'a cursor that does not match the last bar',
      () => page(bars.slice(0, 5), bars[2]?.date ?? null),
    ],
    ['a cursor on an empty page', () => page([], bars[0]?.date ?? null)],
    ['dates out of order', () => page([bars[1], bars[0]], null)],
    ['a duplicated date', () => page([bars[0], bars[0]], null)],
    ['a bar outside the requested range', () => page([makeBars(1, 900)[0]], null)],
  ])('rejects %s instead of looping or merging', async (_name, body) => {
    stubFetch(() => jsonResponse(body(), { snapshot: 1 }));
    await expect(load()).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it('rejects a page that repeats dates of the previous page', async () => {
    let call = 0;
    stubFetch(() =>
      jsonResponse(
        call++ === 0 ? page(bars.slice(0, 5), bars[4]?.date ?? null) : page(bars.slice(4, 8), null),
        { snapshot: 1 },
      ),
    );
    await expect(load()).rejects.toBeInstanceOf(ResponseFormatError);
  });
});
