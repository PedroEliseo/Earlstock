import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { apiPath, getJson } from './client';
import { ApiError, NetworkError, ResponseFormatError } from './errors';
import { stockListResponseSchema } from './schemas';
import { errorResponse, jsonResponse, stubFetch } from '../test/stubFetch';

const list = {
  data: [{ ticker: 'AAA', firstDate: '0001-01-01', lastDate: '0001-01-02' }],
  pagination: { limit: 100, offset: 0, total: 1 },
};

describe('apiPath', () => {
  it('encodes parameters and omits undefined ones', () => {
    expect(apiPath('/api/x', { a: 1, b: undefined, c: 'x y' })).toBe('/api/x?a=1&c=x+y');
    expect(apiPath('/api/x')).toBe('/api/x');
  });
});

describe('getJson', () => {
  it('returns the validated body with its dataset snapshot', async () => {
    stubFetch(() => jsonResponse(list, { snapshot: 7 }));
    await expect(getJson('/api/stocks', stockListResponseSchema)).resolves.toEqual({
      snapshot: 7,
      data: list,
    });
  });

  it('ignores fields the contract does not use (additive backend changes)', async () => {
    stubFetch(() => jsonResponse({ ...list, extra: true }, { snapshot: 1 }));
    const result = await getJson('/api/stocks', stockListResponseSchema);
    expect(result.data).toEqual(list);
  });

  it.each([undefined, '', '0', '-1', 'abc', '1.5'])(
    'rejects a data response with snapshot header %j',
    async (snapshot) => {
      stubFetch(() => jsonResponse(list, snapshot === undefined ? {} : { snapshot }));
      await expect(getJson('/api/stocks', stockListResponseSchema)).rejects.toBeInstanceOf(
        ResponseFormatError,
      );
    },
  );

  it.each([
    ['a price as a number', { ...list, data: [{ ...list.data[0], firstDate: 20 }] }],
    ['a missing field', { data: [] }],
    ['a malformed date', { ...list, data: [{ ...list.data[0], lastDate: 'yesterday' }] }],
  ])('rejects a body with %s', async (_name, body) => {
    stubFetch(() => jsonResponse(body, { snapshot: 1 }));
    await expect(getJson('/api/stocks', stockListResponseSchema)).rejects.toBeInstanceOf(
      ResponseFormatError,
    );
  });

  it('rejects a non-JSON success body', async () => {
    stubFetch(() => new Response('<html>', { headers: { 'Dataset-Snapshot': '1' } }));
    await expect(getJson('/x', z.unknown())).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it('decodes documented error bodies into ApiError with status and code', async () => {
    stubFetch(() => errorResponse(503, 'DATASET_NOT_LOADED', 'no dataset'));
    const error = await getJson('/x', z.unknown()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      code: 'DATASET_NOT_LOADED',
      serverMessage: 'no dataset',
    });
  });

  it('maps unknown codes and non-JSON error bodies to UNKNOWN', async () => {
    stubFetch(() => errorResponse(500, 'SOMETHING_NEW'));
    await expect(getJson('/x', z.unknown())).rejects.toMatchObject({
      code: 'UNKNOWN',
      status: 500,
    });
    stubFetch(() => new Response('Bad Gateway', { status: 502 }));
    await expect(getJson('/x', z.unknown())).rejects.toMatchObject({
      code: 'UNKNOWN',
      status: 502,
    });
  });

  it('reports a failed connection as NetworkError', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(getJson('/x', z.unknown())).rejects.toBeInstanceOf(NetworkError);
  });

  it('propagates cancellation as AbortError, not as a failure', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = getJson('/x', z.unknown(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
