import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** The tickers of the visible cards, in order. */
const tickersShown = () =>
  within(screen.getByRole('list', { name: 'Stocks' }))
    .getAllByRole('listitem')
    .map((card) => card.querySelector('p')?.textContent);
const queriesOf = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.map(([input]) => Object.fromEntries(requestUrl(input).searchParams));
const showMore = () => userEvent.click(screen.getByRole('button', { name: 'Show more stocks' }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExplorerPage', () => {
  it('loads only the first page of 50: one request, cards and the total', async () => {
    const fetch = stubFetch(stockListServer(manyStocks(500)));
    renderRoutes(routes);

    expect(screen.getByText('Loading stocks…')).toBeInTheDocument();
    await waitFor(() => {
      expect(tickersShown()).toHaveLength(50);
    });
    expect(screen.getByText('50 of 500 stocks')).toBeInTheDocument();
    expect(queriesOf(fetch)).toEqual([{ limit: '50', offset: '0', sort: 'ticker', dir: 'asc' }]);
  });

  it('appends the next page on demand until every stock is shown', async () => {
    const fetch = stubFetch(stockListServer(manyStocks(120)));
    renderRoutes(routes);
    await screen.findByText('50 of 120 stocks');

    await showMore();
    await waitFor(() => {
      expect(tickersShown()).toHaveLength(100);
    });
    await showMore();
    await screen.findByText('All stocks are shown.');

    expect(tickersShown()).toHaveLength(120);
    expect(new Set(tickersShown()).size).toBe(120);
    expect(tickersShown()[100]).toBe('T101');
    expect(queriesOf(fetch).map((q) => q['offset'])).toEqual(['0', '50', '100']);
    expect(screen.queryByRole('button', { name: 'Show more stocks' })).not.toBeInTheDocument();
  });

  it('loads the next page when the end of the grid scrolls into view', async () => {
    let intersect: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const fetch = stubFetch(stockListServer(manyStocks(120)));
    renderRoutes(routes);
    await screen.findByText('50 of 120 stocks');

    act(() => {
      intersect?.([{ isIntersecting: true }]);
    });

    await waitFor(() => {
      expect(tickersShown()).toHaveLength(100);
    });
    expect(queriesOf(fetch).map((q) => q['offset'])).toEqual(['0', '50']);
  });

  it('never appends a page from another dataset: the list restarts from the first page', async () => {
    // The dataset is replaced between the first and the second page.
    const fetch = stubFetch(stockListServer(manyStocks(120), (call) => (call === 0 ? 1 : 2)));
    renderRoutes(routes);
    await screen.findByText('50 of 120 stocks');

    await showMore();

    await waitFor(() => {
      expect(queriesOf(fetch).map((q) => q['offset'])).toEqual(['0', '50', '0']);
    });
    await waitFor(() => {
      expect(tickersShown()).toHaveLength(50);
    });
    expect(tickersShown()[0]).toBe('T001');
    expect(new Set(tickersShown()).size).toBe(50);
  });

  it('shows names, and says when a name is unknown', async () => {
    stubFetch(stockListServer([stock('AAPL', 400, 1, 'Apple Inc.'), stock('ZZZ')]));
    renderRoutes(routes);

    expect(await screen.findByRole('link', { name: /AAPL.*Apple Inc\./ })).toHaveAttribute(
      'href',
      '/stocks/AAPL',
    );
    expect(screen.getByRole('link', { name: /ZZZ.*Name not available/ })).toHaveAttribute(
      'href',
      '/stocks/ZZZ',
    );
  });

  it('searches names and tickers through the API after typing pauses', async () => {
    const fetch = stubFetch(
      stockListServer([...manyStocks(60), stock('BRK.B', 400, 1, 'Berkshire Hathaway')]),
    );
    const { router } = renderRoutes(routes);
    await screen.findByText('50 of 61 stocks');

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search by name or ticker' }),
      'hath',
    );

    await waitFor(() => {
      expect(tickersShown()).toEqual(['BRK.B']);
    });
    expect(screen.getByText('1 stock match “hath”')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=hath');
    // Debounced: no request for the intermediate terms "h", "ha" and "hat".
    expect(queriesOf(fetch).map((q) => q['q'])).toEqual([undefined, 'HATH']);
  });

  it('follows browser back after a search and never writes the old term back', async () => {
    stubFetch(stockListServer([...manyStocks(60), stock('ZZTOP')]));
    const { router } = renderRoutes(routes);
    await screen.findByText('50 of 61 stocks');
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await userEvent.click(screen.getByRole('option', { name: 'Ticker (Z–A)' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?sort=ticker&dir=desc');
    });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search by name or ticker' }), 'zz');
    await waitFor(() => {
      expect(router.state.location.search).toBe('?sort=ticker&dir=desc&q=zz');
    });

    await router.navigate(-1);

    // Typing replaced the sort entry in history, so back returns to the default order.
    await waitFor(() => {
      expect(tickersShown()[0]).toBe('T001');
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(router.state.location.search).toBe('');
    expect(screen.getByRole('searchbox', { name: 'Search by name or ticker' })).toHaveValue('');
  });

  it('orders through the API with the sort menu, kept in the URL', async () => {
    const fetch = stubFetch(
      stockListServer([stock('AAA', 10, 5), stock('BBB', 30, 1), stock('CCC', 20, 3)]),
    );
    const { router } = renderRoutes(routes);
    await screen.findByText('3 stocks');

    await userEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await userEvent.click(screen.getByRole('option', { name: 'Longest history first' }));

    await waitFor(() => {
      expect(tickersShown()).toEqual(['BBB', 'CCC', 'AAA']);
    });
    expect(router.state.location.search).toBe('?sort=firstDate&dir=asc');
    expect(queriesOf(fetch).at(-1)).toMatchObject({ sort: 'firstDate', dir: 'asc' });
  });

  it('shows a no-results state with a way to clear the search', async () => {
    stubFetch(stockListServer([stock('AAPL')]));
    renderRoutes(routes, '/?q=nothing');

    expect(await screen.findByText('No stocks match your search')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => {
      expect(tickersShown()).toEqual(['AAPL']);
    });
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
    await waitFor(() => {
      expect(tickersShown()).toEqual(['AAPL']);
    });
  });

  it('links each card to the stock page, encoding special characters', async () => {
    stubFetch(stockListServer([stock('^GSPC'), stock('BRK.B')]));
    const { router } = renderRoutes(routes);

    await userEvent.click(await screen.findByRole('link', { name: /\^GSPC/ }));

    expect(await screen.findByText('Detail for ^GSPC')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/stocks/%5EGSPC');
  });
});
