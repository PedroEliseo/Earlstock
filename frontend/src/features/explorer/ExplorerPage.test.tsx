import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useParams } from 'react-router';
import { describe, expect, it } from 'vitest';
import { manyStocks, stock, stockListServer } from '../../test/fixtures';
import { renderRoutes } from '../../test/render';
import { errorResponse, stubFetch } from '../../test/stubFetch';
import { ExplorerPage } from './ExplorerPage';

function TickerProbe() {
  const { ticker } = useParams();
  return <p>Detail for {ticker}</p>;
}

const routes = [
  { path: '/', element: <ExplorerPage /> },
  { path: '/stocks/:ticker', element: <TickerProbe /> },
];

const tickersShown = () =>
  within(screen.getByRole('table', { name: 'Stocks' }))
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent);

describe('ExplorerPage', () => {
  it('shows a loading state, then every stock with its coverage', async () => {
    stubFetch(stockListServer([stock('AAPL', 400, 1), stock('BRK.B', 300, 2)]));
    renderRoutes(routes);

    expect(screen.getByText('Loading stocks…')).toBeInTheDocument();
    await screen.findByRole('link', { name: 'AAPL' });
    expect(tickersShown()).toEqual(['AAPL', 'BRK.B']);
    expect(screen.getByText('2 stocks')).toBeInTheDocument();
  });

  it('loads every page and paginates 50 rows on the client', async () => {
    stubFetch(stockListServer(manyStocks(120)));
    const { router } = renderRoutes(routes);
    await screen.findByRole('link', { name: 'T001' });

    expect(tickersShown()).toHaveLength(50);
    expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(tickersShown()[0]).toBe('T051');
    expect(router.state.location.search).toBe('?page=2');
  });

  it('filters case-insensitively without new requests, and returns to page 1', async () => {
    const fetch = stubFetch(stockListServer([...manyStocks(60), stock('ZZTOP')]));
    const { router } = renderRoutes(routes, '/?page=2');
    await screen.findByRole('link', { name: 'T051' });
    const requests = fetch.mock.calls.length;

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tickers' }), 'zzt');

    await waitFor(() => {
      expect(tickersShown()).toEqual(['ZZTOP']);
    });
    expect(screen.getByText('1 of 61 stocks match “zzt”')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=zzt');
    expect(fetch.mock.calls.length).toBe(requests);
  });

  it('shows a no-results state with a way to clear the search', async () => {
    stubFetch(stockListServer([stock('AAPL')]));
    renderRoutes(routes, '/?q=nothing');

    expect(await screen.findByText('No tickers match your search')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('link', { name: 'AAPL' })).toBeInTheDocument();
  });

  it('sorts by column in both directions and shows the active direction', async () => {
    stubFetch(stockListServer([stock('AAA', 10, 5), stock('BBB', 30, 1), stock('CCC', 20, 3)]));
    renderRoutes(routes);
    await screen.findByRole('link', { name: 'AAA' });

    const firstDate = screen.getByRole('button', { name: /First date/ });
    await userEvent.click(firstDate);
    expect(tickersShown()).toEqual(['BBB', 'CCC', 'AAA']);
    expect(screen.getByRole('columnheader', { name: /First date/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    await userEvent.click(screen.getByRole('button', { name: /First date/ }));
    expect(tickersShown()).toEqual(['AAA', 'CCC', 'BBB']);
    expect(screen.getByRole('columnheader', { name: /First date/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('explains an empty dataset', async () => {
    stubFetch(stockListServer([]));
    renderRoutes(routes);
    expect(await screen.findByText('The active dataset contains no stocks')).toBeInTheDocument();
  });

  it('explains that no dataset has been imported yet', async () => {
    stubFetch(() => errorResponse(503, 'DATASET_NOT_LOADED', 'raw server text'));
    renderRoutes(routes);
    expect(await screen.findByText('No dataset loaded')).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
  });

  it('shows a fixed error message and retries on request', async () => {
    let fail = true;
    const ok = stockListServer([stock('AAPL')]);
    stubFetch((url, init) =>
      fail ? errorResponse(503, 'DATABASE_UNAVAILABLE', 'pg: details') : ok(url, init),
    );
    renderRoutes(routes);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Service temporarily unavailable');
    expect(alert).not.toHaveTextContent('pg: details');

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'AAPL' })).toBeInTheDocument();
  });

  it('never shows a list mixed from two snapshots; a persistent change is recoverable', async () => {
    stubFetch(stockListServer(manyStocks(150), (call) => call + 1));
    renderRoutes(routes);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The dataset is being updated');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('links to the stock page, encoding special characters', async () => {
    stubFetch(stockListServer([stock('^GSPC'), stock('BRK.B')]));
    const { router } = renderRoutes(routes);

    await userEvent.click(await screen.findByRole('link', { name: '^GSPC' }));

    expect(await screen.findByText('Detail for ^GSPC')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/stocks/%5EGSPC');
  });
});
