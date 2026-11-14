import { DatabaseError } from 'pg';
import {
  DatabaseQueryError,
  DatabaseTimeoutError,
  DatabaseUnavailableError,
} from '../shared/errors.js';
import { classifyDatabaseError } from './errors.js';

const context = { query: 'test.query', durationMs: 3 };

function serverError(code: string, message: string): DatabaseError {
  return Object.assign(new DatabaseError(message, 0, 'error'), { code, severity: 'ERROR' });
}

/** Same properties, but not an instance of this realm's classes (as under Jest's VM modules). */
function foreignError(fields: Record<string, unknown>): object {
  return { name: 'Error', ...fields };
}

const classify = (err: unknown) => classifyDatabaseError(err, context);

describe('classifyDatabaseError', () => {
  it.each([
    [
      'connection refused',
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }),
    ],
    ['connection reset', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
    ['unknown host', Object.assign(new Error('getaddrinfo ENOTFOUND db'), { code: 'ENOTFOUND' })],
    ['pool checkout timeout', new Error('timeout exceeded when trying to connect')],
    ['dropped connection', new Error('Connection terminated unexpectedly')],
    ['connect timeout', new Error('Connection terminated due to connection timeout')],
    ['SQLSTATE 08006 connection failure', serverError('08006', 'connection failure')],
    [
      'SQLSTATE 53300 too many connections',
      serverError('53300', 'sorry, too many clients already'),
    ],
    [
      'SQLSTATE 57P01 admin shutdown',
      serverError('57P01', 'terminating connection due to administrator command'),
    ],
    [
      'SQLSTATE 57P03 cannot connect now',
      serverError('57P03', 'the database system is starting up'),
    ],
    [
      'a cross-realm socket error',
      foreignError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }),
    ],
    [
      'an AggregateError of socket errors',
      new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })], 'x'),
    ],
  ])('%s -> DatabaseUnavailableError', (_case, err) => {
    expect(classify(err)).toBeInstanceOf(DatabaseUnavailableError);
  });

  it('statement timeout (57014, "statement timeout") -> DatabaseTimeoutError', () => {
    expect(
      classify(serverError('57014', 'canceling statement due to statement timeout')),
    ).toBeInstanceOf(DatabaseTimeoutError);
    expect(
      classify(
        foreignError({
          code: '57014',
          severity: 'ERROR',
          message: 'canceling statement due to statement timeout',
        }),
      ),
    ).toBeInstanceOf(DatabaseTimeoutError);
  });

  it.each([
    [
      'explicit cancellation (57014, user request)',
      serverError('57014', 'canceling statement due to user request'),
    ],
    ['a syntax error', serverError('42601', 'syntax error at or near "x"')],
    ['insufficient privilege', serverError('42501', 'permission denied for table stocks')],
    ['an unexpected application bug', new TypeError('x is not a function')],
    ['a non-error value', 'boom'],
  ])('%s -> DatabaseQueryError (internal, not unavailability)', (_case, err) => {
    expect(classify(err)).toBeInstanceOf(DatabaseQueryError);
  });

  it('keeps the original error as cause and the query context for logs', () => {
    const original = serverError('42601', 'syntax error');
    const classified = classify(original);

    expect(classified.cause).toBe(original);
    expect(classified.context).toEqual(context);
    expect(classified.message).not.toContain('syntax');
  });
});
