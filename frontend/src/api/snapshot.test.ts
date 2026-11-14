import { describe, expect, it, vi } from 'vitest';
import type { Snapshotted } from './client';
import { SnapshotMismatchError } from './errors';
import { loadConsistent, SnapshotCoordinator } from './snapshot';

/** A request that resolves after `delay` ms with `data` at `snapshot`, honouring abort. */
function request<T>(snapshot: number, data: T, delay = 0) {
  return (signal: AbortSignal) =>
    new Promise<Snapshotted<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ snapshot, data });
      }, delay);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
}

describe('SnapshotCoordinator', () => {
  it('accepts the first and newer snapshots, notifying listeners of each change once', () => {
    const coordinator = new SnapshotCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener);

    expect(coordinator.observe(3)).toBe('current');
    expect(coordinator.observe(3)).toBe('current');
    expect(coordinator.observe(5)).toBe('current');

    expect(listener.mock.calls).toEqual([
      [3, null],
      [5, 3],
    ]);
    expect(coordinator.current).toBe(5);
  });

  it('reports an older snapshot as stale and never goes back to it', () => {
    const coordinator = new SnapshotCoordinator();
    coordinator.observe(5);
    expect(coordinator.observe(4)).toBe('stale');
    expect(coordinator.current).toBe(5);
  });

  it('stops notifying after unsubscribe', () => {
    const coordinator = new SnapshotCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener)();
    coordinator.observe(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('loadConsistent', () => {
  it('returns the combined result of sequential pages from one snapshot', async () => {
    const coordinator = new SnapshotCoordinator();
    const result = await loadConsistent(
      async (fetch) => [await fetch(request(2, 'a')), await fetch(request(2, 'b'))],
      { coordinator },
    );
    expect(result).toEqual({ snapshot: 2, data: ['a', 'b'] });
  });

  it('discards everything and restarts when a page comes from another snapshot', async () => {
    const coordinator = new SnapshotCoordinator();
    const snapshots = [1, 2, 2, 2]; // first attempt: page 1 at 1, page 2 at 2 -> restart
    let call = 0;
    const operation = vi.fn(async (fetch: Parameters<Parameters<typeof loadConsistent>[0]>[0]) => {
      const pages = [];
      for (let page = 0; page < 2; page += 1) {
        pages.push(await fetch(request(snapshots[call++] ?? 0, `page${String(page)}`)));
      }
      return pages;
    });

    const result = await loadConsistent(operation, { coordinator });

    expect(result).toEqual({ snapshot: 2, data: ['page0', 'page1'] });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('restarts when a response is older than the newest snapshot seen elsewhere', async () => {
    const coordinator = new SnapshotCoordinator();
    coordinator.observe(9);
    let call = 0;
    const result = await loadConsistent((fetch) => fetch(request(call++ === 0 ? 8 : 9, 'x')), {
      coordinator,
    });
    expect(result).toEqual({ snapshot: 9, data: 'x' });
    expect(coordinator.current).toBe(9);
  });

  it('restarts when a newer snapshot appeared elsewhere while the operation ran', async () => {
    const coordinator = new SnapshotCoordinator();
    let call = 0;
    const result = await loadConsistent(
      async (fetch) => {
        const value = await fetch(request(call === 0 ? 1 : 2, call));
        if (call === 0) coordinator.observe(2); // another query sees the new dataset
        call += 1;
        return value;
      },
      { coordinator },
    );
    expect(result).toEqual({ snapshot: 2, data: 1 });
  });

  it('aborts sibling requests of a parallel attempt as soon as snapshots disagree', async () => {
    const coordinator = new SnapshotCoordinator();
    const aborted: boolean[] = [];
    let attempt = 0;
    const result = await loadConsistent(
      async (fetch) => {
        attempt += 1;
        const slow = (signal: AbortSignal) => {
          signal.addEventListener('abort', () => aborted.push(true));
          return request(2, 'slow', 50)(signal);
        };
        return Promise.all([
          fetch(request(attempt === 1 ? 1 : 2, 'fast')),
          fetch(request(2, 'mid', 5)),
          fetch(slow),
        ]);
      },
      { coordinator },
    );
    expect(result).toEqual({ snapshot: 2, data: ['fast', 'mid', 'slow'] });
    expect(aborted).toEqual([true]); // only the first attempt's slow request was cancelled
  });

  it('gives up after the bounded number of attempts with a recoverable error', async () => {
    const coordinator = new SnapshotCoordinator();
    let snapshot = 0;
    const operation = vi.fn(async (fetch: Parameters<Parameters<typeof loadConsistent>[0]>[0]) => [
      await fetch(request(++snapshot, 'a')),
      await fetch(request(++snapshot, 'b')),
    ]);
    await expect(loadConsistent(operation, { coordinator, maxAttempts: 3 })).rejects.toBeInstanceOf(
      SnapshotMismatchError,
    );
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('propagates other errors without retrying', async () => {
    const coordinator = new SnapshotCoordinator();
    const operation = vi.fn(() => Promise.reject(new Error('boom')));
    await expect(loadConsistent(operation, { coordinator })).rejects.toThrow('boom');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops immediately when the caller cancels', async () => {
    const coordinator = new SnapshotCoordinator();
    const controller = new AbortController();
    const pending = loadConsistent((fetch) => fetch(request(1, 'x', 1000)), {
      coordinator,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
