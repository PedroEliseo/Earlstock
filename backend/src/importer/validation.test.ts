import { buildCsv, bytesOf, daysAgo, HEADER, row } from '../../tests/helpers/csv.js';
import {
  type DatasetStats,
  EXPECTED_HEADER,
  findShrinkage,
  isCalendarDate,
  MAX_REPORTED_ISSUES,
  summarizeIssues,
  utcToday,
  validateDataset,
  type ValidationResult,
} from './validation.js';

const today = utcToday();
const validate = (text: string | Buffer, on: string = today) =>
  validateDataset(typeof text === 'string' ? bytesOf(text) : text, { today: on });
const yesterday = daysAgo(1);

function issuesOf(result: ValidationResult) {
  if (result.ok) throw new Error('expected a rejection');
  return result.issues;
}

/** A row with one field replaced (fields in header order). */
function rowWith(field: (typeof EXPECTED_HEADER)[number], value: string, ticker = 'AAA'): string {
  const fields = row(ticker, yesterday).split(',');
  fields[EXPECTED_HEADER.indexOf(field)] = value;
  return fields.join(',');
}

const fileWith = (...rows: string[]) => `${[HEADER, ...rows].join('\n')}\n`;

describe('validateDataset: accepted input', () => {
  it('returns every row with its exact text and the dataset statistics', async () => {
    const result = await validate(
      buildCsv([
        { ticker: 'AAA', days: 3 },
        { ticker: 'BRK.B', days: 2, endOffset: 2 },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowsRead).toBe(5);
    expect(result.stats).toEqual({
      stockCount: 2,
      priceCount: 5,
      tradingDates: 3,
      firstDate: daysAgo(3),
      lastDate: daysAgo(1),
    });
    expect(result.rows[0]).toEqual({
      ticker: 'AAA',
      date: daysAgo(3),
      open: '100.00',
      high: '101.50',
      low: '98.75',
      close: '100.50',
      adjClose: '100.25',
      volume: '1000',
    });
  });

  it('keeps decimal text exactly as written (no trimming of zeros, no float conversion)', async () => {
    const result = await validate(
      fileWith(
        `${yesterday},AAA,123456789012.123456,123456789012.123456,0.000001,0.1,0.30,9007199254740991`,
      ),
    );

    expect(result.ok && result.rows[0]).toEqual({
      ticker: 'AAA',
      date: yesterday,
      open: '123456789012.123456',
      high: '123456789012.123456',
      low: '0.000001',
      close: '0.1',
      adjClose: '0.30',
      volume: '9007199254740991',
    });
  });

  it('accepts integer prices, zero volume, flat bars and adj_close above close', async () => {
    const result = await validate(fileWith(`${yesterday},AAA,8543,8543,8543,8543,9000,0`));
    expect(result.ok).toBe(true);
  });

  it.each([
    ['CRLF line endings', `${HEADER}\r\n${row('AAA', yesterday)}\r\n`],
    ['no final newline', `${HEADER}\n${row('AAA', yesterday)}`],
    ['a UTF-8 byte-order mark', `\uFEFF${HEADER}\n${row('AAA', yesterday)}\n`],
    ['quoted fields', `${HEADER}\n"${yesterday}","AAA","100","101","99","100.5","100.25","1000"\n`],
  ])('accepts %s', async (_name, text) => {
    const result = await validate(text);
    expect(result.ok).toBe(true);
    expect(result.ok && result.rows[0]?.ticker).toBe('AAA');
  });

  it.each(['A', 'BRK.B', 'BRK-B', 'BF.B', '^GSPC', 'EURUSD=X', 'BTC-USD', 'A1', 'X'.repeat(32)])(
    'accepts the canonical ticker %s',
    async (ticker) => {
      expect((await validate(fileWith(row(ticker, yesterday)))).ok).toBe(true);
    },
  );

  it('accepts rows in any order and stocks with different coverage', async () => {
    const result = await validate(
      fileWith(row('BBB', daysAgo(1)), row('AAA', daysAgo(5)), row('BBB', daysAgo(3))),
    );
    expect(result.ok && result.stats).toMatchObject({ stockCount: 2, tradingDates: 3 });
  });
});

describe('validateDataset: file-level rejections', () => {
  it.each([
    ['an empty file', '', 'file is empty'],
    ['a header-only file', `${HEADER}\n`, 'file has no data rows'],
    ['a file with only a newline', '\n', 'header must be exactly'],
  ])('rejects %s', async (_name, text, message) => {
    const result = await validate(text);
    expect(result.ok).toBe(false);
    expect(issuesOf(result)[0]?.message).toContain(message);
  });

  it('rejects invalid UTF-8 instead of replacing bytes', async () => {
    const bytes = Buffer.concat([
      bytesOf(`${HEADER}\n${yesterday},AA`),
      Buffer.from([0xff]),
      bytesOf(',1,1,1,1,1,1\n'),
    ]);
    expect(issuesOf(await validate(bytes))).toEqual([
      { line: 0, message: 'file is not valid UTF-8' },
    ]);
  });

  it.each([
    ['different order', 'ticker,date,open,high,low,close,adj_close,volume'],
    ['different case', 'Date,Ticker,Open,High,Low,Close,Adj_Close,Volume'],
    ['a missing column', 'date,ticker,open,high,low,close,volume'],
    ['an extra column', `${HEADER},dividends`],
    ['surrounding whitespace', 'date, ticker,open,high,low,close,adj_close,volume'],
    ['a renamed column', 'date,ticker,open,high,low,close,adjusted_close,volume'],
  ])('rejects a header with %s', async (_name, header) => {
    const result = await validate(`${header}\n${row('AAA', yesterday)}\n`);
    expect(issuesOf(result)).toEqual([
      { line: 1, message: `header must be exactly "${EXPECTED_HEADER.join(',')}"` },
    ]);
    expect(result.rowsRead).toBe(0);
  });

  it('reports a malformed CSV (unclosed quote) with its line and stops', async () => {
    const result = await validate(fileWith(row('AAA', yesterday), `"${yesterday},AAA,1,1,1,1,1,1`));
    expect(issuesOf(result)).toEqual([
      { line: 3, message: 'malformed CSV (CSV_QUOTE_NOT_CLOSED); parsing stopped' },
    ]);
  });
});

describe('validateDataset: row-level rejections', () => {
  it.each([
    ['too few fields', `${yesterday},AAA,1,1,1,1,1`, 'expected 8 fields, found 7'],
    ['too many fields', `${yesterday},AAA,1,1,1,1,1,1,1`, 'expected 8 fields, found 9'],
    ['an empty line', '', 'expected 8 fields, found 1'],
  ])('rejects a row with %s', async (_name, line, message) => {
    expect(issuesOf(await validate(fileWith(row('AAA', yesterday), line)))).toEqual([
      { line: 3, message },
    ]);
  });

  it.each([
    ['date', '', 'is empty'],
    ['ticker', '', 'is empty'],
    ['open', '', 'is empty'],
    ['volume', '', 'is empty'],
    ['ticker', ' AAA', 'has leading or trailing whitespace'],
    ['close', '100.5 ', 'has leading or trailing whitespace'],
    ['ticker', 'aaa', 'is not a canonical ticker'],
    ['ticker', 'BRK/B', 'is not a canonical ticker'],
    ['ticker', 'BRK..B', 'is not a canonical ticker'],
    ['ticker', 'X'.repeat(33), 'is not a canonical ticker'],
    ['open', '1e2', 'is not a plain decimal number'],
    ['open', '-100', 'is not a plain decimal number'],
    ['high', '101.1234567', 'has more than 6 decimal places'],
    ['adj_close', '0', 'must be greater than 0'],
    ['volume', '-5', 'is not a non-negative integer'],
    ['volume', '1000.0', 'is not a non-negative integer'],
    ['volume', '9007199254740992', 'exceeds the maximum volume'],
  ] as const)('rejects %s = %j', async (column, value, message) => {
    const issues = issuesOf(await validate(fileWith(rowWith(column, value))));
    expect(issues).toContainEqual({ line: 2, column, message: expect.stringContaining(message) });
  });

  it.each([
    ['high below open', `${yesterday},AAA,100,99,98,98.5,98.5,1`, 'high must be >= open'],
    ['high below close', `${yesterday},AAA,98,99,97,100,99,1`, 'high must be >= close'],
    ['low above open', `${yesterday},AAA,98,101,99,100,99,1`, 'low must be <= open'],
    ['low above close', `${yesterday},AAA,100,101,99,98,98,1`, 'low must be <= close'],
    ['zero low', `${yesterday},AAA,1,1,0,1,1,1`, 'low must be greater than 0'],
  ])('rejects inconsistent OHLC: %s', async (_name, line, message) => {
    const issues = issuesOf(await validate(fileWith(line)));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain(message);
    expect(issues[0]?.line).toBe(2);
  });

  it('compares prices exactly, not as floating point', async () => {
    // As JavaScript numbers 0.1 + 0.2 > 0.3; as decimals, high = 0.3 equals close = 0.3.
    expect((await validate(fileWith(`${yesterday},AAA,0.1,0.3,0.1,0.3,0.3,1`))).ok).toBe(true);
    // One millionth above high is detected.
    expect((await validate(fileWith(`${yesterday},AAA,0.1,0.3,0.1,0.300001,0.3,1`))).ok).toBe(
      false,
    );
  });

  it('parses a quoted comma as part of one field (then validates that field)', async () => {
    const issues = issuesOf(
      await validate(fileWith(`${yesterday},"AAA,B",100,101,99,100.5,100.25,1000`)),
    );
    expect(issues).toEqual([
      { line: 2, column: 'ticker', message: expect.stringContaining('is not a canonical ticker') },
    ]);
  });

  it('reports messages without field values', async () => {
    const issues = issuesOf(await validate(fileWith(rowWith('ticker', 'secret-value'))));
    expect(JSON.stringify(issues)).not.toContain('secret-value');
  });
});

describe('validateDataset: dates', () => {
  /** Most recent year at or before this one with the given leap-ness (computed, never hard-coded). */
  function recentYear(leap: boolean): number {
    const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    let year = new Date().getUTCFullYear() - 1;
    while (isLeap(year) !== leap) year -= 1;
    return year;
  }

  it('accepts real calendar days, including 29 February of a leap year', () => {
    expect(isCalendarDate(`${String(recentYear(true))}-02-29`)).toBe(true);
    expect(isCalendarDate(today)).toBe(true);
    expect(isCalendarDate(daysAgo(365))).toBe(true);
  });

  it.each([
    () => `${String(recentYear(false))}-02-29`,
    () => `${String(recentYear(true))}-02-30`,
    () => `${String(recentYear(false))}-04-31`,
    () => `${String(recentYear(false))}-13-01`,
    () => `${String(recentYear(false))}-00-10`,
    () => `${String(recentYear(false))}-01-00`,
    () => '0000-01-01',
    () => `${String(recentYear(false))}-1-05`,
    () => `${String(recentYear(false))}/01/05`,
    () => `05-01-${String(recentYear(false))}`,
    () => `${String(recentYear(false))}-01-05T00:00:00Z`,
  ])('rejects an impossible or non-ISO date (%#)', (date) => {
    expect(isCalendarDate(date())).toBe(false);
  });

  it('accepts the execution date itself and rejects any later date', async () => {
    const tomorrow = daysAgo(-1);
    expect((await validate(fileWith(row('AAA', today)))).ok).toBe(true);
    expect(issuesOf(await validate(fileWith(row('AAA', tomorrow))))).toEqual([
      { line: 2, column: 'date', message: 'is after the execution date (UTC)' },
    ]);
  });

  it('applies the rule relative to the given execution date, not the clock', async () => {
    const file = fileWith(row('AAA', daysAgo(10)));
    expect((await validate(file, daysAgo(10))).ok).toBe(true);
    expect((await validate(file, daysAgo(11))).ok).toBe(false);
  });

  it('derives the execution date from UTC, whatever the time of day', () => {
    const lateInTheUtcDay = new Date();
    lateInTheUtcDay.setUTCHours(23, 59, 59, 999);
    const earlyInTheUtcDay = new Date(lateInTheUtcDay);
    earlyInTheUtcDay.setUTCHours(0, 0, 0, 0);
    expect(utcToday(lateInTheUtcDay)).toBe(utcToday(earlyInTheUtcDay));
    expect(utcToday(lateInTheUtcDay)).toBe(
      `${String(lateInTheUtcDay.getUTCFullYear())}-${String(lateInTheUtcDay.getUTCMonth() + 1).padStart(2, '0')}-${String(lateInTheUtcDay.getUTCDate()).padStart(2, '0')}`,
    );
  });
});

describe('validateDataset: duplicates', () => {
  it('rejects an exact duplicate row, naming both lines', async () => {
    const line = row('AAA', yesterday);
    expect(issuesOf(await validate(fileWith(line, row('BBB', yesterday), line)))).toEqual([
      { line: 4, message: 'duplicate ticker/date: same as line 2' },
    ]);
  });

  it('rejects conflicting rows for the same ticker and date (no winner is chosen)', async () => {
    const result = await validate(fileWith(row('AAA', yesterday, 100), row('AAA', yesterday, 200)));
    expect(issuesOf(result)).toEqual([
      { line: 3, message: 'duplicate ticker/date: same as line 2' },
    ]);
  });

  it('treats tickers as case-sensitive identifiers only after rejecting lower case', async () => {
    const result = await validate(fileWith(row('AAA', yesterday), row('aaa', yesterday)));
    expect(issuesOf(result)[0]?.message).toContain('is not a canonical ticker');
  });
});

describe('validateDataset: error reporting', () => {
  it('counts every issue but keeps only the first ones in detail', async () => {
    const bad = Array.from({ length: 30 }, (_, i) => rowWith('volume', '-1', `T${String(i)}`));
    const result = await validate(fileWith(row('AAA', yesterday), ...bad));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issueCount).toBe(30);
    expect(result.issues).toHaveLength(MAX_REPORTED_ISSUES);
    expect(result.rowsRead).toBe(31);
    expect(result.issues[0]).toMatchObject({ line: 3, column: 'volume' });
  });

  it('reports every problem of a row, not only the first', async () => {
    const issues = issuesOf(await validate(fileWith(`${yesterday},aaa,x,,1,1,1,-1`)));
    expect(issues.map((issue) => issue.column)).toEqual(['ticker', 'open', 'high', 'volume']);
  });

  it('summarizes issues within the error_summary bound, without values', () => {
    const summary = summarizeIssues(3, [
      { line: 2, column: 'open', message: 'is empty' },
      { line: 0, message: 'file is empty' },
    ]);
    expect(summary).toBe(
      'validation failed with 3 issue(s); first 2: line 2 (open): is empty | line 0: file is empty',
    );
    const long = summarizeIssues(
      1000,
      Array.from({ length: 20 }, () => ({ line: 1, message: 'x'.repeat(500) })),
    );
    expect(long.length).toBe(2000);
  });
});

describe('findShrinkage', () => {
  const active: DatasetStats = {
    stockCount: 10,
    priceCount: 100,
    tradingDates: 10,
    firstDate: daysAgo(20),
    lastDate: daysAgo(10),
  };

  it('finds no reduction for an equal or larger dataset', () => {
    expect(findShrinkage(active, active)).toEqual([]);
    expect(
      findShrinkage(active, {
        ...active,
        stockCount: 11,
        priceCount: 120,
        firstDate: daysAgo(30),
        lastDate: daysAgo(1),
      }),
    ).toEqual([]);
  });

  it('reports each dimension that shrinks', () => {
    expect(
      findShrinkage(active, {
        stockCount: 9,
        priceCount: 99,
        tradingDates: 5,
        firstDate: daysAgo(19),
        lastDate: daysAgo(11),
      }),
    ).toEqual([
      { dimension: 'stocks', active: 10, incoming: 9 },
      { dimension: 'prices', active: 100, incoming: 99 },
      { dimension: 'first_date', active: daysAgo(20), incoming: daysAgo(19) },
      { dimension: 'last_date', active: daysAgo(10), incoming: daysAgo(11) },
    ]);
  });

  it.each([
    ['stocks', { stockCount: 9 }],
    ['prices', { priceCount: 99 }],
    ['first_date', { firstDate: daysAgo(19) }],
    ['last_date', { lastDate: daysAgo(11) }],
  ] as const)('reports %s alone', (dimension, change) => {
    expect(findShrinkage(active, { ...active, ...change }).map((r) => r.dimension)).toEqual([
      dimension,
    ]);
  });
});
