import { ThemeProvider } from '@mui/material/styles';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotCoordinator } from '../../api/snapshot';
import { SnapshotProvider } from '../../query/SnapshotProvider';
import { manyStocks, stock, stockListServer } from '../../test/fixtures';
import { requestUrl, stubFetch } from '../../test/stubFetch';
import { theme } from '../../theme/theme';
import { TickerPicker } from './TickerPicker';

function renderPicker(selected: string[] = [], onChange = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <SnapshotProvider
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        coordinator={new SnapshotCoordinator()}
      >
        <TickerPicker selected={selected} onChange={onChange} />
      </SnapshotProvider>
    </ThemeProvider>,
  );
  return onChange;
}

describe('TickerPicker', () => {
  it('searches the API as the user types, after a pause, and suggests the matches', async () => {
    // More tickers than one suggestion page, so a match can only appear through the search.
    const fetch = stubFetch(stockListServer([...manyStocks(100), stock('ZZTOP')]));
    const onChange = renderPicker();

    await userEvent.type(screen.getByRole('combobox', { name: 'Stocks to compare' }), 'zzt');

    const option = await screen.findByRole('option', { name: 'ZZTOP' });
    const terms = fetch.mock.calls.map(([input]) => requestUrl(input).searchParams.get('q'));
    expect(terms).toEqual([null, 'ZZT']); // initial suggestions, then one debounced search
    await userEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(['ZZTOP']);
  });

  it('never suggests a ticker that is already selected', async () => {
    stubFetch(stockListServer([stock('AAA'), stock('BBB')]));
    renderPicker(['AAA']);
    await userEvent.click(screen.getByRole('combobox', { name: 'Stocks to compare' }));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'BBB' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: 'AAA' })).not.toBeInTheDocument();
  });
});
