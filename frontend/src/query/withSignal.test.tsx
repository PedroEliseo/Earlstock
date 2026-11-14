import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { withSignal } from './withSignal';

/** A query whose fetch records its calls and aborts, and resolves only when the test says so. */
function controllableFetch() {
  const aborted: number[] = [];
  let calls = 0;
  let resolve!: (value: string) => void;
  const fn = vi.fn((signal: AbortSignal) => {
    const call = (calls += 1);
    signal.addEventListener('abort', () => aborted.push(call));
    return new Promise<string>((r) => {
      resolve = r;
    });
  });
  return {
    fn,
    aborted,
    resolve: (value: string) => {
      resolve(value);
    },
  };
}

function Probe({ fetchFn }: { fetchFn: (signal: AbortSignal) => Promise<string> }) {
  const query = useQuery({ queryKey: ['probe'], queryFn: withSignal(fetchFn) });
  return <p>{query.data ?? 'loading'}</p>;
}

const renderProbe = (fetchFn: (signal: AbortSignal) => Promise<string>, strict: boolean) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <Probe fetchFn={fetchFn} />
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

describe('withSignal', () => {
  it('lets Strict Mode remount re-attach to the first request: one fetch, nothing aborted', async () => {
    const fetch = controllableFetch();
    renderProbe(fetch.fn, true);

    await vi.waitFor(() => {
      expect(fetch.fn).toHaveBeenCalledOnce();
    });
    fetch.resolve('done');

    expect(await screen.findByText('done')).toBeInTheDocument();
    expect(fetch.fn).toHaveBeenCalledOnce();
    expect(fetch.aborted).toEqual([]);
  });

  it('still aborts a request that is under way when its view goes away', async () => {
    const fetch = controllableFetch();
    const { unmount } = renderProbe(fetch.fn, false);
    await vi.waitFor(() => {
      expect(fetch.fn).toHaveBeenCalledOnce();
    });

    unmount();

    expect(fetch.aborted).toEqual([1]);
  });
});
