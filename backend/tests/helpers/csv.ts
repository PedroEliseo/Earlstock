import { createHash } from 'node:crypto';
import type { DatasetFile } from '../../src/importer/dataset-file.js';
import { utcToday } from '../../src/importer/validation.js';

/**
 * Synthetic dataset CSVs for importer tests. Dates are computed relative to the execution date, so
 * no calendar date is hard-coded; values are deterministic decimal strings built from integers
 * (never JavaScript floating point).
 */

export const HEADER = 'date,ticker,open,high,low,close,adj_close,volume';

/** The UTC date `days` days before the execution date, as YYYY-MM-DD. */
export function daysAgo(days: number, today: string = utcToday()): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** `cents` as a decimal string with two places, e.g. 12345 -> "123.45". */
const money = (cents: number) =>
  `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, '0')}`;

export interface StockSpec {
  ticker: string;
  /** Number of consecutive calendar days of bars. */
  days: number;
  /** Days between the last bar and the execution date (default 1: the last bar is yesterday). */
  endOffset?: number;
  /** Base price in whole units (default 100). */
  base?: number;
}

/** One valid row: low < open < close < high, adj_close slightly below close. */
export function row(ticker: string, date: string, base = 100, i = 0): string {
  const open = base * 100 + i * 10;
  return [
    date,
    ticker,
    money(open),
    money(open + 150),
    money(open - 125),
    money(open + 50),
    money(open + 25),
    String(1000 + i),
  ].join(',');
}

export function rowsFor({ ticker, days, endOffset = 1, base = 100 }: StockSpec): string[] {
  return Array.from({ length: days }, (_, i) =>
    row(ticker, daysAgo(endOffset + days - 1 - i), base, i),
  );
}

/** A complete CSV (header + rows, newline-terminated) for the given stocks. */
export function buildCsv(stocks: StockSpec[], extraRows: string[] = []): string {
  return `${[HEADER, ...stocks.flatMap(rowsFor), ...extraRows].join('\n')}\n`;
}

export const bytesOf = (text: string): Buffer => Buffer.from(text, 'utf8');

/** An in-memory DatasetFile, hashed exactly as readDatasetFile hashes a file on disk. */
export function asDatasetFile(text: string | Buffer, fileName = 'synthetic.csv'): DatasetFile {
  const bytes = typeof text === 'string' ? bytesOf(text) : text;
  return {
    fileName,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  };
}
