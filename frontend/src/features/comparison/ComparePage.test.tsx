import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatPercent } from '../../domain/decimal';
import { fullServer, makeBars } from '../../test/fixtures';
import { renderRoutes } from '../../test/render';
import { stubFetch } from '../../test/stubFetch';
import { ComparePage } from './ComparePage';

// The canvas chart is covered by ComparisonChart.test.tsx; here it is a probe exposing its inputs.
vi.mock('./ComparisonChart', () => ({
  default: (props: { dates: string[]; series: { ticker: string; normalized: number[] }[] }) => (
    <div data-testid="chart">
      {props.series
        .map((s) => `${s.ticker}:${String(s.normalized.length)}:${String(s.normalized[0])}`)
        .join('|')}
      {`@${props.dates[0] ?? ''}`}
    </div>
  ),
}));

const aaa = makeBars(300, 1);
const bbb = makeBars(120, 1); // starts later than AAA
const ccc = makeBars(60, 1);
const old = makeBars(10, 500); // no overlap with the others
const stocks = { AAA: aaa, BBB: bbb, CCC: ccc, OLD: old };
const routes = [{ path: '/compare', element: <ComparePage /> }];
const open = (search = '', server = fullServer(stocks)) => {
  const fetch = stubFetch(server);
  return { fetch, ...renderRoutes(routes, `/compare${search}`) };
};

describe('ComparePage', () => {
  it('asks for at least two stocks', async () => {
    open('?tickers=AAA');
    expect(await screen.findByText('Select at least two stocks to compare')).toBeInTheDocument();
  });

  it('compares on common dates only and says which stock limits the period', async () => {
    open('?tickers=AAA,BBB&range=MAX');

    expect(await screen.findByTestId('chart')).toHaveTextContent(
      `AAA:120:100|BBB:120:100@${bbb[0]?.date ?? ''}`,
    );
    const summary = screen.getByRole('region', { name: 'What is compared' });
    expect(summary).toHaveTextContent('120'); // common observations
    expect(summary).toHaveTextContent('history of BBB begins');
    expect(summary).toHaveTextContent('Close');
    // Like the stock page: the summary comes before the range selector.
    const rangeGroup = screen.getByRole('group', { name: 'Time range' });
    expect(
      summary.compareDocumentPosition(rangeGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The chart description names the basis and the common baseline date.
    expect(screen.getByText(/Index of close: each stock = 100 on/)).toHaveTextContent(
      bbb[0]?.date ?? '',
    );

    const metrics = screen.getByRole('table', { name: 'Performance metrics' });
    expect(within(metrics).getAllByRole('row')).toHaveLength(3);
    const expected = (Number(aaa.at(-1)?.close) / Number(aaa[180]?.close) - 1) * 100;
    expect(within(metrics).getByRole('rowheader', { name: /AAA/ }).closest('tr')).toHaveTextContent(
      // toHaveTextContent collapses the element's whitespace (including the no-break spaces some
      // locales put in percentages), so the expected text is normalized the same way.
      formatPercent(expected, { signed: true }).replace(/\s+/g, ' '),
    );

    const observations = screen.getByRole('table', { name: 'Aligned observations' });
    expect(within(observations).getAllByRole('row')[1]).toHaveTextContent(aaa.at(-1)?.date ?? '');
  });

  it('always compares closes: no price-basis choice, and older basis links are ignored', async () => {
    const { router } = open('?tickers=AAA,BBB&basis=adjClose');
    await screen.findByTestId('chart');

    expect(screen.queryByRole('button', { name: 'Adjusted close' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Some settings in the address were not recognized'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'AAA close' })).toBeInTheDocument();
    expect(screen.getByText(/Index of close/)).toBeInTheDocument();
    // The next change writes a clean URL without the former basis parameter.
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Time range' })).getByRole('button', {
        name: '1M',
      }),
    );
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tickers=AAA%2CBBB&range=1M');
    });
  });

  it('adds and removes stocks, one history entry each, and restores on back', async () => {
    const { router } = open('?tickers=AAA,BBB');
    await screen.findByTestId('chart');

    await userEvent.type(screen.getByRole('combobox', { name: 'Stocks to compare' }), 'CC');
    await userEvent.click(await screen.findByRole('option', { name: /^CCC\b/ }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tickers=AAA%2CBBB%2CCCC');
    });
    expect(await screen.findByTestId('chart')).toHaveTextContent(/CCC:60:100/);

    await router.navigate(-1);
    await waitFor(() => {
      expect(screen.getByTestId('chart')).not.toHaveTextContent('CCC');
    });
  });

  it('reports ignored URL entries and normalizes duplicates', async () => {
    open('?tickers=aaa,AAA,BAD!,BBB');
    expect(await screen.findByText('Some tickers in the address were ignored')).toBeInTheDocument();
    expect(screen.getByText(/not valid tickers: BAD!; repeated: AAA/)).toBeInTheDocument();
    expect(await screen.findByTestId('chart')).toHaveTextContent(/^AAA.*\|BBB/);
  });

  it('names an unknown ticker and offers to remove it', async () => {
    const { router } = open('?tickers=AAA,ZZZ');
    expect(await screen.findByText('ZZZ is not in the current dataset')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove ZZZ' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tickers=AAA');
    });
  });

  it('explains stocks without a common period', async () => {
    open('?tickers=AAA,OLD');
    expect(await screen.findByText('These stocks have no period in common')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });

  it('explains a single common date without showing a chart', async () => {
    const one = makeBars(1, 1);
    open('?tickers=AAA,ONE', fullServer({ AAA: aaa, ONE: one }));
    expect(await screen.findByText('Only one common trading date')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not enough data').length).toBeGreaterThan(0);
  });

  it('shows a recoverable error when the dataset keeps changing', async () => {
    open(
      '?tickers=AAA,BBB',
      fullServer(stocks, (call) => call + 1),
    );
    expect(await screen.findByText('The dataset is being updated')).toBeInTheDocument();
  });

  it('cancels the requests of a selection that is no longer shown', async () => {
    const aborted: string[] = [];
    const server = fullServer(stocks);
    const { router } = open('?tickers=AAA,BBB', (url, init) => {
      if (url.pathname === '/api/stocks/BBB') {
        init?.signal?.addEventListener('abort', () => aborted.push(url.pathname));
        return new Promise<Response>(() => undefined); // never answers
      }
      return server(url, init);
    });
    await screen.findByText('Loading comparison…');

    await router.navigate('/compare?tickers=AAA,CCC');

    expect(await screen.findByTestId('chart')).toHaveTextContent(/CCC/);
    expect(aborted).toContain('/api/stocks/BBB');
  });

  it('shows names next to tickers in the legend and the metrics', async () => {
    open(
      '?tickers=AAA,BBB',
      fullServer(stocks, () => 1, { AAA: 'Alpha Corp' }),
    );
    await screen.findByTestId('chart');

    const legend = screen.getByRole('list', { name: /Values on/ });
    expect(legend).toHaveTextContent('AAA');
    expect(legend).toHaveTextContent('Alpha Corp');
    const metrics = screen.getByRole('table', { name: 'Performance metrics' });
    const aaaRow = within(metrics).getByRole('rowheader', { name: /AAA/ });
    expect(aaaRow).toHaveTextContent('Alpha Corp');
    expect(within(metrics).getByRole('rowheader', { name: /BBB/ })).toHaveTextContent(
      'Name not available',
    );
  });
});
