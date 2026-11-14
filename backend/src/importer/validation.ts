import { parse } from 'csv-parse';
import { parsePrice, parseVolume } from './decimal.js';

/**
 * Strict, pure validation of a dataset CSV. Nothing is trimmed, normalized, rounded or guessed: a
 * file is either accepted entirely, as written, or rejected with line-numbered reasons. Messages
 * name lines and columns only, never field values.
 */

export const EXPECTED_HEADER = [
  'date',
  'ticker',
  'open',
  'high',
  'low',
  'close',
  'adj_close',
  'volume',
] as const;

/** Same rule as the stocks_ticker_format CHECK constraint, plus the VARCHAR(32) length. */
const TICKER_PATTERN = /^\^?[A-Z0-9]+([.=-][A-Z0-9]+)*$/;
const TICKER_MAX_LENGTH = 32;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Issues kept in detail; every issue is still counted. */
export const MAX_REPORTED_ISSUES = 20;

/** One validated row. Every value is the exact text from the file. */
export interface PriceRow {
  ticker: string;
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  adjClose: string;
  volume: string;
}

/** Optional last header column: the stock's human-readable name (empty = not known). */
export const NAME_COLUMN = 'name';
/** Longest accepted name (also enforced by the stocks_name_format constraint). */
export const NAME_MAX_LENGTH = 200;

export interface DatasetStats {
  stockCount: number;
  priceCount: number;
  tradingDates: number;
  /** YYYY-MM-DD */
  firstDate: string;
  /** YYYY-MM-DD */
  lastDate: string;
}

export interface ValidationIssue {
  /** 1-based physical line in the file (0 when the issue concerns the whole file). */
  line: number;
  column?: string;
  message: string;
}

export type ValidationResult =
  | {
      ok: true;
      rowsRead: number;
      rows: PriceRow[];
      /** Each ticker's name, or null when the file gives none (always null without a name column). */
      names: Map<string, string | null>;
      stats: DatasetStats;
    }
  | { ok: false; rowsRead: number; issueCount: number; issues: ValidationIssue[] };

export interface ValidationOptions {
  /**
   * The execution date (YYYY-MM-DD, UTC). Rows dated after it are rejected: a historical dataset
   * cannot contain prices for a day that has not happened yet.
   */
  today: string;
}

/** The current UTC calendar date as YYYY-MM-DD. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** True when `text` is YYYY-MM-DD naming a real calendar day (year 0001 or later). */
export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  if (year < 1) return false;
  // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

class IssueCollector {
  readonly issues: ValidationIssue[] = [];
  count = 0;

  add(issue: ValidationIssue): void {
    this.count += 1;
    if (this.issues.length < MAX_REPORTED_ISSUES) this.issues.push(issue);
  }
}

/**
 * Decodes and validates a complete file. The input must be the exact bytes that were hashed, so the
 * recorded SHA-256 always describes the data that was validated.
 */
export async function validateDataset(
  bytes: Uint8Array,
  { today }: ValidationOptions,
): Promise<ValidationResult> {
  const issues = new IssueCollector();
  const reject = (rowsRead: number): ValidationResult => ({
    ok: false,
    rowsRead,
    issueCount: issues.count,
    issues: issues.issues,
  });

  if (bytes.length === 0) {
    issues.add({ line: 0, message: 'file is empty' });
    return reject(0);
  }
  let text: string;
  try {
    // fatal: invalid UTF-8 is an error, never replaced. A leading byte-order mark is removed.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    issues.add({ line: 0, message: 'file is not valid UTF-8' });
    return reject(0);
  }

  const rows: PriceRow[] = [];
  const names = new Map<string, { name: string | null; line: number }>();
  let hasNames = false;
  const firstLineOf = new Map<string, number>();
  const tickers = new Set<string>();
  const dates = new Set<string>();
  let rowsRead = 0;
  let headerSeen = false;

  // Streams record by record (the decoded text is already bounded by the file size limit). Column
  // counts are checked here, not by csv-parse, so one bad row does not hide the rest.
  const parser = parse(text, {
    delimiter: ',',
    quote: '"',
    escape: '"',
    info: true,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: false,
  });
  try {
    for await (const item of parser as AsyncIterable<{
      record: string[];
      info: { lines: number };
    }>) {
      const { record, info } = item;
      const line = info.lines;
      if (!headerSeen) {
        headerSeen = true;
        hasNames = record.length === EXPECTED_HEADER.length + 1 && record.at(-1) === NAME_COLUMN;
        const priceColumns = hasNames ? record.slice(0, -1) : record;
        if (
          priceColumns.length !== EXPECTED_HEADER.length ||
          priceColumns.some((name, index) => name !== EXPECTED_HEADER[index])
        ) {
          issues.add({
            line,
            message: `header must be exactly "${EXPECTED_HEADER.join(',')}", optionally followed by ",${NAME_COLUMN}"`,
          });
          return reject(0);
        }
        continue;
      }
      rowsRead += 1;
      const expectedFields = EXPECTED_HEADER.length + (hasNames ? 1 : 0);
      if (record.length !== expectedFields) {
        issues.add({
          line,
          message: `expected ${String(expectedFields)} fields, found ${String(record.length)}`,
        });
        continue;
      }
      const row = validateRecord(record.slice(0, EXPECTED_HEADER.length), line, today, issues);
      const name = hasNames
        ? validateName(record[EXPECTED_HEADER.length] ?? '', line, issues)
        : null;
      if (!row || name === undefined) continue;

      // One name per ticker in a file: a different name (or a missing one) on another row is a
      // conflict, never resolved by picking one.
      const known = names.get(row.ticker);
      if (known && known.name !== name) {
        issues.add({
          line,
          column: NAME_COLUMN,
          message: `conflicts with the name of the same ticker on line ${String(known.line)}`,
        });
        continue;
      }
      if (!known) names.set(row.ticker, { name, line });

      const key = `${row.ticker}\u0000${row.date}`;
      const firstLine = firstLineOf.get(key);
      if (firstLine !== undefined) {
        issues.add({ line, message: `duplicate ticker/date: same as line ${String(firstLine)}` });
        continue;
      }
      firstLineOf.set(key, line);
      tickers.add(row.ticker);
      dates.add(row.date);
      rows.push(row);
    }
  } catch (err) {
    const csvLine = (err as { lines?: unknown }).lines;
    const code = (err as { code?: unknown }).code;
    issues.add({
      line: typeof csvLine === 'number' ? csvLine : 0,
      message: `malformed CSV (${typeof code === 'string' ? code : 'parse error'}); parsing stopped`,
    });
    return reject(rowsRead);
  }

  if (!headerSeen) {
    issues.add({ line: 0, message: 'file has no header' });
    return reject(0);
  }
  if (rowsRead === 0) {
    issues.add({ line: 0, message: 'file has no data rows' });
    return reject(0);
  }
  if (issues.count > 0) return reject(rowsRead);

  const sortedDates = [...dates].sort();
  return {
    ok: true,
    rowsRead,
    rows,
    names: new Map([...names].map(([ticker, entry]) => [ticker, entry.name])),
    stats: {
      stockCount: tickers.size,
      priceCount: rows.length,
      tradingDates: sortedDates.length,
      firstDate: sortedDates[0] ?? '',
      lastDate: sortedDates.at(-1) ?? '',
    },
  };
}

/** Length in Unicode code points: what PostgreSQL's char_length counts (the constraint's unit). */
function codePointLength(value: string): number {
  let length = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) i += 1; // a surrogate pair is one code point
    length += 1;
  }
  return length;
}

/**
 * Validates a name field: empty means "not known" (null). Otherwise it must have no surrounding
 * whitespace, at most NAME_MAX_LENGTH characters and no control characters. Returns undefined after
 * reporting a problem. Messages never include the value.
 */
function validateName(
  value: string,
  line: number,
  issues: IssueCollector,
): string | null | undefined {
  if (value === '') return null;
  const problem =
    value.trim() !== value
      ? 'has leading or trailing whitespace'
      : codePointLength(value) > NAME_MAX_LENGTH
        ? `is longer than ${String(NAME_MAX_LENGTH)} characters`
        : /\p{Cc}/u.test(value)
          ? 'contains control characters'
          : null;
  if (problem) {
    issues.add({ line, column: NAME_COLUMN, message: problem });
    return undefined;
  }
  return value;
}

/** Validates one data record; returns the row, or null after reporting every problem in it. */
function validateRecord(
  record: string[],
  line: number,
  today: string,
  issues: IssueCollector,
): PriceRow | null {
  if (record.length !== EXPECTED_HEADER.length) {
    issues.add({
      line,
      message: `expected ${String(EXPECTED_HEADER.length)} fields, found ${String(record.length)}`,
    });
    return null;
  }
  const [date, ticker, open, high, low, close, adjClose, volume] = record as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const before = issues.count;

  // Field-level checks, in column order.
  const present = (column: string, value: string): boolean => {
    if (value === '') {
      issues.add({ line, column, message: 'is empty' });
      return false;
    }
    if (value.trim() !== value) {
      issues.add({ line, column, message: 'has leading or trailing whitespace' });
      return false;
    }
    return true;
  };

  if (present('date', date)) {
    if (!isCalendarDate(date)) {
      issues.add({ line, column: 'date', message: 'is not a valid YYYY-MM-DD calendar date' });
    } else if (date > today) {
      issues.add({ line, column: 'date', message: 'is after the execution date (UTC)' });
    }
  }
  if (present('ticker', ticker)) {
    if (ticker.length > TICKER_MAX_LENGTH || !TICKER_PATTERN.test(ticker)) {
      issues.add({
        line,
        column: 'ticker',
        message: `is not a canonical ticker (upper-case A-Z/0-9 segments joined by ".", "-" or "=", optional "^" prefix, at most ${String(TICKER_MAX_LENGTH)} characters)`,
      });
    }
  }

  const prices: Record<string, bigint> = {};
  for (const [column, value] of [
    ['open', open],
    ['high', high],
    ['low', low],
    ['close', close],
    ['adj_close', adjClose],
  ] as const) {
    if (!present(column, value)) continue;
    const parsed = parsePrice(value);
    if (parsed.ok) prices[column] = parsed.value;
    else issues.add({ line, column, message: parsed.reason });
  }
  if (present('volume', volume)) {
    const parsed = parseVolume(volume);
    if (!parsed.ok) issues.add({ line, column: 'volume', message: parsed.reason });
  }

  // Row-level checks, mirroring the daily_prices CHECK constraints, once the values are numbers.
  const { open: o, high: h, low: l, close: c, adj_close: a } = prices;
  if (o !== undefined && h !== undefined && l !== undefined && c !== undefined) {
    const violations = [
      l > 0n ? null : 'low must be greater than 0',
      l <= o ? null : 'low must be <= open',
      l <= c ? null : 'low must be <= close',
      h >= o ? null : 'high must be >= open',
      h >= c ? null : 'high must be >= close',
    ].filter((v): v is string => v !== null);
    if (violations.length > 0) {
      issues.add({ line, message: `inconsistent OHLC: ${violations.join('; ')}` });
    }
  }
  if (a !== undefined && a <= 0n) {
    issues.add({ line, column: 'adj_close', message: 'must be greater than 0' });
  }

  if (issues.count > before) return null;
  return { ticker, date, open, high, low, close, adjClose, volume };
}

export interface ShrinkReason {
  dimension: 'stocks' | 'prices' | 'first_date' | 'last_date';
  active: number | string;
  incoming: number | string;
}

/**
 * Every dimension in which the incoming dataset is smaller than the active one: fewer stocks,
 * fewer price rows, coverage starting later or ending earlier. Empty means no reduction.
 */
export function findShrinkage(active: DatasetStats, incoming: DatasetStats): ShrinkReason[] {
  const reasons: ShrinkReason[] = [];
  if (incoming.stockCount < active.stockCount) {
    reasons.push({ dimension: 'stocks', active: active.stockCount, incoming: incoming.stockCount });
  }
  if (incoming.priceCount < active.priceCount) {
    reasons.push({ dimension: 'prices', active: active.priceCount, incoming: incoming.priceCount });
  }
  if (incoming.firstDate > active.firstDate) {
    reasons.push({
      dimension: 'first_date',
      active: active.firstDate,
      incoming: incoming.firstDate,
    });
  }
  if (incoming.lastDate < active.lastDate) {
    reasons.push({ dimension: 'last_date', active: active.lastDate, incoming: incoming.lastDate });
  }
  return reasons;
}

/** A bounded, value-free summary for data_imports.error_summary and logs. */
export function summarizeIssues(issueCount: number, issues: ValidationIssue[]): string {
  const details = issues.map(
    (issue) =>
      `line ${String(issue.line)}${issue.column ? ` (${issue.column})` : ''}: ${issue.message}`,
  );
  const summary = `validation failed with ${String(issueCount)} issue(s); first ${String(details.length)}: ${details.join(' | ')}`;
  return summary.length > 2000 ? `${summary.slice(0, 1997)}...` : summary;
}
