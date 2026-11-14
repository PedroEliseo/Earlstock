import { vi } from 'vitest';

/**
 * Test doubles for `fetch`. Tests describe the server as a function from URL to response; every
 * response can carry a Dataset-Snapshot header like the real API's data responses.
 */

export function jsonResponse(
  body: unknown,
  { status = 200, snapshot }: { status?: number; snapshot?: number | string } = {},
): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (snapshot !== undefined) headers.set('Dataset-Snapshot', String(snapshot));
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(status: number, code: string, message = 'server detail'): Response {
  return jsonResponse({ error: { code, message } }, { status });
}

export type FakeServer = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Replaces global fetch with `server`, honouring AbortSignal like the real fetch (rejecting with an
 * AbortError). Returns the spy so tests can inspect the requested URLs.
 */
export function stubFetch(server: FakeServer) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const url = requestUrl(input);
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
      Promise.resolve(server(url, init)).then(resolve, reject);
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** A promise with its resolve function exposed, for controlling response timing in tests. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The URL a fetch call was made with (for inspecting `spy.mock.calls`). */
export function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : input.toString(), 'http://localhost');
}
