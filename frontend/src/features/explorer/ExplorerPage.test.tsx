import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useParams } from 'react-router';
import { describe, expect, it } from 'vitest';
import { manyStocks, stock, stockListServer } from '../../test/fixtures';
import { renderRoutes } from '../../test/render';
import { errorResponse, requestUrl, stubFetch } from '../../test/stubFetch';
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
const queriesOf = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.map(([input]) => Object.fromEntries(requestUrl(input).searchParams));

describe('ExplorerPage', () => {
  it('loads only the visible page: one request, then the rows and the total', async () => {
    const fetch = stubFetch(stockListServer(manyStocks(500)));
    renderRoutes(routes);

    expect(screen.getByText('Loading stocks…')).toBeInTheDocument();
    await screen.findByRole('link', { name: 'T001' });
    expect(tickersShown()).toHaveLength(50);
    expect(screen.getByText('500 stocks')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–50 of 500')).toBeInTheDocument();
    expect(queriesOf(fetch)).toEqual([{ limit: '50', offset: '0', sort: 'ticker', dir: 'asc' }]);
  });

  it('requests the next page with its offset, keeping the page in the URL', async () => {
    const fetch = stubFetch(stockListServer(manyStocks(120)));
    const { router } = renderRoutes(routes);
    await screen.findByRole('link', { name: 'T001' });

    await userEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));

    await screen.findByRole('link', { name: 'T051' });
    expect(router.state.location.search).toBe('?page=2');
    expect(queriesOf(fetch).at(-1)).toMatchObject({ offset: '50', limit: '50' });
  });

  it('searches through the API after typing pauses, and returns to page 1', async () => {
    const fetch = stubFetch(stockListServer([...manyStocks(60), stock('ZZTOP')]));
    const { router } = renderRoutes(routes, '/?page=2');
    await screen.findByRole('link', { name: 'T051' });

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tickers' }), 'zzt');

    await waitFor(() => {
      expect(tickersShown()).toEqual(['ZZTOP']);
    });
    expect(screen.getByText('1 stock match “zzt”')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=zzt');
    // Debounced: no request for the intermediate terms "z" and "zz".
    expect(queriesOf(fetch).map((q) => q['q'])).toEqual([undefined, 'ZZT']);
  });

  it('follows browser back after a search and never writes the old term back', async () => {
    stubFetch(stockListServer([...manyStocks(60), stock('ZZTOP')]));
    const { router } = renderRoutes(routes);
    await screen.findByRole('link', { name: 'T001' });
    await userEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    await screen.findByRole('link', { name: 'T051' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tickers' }), 'zz');
    await waitFor(() => {
      expect(router.state.location.search).toBe('?q=zz');
    });

    await router.navigate(-1);

    await screen.findByRole('link', { name: 'T001' });
    // Well past the debounce delay: the URL and the box stay on the restored view.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(router.state.location.search).toBe('');
    expect(screen.getByRole('searchbox', { name: 'Search tickers' })).toHaveValue('');
  });

  it('shows a no-results state with a way to clear the search', async () => {
    stubFetch(stockListServer([stock('AAPL')]));
    renderRoutes(routes, '/?q=nothing');

    expect(await screen.findByText('No tickers match your search')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('link', { name: 'AAPL' })).toBeInTheDocument();
  });

  it('sorts through the API in both directions and shows the active direction', async () => {
    const fetch = stubFetch(
      stockListServer([stock('AAA', 10, 5), stock('BBB', 30, 1), stock('CCC', 20, 3)]),
    );
    renderRoutes(routes);
    await screen.findByRole('link', { name: 'AAA' });

    await userEvent.click(screen.getByRole('button', { name: /First date/ }));
    await waitFor(() => {
      expect(tickersShown()).toEqual(['BBB', 'CCC', 'AAA']);
    });
    expect(screen.getByRole('columnheader', { name: /First date/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(queriesOf(fetch).at(-1)).toMatchObject({ sort: 'firstDate', dir: 'asc' });

    await userEvent.click(screen.getByRole('button', { name: /First date/ }));
    await waitFor(() => {
      expect(tickersShown()).toEqual(['AAA', 'CCC', 'BBB']);
    });
    expect(screen.getByRole('columnheader', { name: /First date/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('moves a page number beyond the results to the last page', async () => {
    stubFetch(stockListServer(manyStocks(60)));
    const { router } = renderRoutes(routes, '/?page=9');
    await waitFor(() => {
      expect(router.state.location.search).toBe('?page=2');
    });
    expect(await screen.findByRole('link', { name: 'T051' })).toBeInTheDocument();
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

  it('links to the stock page, encoding special characters', async () => {
    stubFetch(stockListServer([stock('^GSPC'), stock('BRK.B')]));
    const { router } = renderRoutes(routes);

    await userEvent.click(await screen.findByRole('link', { name: '^GSPC' }));

    expect(await screen.findByText('Detail for ^GSPC')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/stocks/%5EGSPC');
  });
});
