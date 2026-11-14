import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  ApiError,
  describeError,
  isPermanentError,
  NetworkError,
  ResponseFormatError,
  SnapshotMismatchError,
} from './errors';

describe('describeError', () => {
  it.each([...API_ERROR_CODES, 'UNKNOWN' as const])(
    'gives fixed text for %s, never the server message',
    (code) => {
      const description = describeError(new ApiError(500, code, 'SECRET server detail'));
      expect(description.title.length).toBeGreaterThan(0);
      expect(JSON.stringify(description)).not.toContain('SECRET');
    },
  );

  it('explains the no-dataset state and that retrying can help', () => {
    expect(describeError(new ApiError(503, 'DATASET_NOT_LOADED', null))).toMatchObject({
      title: 'No dataset loaded',
      retryable: true,
    });
  });

  it.each([
    [new NetworkError('x'), true],
    [new SnapshotMismatchError('x'), true],
    [new ResponseFormatError('x'), false],
    [new ApiError(404, 'NOT_FOUND', null), false],
    [new Error('anything'), true],
    ['not even an error', true],
  ])('describes %o (retryable: %s)', (error, retryable) => {
    expect(describeError(error).retryable).toBe(retryable);
  });
});

describe('isPermanentError', () => {
  it.each([
    [new ApiError(404, 'NOT_FOUND', null), true],
    [new ApiError(400, 'VALIDATION_FAILED', null), true],
    [new ApiError(503, 'DATASET_NOT_LOADED', null), true],
    [new ResponseFormatError('x'), true],
    [new ApiError(503, 'DATABASE_UNAVAILABLE', null), false],
    [new ApiError(500, 'INTERNAL', null), false],
    [new NetworkError('x'), false],
  ])('%o -> %s', (error, permanent) => {
    expect(isPermanentError(error)).toBe(permanent);
  });
});
