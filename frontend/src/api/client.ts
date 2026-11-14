import type * as z from 'zod/mini';
import {
  API_ERROR_CODES,
  ApiError,
  type ApiErrorCode,
  isAbortError,
  NetworkError,
  ResponseFormatError,
} from './errors';
import { errorBodySchema } from './schemas';

/** A decoded response body plus the dataset snapshot it was read from. */
export interface Snapshotted<T> {
  snapshot: number;
  data: T;
}

const SNAPSHOT_HEADER = 'Dataset-Snapshot';
const SNAPSHOT_PATTERN = /^[1-9]\d*$/;

/** Builds `/api/...?a=1&b=2`, omitting undefined parameters. */
export function apiPath(path: string, params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * GETs a JSON data endpoint, validates the body against `schema` and returns it with its
 * Dataset-Snapshot. Aborts propagate unchanged (AbortError), so callers can tell cancellation apart
 * from failure.
 */
export async function getJson<S extends z.ZodMiniType>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<Snapshotted<z.infer<S>>> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new NetworkError('the request did not reach the server', { cause: error });
  }

  if (!response.ok) throw await toApiError(response);

  const snapshotText = response.headers.get(SNAPSHOT_HEADER);
  if (!snapshotText || !SNAPSHOT_PATTERN.test(snapshotText)) {
    throw new ResponseFormatError(`missing or invalid ${SNAPSHOT_HEADER} header`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ResponseFormatError('the response body is not JSON', { cause: error });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ResponseFormatError('the response does not match the expected contract', {
      cause: parsed.error,
    });
  }
  return { snapshot: Number(snapshotText), data: parsed.data };
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (e.g. a proxy error page): the status alone is reported.
  }
  const parsed = errorBodySchema.safeParse(body);
  if (!parsed.success) return new ApiError(response.status, 'UNKNOWN', null);
  const { code, message } = parsed.data.error;
  const known = (API_ERROR_CODES as readonly string[]).includes(code);
  return new ApiError(response.status, known ? (code as ApiErrorCode) : 'UNKNOWN', message ?? null);
}
