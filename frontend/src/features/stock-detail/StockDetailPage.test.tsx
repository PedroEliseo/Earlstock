import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { addMonths, startOfYear } from '../../domain/dates';
import { formatDecimal } from '../../domain/decimal';
import { makeBars, stockServer } from '../../test/fixtures';
import { renderRoutes } from '../../test/render';
import { errorResponse, stubFetch } from '../../test/stubFetch';
import { StockDetailPage } from './StockDetailPage';

// The canvas chart is covered by PriceChart.test.tsx; here it is a probe exposing its inputs.
vi.mock('./chart/PriceChart', () => ({
  default: (props: { bars: { date: string }[]; chartType: string; description: string }) => (
    <div role="img" aria-label={props.description} data-testid="chart">
      {`${props.chartType}:${String(props.bars.length)}:${props.bars[0]?.date ?? ''}`}
    </div>
  ),
}));

const bars = makeBars(400); // a little over a year of consecutive days
const last = bars.at(-1)?.date ?? '';
const routes = [{ path: '/stocks/:ticker', element: <StockDetailPage /> }];
const open = (path: string, stocks = { AAA: bars }) => {
  const fetch = stubFetch(stockServer(stocks));
  return { fetch, ...renderRoutes(routes, path) };
};
const chartProbe = async () => (await screen.findByTestId('chart')).textContent;
const rangeButton = (name: string) =>
  within(screen.getByRole('group', { name: 'Time range' })).getByRole('button', { name });

describe('StockDetailPage', () => {
  it('shows coverage, the latest bar and the default one-year view', async () => {
    open('/stocks/AAA');

    expect(await screen.findByRole('heading', { level: 1, name: 'AAA' })).toBeInTheDocument();
    const coverage = screen.getByRole('region', { name: 'Coverage' });
    expect(coverage).toHaveTextContent(bars[0]?.date ?? '');
    expect(coverage).toHaveTextContent('400');
    const latest = screen.getByRole('region', { name: `Latest bar · ${last}` });
    expect(latest).toHaveTextContent(formatDecimal(bars.at(-1)?.adjClose ?? ''));

    expect(rangeButton('1Y')).toHaveAttribute('aria-pressed', 'true');
    expect(await chartProbe()).toMatch(new RegExp(`^candles:\\d+:${addMonths(last, -12)}$`));
  });

  it('switches range and chart type through the URL, one history entry each', async () => {
    const { router } = open('/stocks/AAA');
    await screen.findByTestId('chart');

    await userEvent.click(rangeButton('YTD'));
    await waitFor(async () => {
      expect(await chartProbe()).toContain(`:${startOfYear(last)}`);
    });
    expect(router.state.location.search).toBe('?range=YTD');

    await userEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(await chartProbe()).toMatch(/^line:/);
    expect(router.state.location.search).toBe('?range=YTD&chart=line');
    expect(
      screen.getByText('Close as provided by the dataset. Volume is shown below.'),
    ).toBeInTheDocument();
    // The line always shows the close: there is no close / adjusted close choice.
    expect(screen.queryByRole('button', { name: 'Adjusted close' })).not.toBeInTheDocument();

    await router.navigate(-1);
    await waitFor(() => {
      expect(router.state.location.search).toBe('?range=YTD');
    });
  });

  it('restores the view from the URL', async () => {
    open('/stocks/AAA?range=3M&chart=line');
    expect(await chartProbe()).toMatch(new RegExp(`^line:\\d+:${addMonths(last, -3)}$`));
    expect(rangeButton('3M')).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports unrecognized URL parameters and shows the defaults', async () => {
    open('/stocks/AAA?range=2W&chart=pie');
    expect(
      await screen.findByText('Some view settings in the address were not recognized'),
    ).toBeInTheDocument();
    expect(await chartProbe()).toMatch(/^candles:/);
  });

  it('applies a valid custom range and rejects an invalid one', async () => {
    const { router } = open('/stocks/AAA');
    await screen.findByTestId('chart');
    await userEvent.click(rangeButton('Custom'));

    const form = screen.getByRole('form', { name: 'Custom range' });
    const from = within(form).getByLabelText('From');
    const to = within(form).getByLabelText('To');
    await userEvent.clear(from);
    await userEvent.type(from, last);
    await userEvent.clear(to);
    await userEvent.type(to, bars[0]?.date ?? '');
    await userEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'The start date must not be after the end date.',
    );
    expect(router.state.location.search).toBe('');

    const start = bars[10]?.date ?? '';
    const end = bars[20]?.date ?? '';
    await userEvent.clear(from);
    await userEvent.type(from, start);
    await userEvent.clear(to);
    await userEvent.type(to, end);
    await userEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(await chartProbe()).toBe(`candles:11:${start}`);
    expect(router.state.location.search).toBe(`?range=custom&from=${start}&to=${end}`);
  });

  it('lists the same bars as the chart, newest first, in pages', async () => {
    open('/stocks/AAA?range=MAX');
    await screen.findByTestId('chart');

    const table = screen.getByRole('table', { name: 'Daily prices' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(50);
    expect(within(rows[0] as HTMLElement).getByRole('rowheader')).toHaveTextContent(last);
    expect(rows[0]).toHaveTextContent(formatDecimal(bars.at(-1)?.close ?? ''));
    expect(screen.getByText(/400 trading days/)).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown ticker', async () => {
    open('/stocks/NOPE');
    expect(await screen.findByRole('heading', { name: 'Stock not found' })).toBeInTheDocument();
  });

  it('explains a missing dataset and fixed errors, never raw server text', async () => {
    stubFetch(() => errorResponse(503, 'DATASET_NOT_LOADED', 'raw detail'));
    renderRoutes(routes, '/stocks/AAA');
    expect(await screen.findByText('No dataset loaded')).toBeInTheDocument();
    expect(screen.queryByText(/raw detail/)).not.toBeInTheDocument();
  });

  it('recovers from a failure with retry', async () => {
    let fail = true;
    const server = stockServer({ AAA: bars });
    stubFetch((url, init) => (fail ? errorResponse(503, 'DATABASE_TIMEOUT') : server(url, init)));
    renderRoutes(routes, '/stocks/AAA');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Service temporarily unavailable');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('chart')).toBeInTheDocument();
  });

  it('shows an explicit empty state when the range has no trading days', async () => {
    const sparse = [bars[0], bars[100]].filter((b) => b !== undefined);
    const between = bars[50]?.date ?? '';
    open(`/stocks/AAA?range=custom&from=${between}&to=${between}`, { AAA: sparse });
    expect(await screen.findByText('No trading days in the selected range')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });

  it('leads with the stock name and keeps the ticker visible', async () => {
    stubFetch(stockServer({ AAPL: bars }, () => 1, { AAPL: 'Apple Inc.' }));
    renderRoutes(routes, '/stocks/AAPL');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Apple Inc.' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(document.title).toBe('Apple Inc. (AAPL) · EarlStock');
    });
  });

  it('uses the ticker as heading and states a missing name, never inventing one', async () => {
    open('/stocks/AAA');
    expect(await screen.findByRole('heading', { level: 1, name: 'AAA' })).toBeInTheDocument();
    expect(screen.getByText('Name not available')).toBeInTheDocument();
  });
});
