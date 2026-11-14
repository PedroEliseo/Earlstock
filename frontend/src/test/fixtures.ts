import type { Bar, StockDetail, StockSummary } from '../api/schemas';
import { jsonResponse, type FakeServer } from './stubFetch';

/**
 * Synthetic data for frontend tests. Dates are computed relative to the current UTC date, so no
 * calendar date is hard-coded.
 */

/** The UTC date `days` days before today, as YYYY-MM-DD. */
export function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function stock(ticker: string, firstDaysAgo = 400, lastDaysAgo = 1): StockSummary {
  return { ticker, firstDate: daysAgo(firstDaysAgo), lastDate: daysAgo(lastDaysAgo) };
}

/** `count` stocks named T001, T002, … sorted by ticker as the API returns them. */
export function manyStocks(count: number): StockSummary[] {
  return Array.from({ length: count }, (_, i) => stock(`T${String(i + 1).padStart(3, '0')}`));
}

/**
 * A fake GET /api/stocks honouring limit/offset. `snapshotFor(callIndex)` chooses the snapshot of
 * each response (default: always 1).
 */
export function stockListServer(
  stocks: readonly StockSummary[],
  snapshotFor: (call: number) => number = () => 1,
): FakeServer {
  let call = 0;
  return (url) => {
    const limit = Number(url.searchParams.get('limit') ?? '20');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    return jsonResponse(
      {
        data: stocks.slice(offset, offset + limit),
        pagination: { limit, offset, total: stocks.length },
      },
      { snapshot: snapshotFor(call++) },
    );
  };
}

/** `count` consecutive daily bars ending `endDaysAgo` days before today, oldest first. */
export function makeBars(count: number, endDaysAgo = 1): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const cents = 10_000 + i * 25;
    const price = (c: number) =>
      `${String(Math.floor(c / 100))}.${String(c % 100).padStart(2, '0')}`;
    return {
      date: daysAgo(endDaysAgo + count - 1 - i),
      open: price(cents),
      high: price(cents + 150),
      low: price(cents - 125),
      close: price(cents + 50),
      adjClose: price(cents + 25),
      volume: 1000 + i,
    };
  });
}

export function detailOf(ticker: string, bars: readonly Bar[]): StockDetail {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) throw new Error('a stock needs at least one bar');
  return {
    ticker,
    coverage: { firstDate: first.date, lastDate: last.date, tradingDays: bars.length },
    latest: last,
  };
}

/**
 * A fake API for detail and prices endpoints of the given stocks, honouring from/to/after/limit
 * like the backend (limit+1 lookahead to decide nextAfter). Unknown tickers answer 404.
 */
export function stockServer(
  stocks: Record<string, readonly Bar[]>,
  snapshotFor: (call: number, url: URL) => number = () => 1,
): FakeServer {
  let call = 0;
  return (url) => {
    const snapshot = snapshotFor(call++, url);
    const match = /^\/api\/stocks\/([^/]+)(\/prices)?$/.exec(url.pathname);
    const ticker = match?.[1] ? decodeURIComponent(match[1]) : '';
    const bars = stocks[ticker];
    if (!match || !bars) {
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'nope' } }, { status: 404 });
    }
    if (!match[2]) return jsonResponse({ data: detailOf(ticker, bars) }, { snapshot });
    const from = url.searchParams.get('from') ?? '0000-01-01';
    const to = url.searchParams.get('to') ?? '9999-12-31';
    const after = url.searchParams.get('after');
    const limit = Number(url.searchParams.get('limit') ?? '1000');
    const inRange = bars.filter(
      (bar) => bar.date >= from && bar.date <= to && (after === null || bar.date > after),
    );
    const page = inRange.slice(0, limit);
    const nextAfter = inRange.length > limit ? (page.at(-1)?.date ?? null) : null;
    return jsonResponse({ data: page, page: { limit, nextAfter } }, { snapshot });
  };
}
