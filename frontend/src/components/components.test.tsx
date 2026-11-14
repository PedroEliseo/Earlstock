import { QueryClient, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { SnapshotCoordinator } from '../api/snapshot';
import { SnapshotProvider } from '../query/SnapshotProvider';
import { DatasetUpdatedNotice } from './DatasetUpdatedNotice';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorMessage, StatusMessage } from './StatusMessage';

describe('StatusMessage and ErrorMessage', () => {
  it('announces errors as alerts and other states politely', () => {
    render(<StatusMessage kind="empty" title="Nothing here" />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
  });

  it('renders fixed text for API errors and offers a retry when it can help', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorMessage
        error={new ApiError(503, 'DATABASE_UNAVAILABLE', 'pg detail')}
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Service temporarily unavailable');
    expect(alert).not.toHaveTextContent('pg detail');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no retry for permanent errors', () => {
    render(<ErrorMessage error={new ApiError(404, 'NOT_FOUND', null)} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  it('replaces a crashed subtree with a fixed message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Crash(): never {
      throw new Error('render bug');
    }
    render(
      <ErrorBoundary>
        <Crash />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('SnapshotProvider', () => {
  function Probe({ id }: { id: string }) {
    const query = useQuery({
      queryKey: [id],
      queryFn: () => Promise.resolve({ snapshot: 1, data: id }),
    });
    return <p>{query.data ? `${id}@${String(query.data.snapshot)}` : 'loading'}</p>;
  }

  it('invalidates queries from older snapshots and shows the update notice once a newer dataset appears', async () => {
    const queryClient = new QueryClient();
    const coordinator = new SnapshotCoordinator();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <SnapshotProvider queryClient={queryClient} coordinator={coordinator}>
        <DatasetUpdatedNotice />
        <Probe id="a" />
      </SnapshotProvider>,
    );
    await screen.findByText('a@1');

    act(() => {
      coordinator.observe(1); // first snapshot: nothing outdated
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText(/new dataset/)).not.toBeInTheDocument();

    act(() => {
      coordinator.observe(2);
    });
    expect(invalidate).toHaveBeenCalledOnce();
    const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
    const query = queryClient.getQueryCache().find({ queryKey: ['a'] });
    expect(query && predicate?.(query)).toBe(true);
    expect(screen.getByText(/A new dataset was activated/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/new dataset/)).not.toBeInTheDocument();
  });
});
