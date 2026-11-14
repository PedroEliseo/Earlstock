import { createLogger, serializeError } from './logger.js';

describe('logger', () => {
  it('writes one JSON object per line with time, level, message and fields', () => {
    const lines: [string, string][] = [];
    const logger = createLogger((level, line) => lines.push([level, line]));

    logger.warn('slow database query', { query: 'stocks.list', durationMs: 250 });

    expect(lines).toHaveLength(1);
    const [level, line] = lines[0] ?? ['', ''];
    expect(level).toBe('warn');
    expect(JSON.parse(line)).toEqual({
      time: expect.stringMatching(/Z$/),
      level: 'warn',
      message: 'slow database query',
      query: 'stocks.list',
      durationMs: 250,
    });
  });

  it('serializes errors with code, context and cause, but not driver fields that may carry data', () => {
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      detail: 'Key (ticker)=(SECRET) already exists.',
    });
    const err = Object.assign(new Error('A database query failed', { cause }), {
      context: { query: 'q', durationMs: 1 },
    });

    const serialized = serializeError(err);

    expect(serialized).toMatchObject({
      name: 'Error',
      message: 'A database query failed',
      context: { query: 'q', durationMs: 1 },
      cause: { message: 'duplicate key', code: '23505' },
    });
    expect(JSON.stringify(serialized)).not.toContain('SECRET');
  });
});
