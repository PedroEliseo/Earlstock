import { describe, expect, it } from 'vitest';
import { addDays, addMonths, addYears, startOfYear } from './dates';
import {
  availablePresets,
  defaultPreset,
  rangeKey,
  readRangeRequest,
  resolveRange,
  validateCustomRange,
} from './ranges';
import { daysAgo } from '../test/fixtures';

/** A long history: ten years ending at an arbitrary recent date (computed, not hard-coded). */
const last = daysAgo(40);
const long = { firstDate: addYears(last, -10), lastDate: last };

describe('resolveRange: presets anchored to the last available date', () => {
  it.each([
    ['1M', addMonths(last, -1)],
    ['3M', addMonths(last, -3)],
    ['6M', addMonths(last, -6)],
    ['1Y', addYears(last, -1)],
    ['3Y', addYears(last, -3)],
    ['5Y', addYears(last, -5)],
  ] as const)('%s starts at %s and ends at the last date', (preset, from) => {
    expect(resolveRange({ kind: 'preset', preset }, long)).toEqual({
      from,
      to: last,
      selection: preset,
      limited: false,
    });
  });

  it('YTD starts on 1 January of the LAST DATE’s year, not of today', () => {
    expect(resolveRange({ kind: 'preset', preset: 'YTD' }, long).from).toBe(startOfYear(last));
    const older = { firstDate: addYears(last, -10), lastDate: addYears(last, -3) };
    expect(resolveRange({ kind: 'preset', preset: 'YTD' }, older)).toMatchObject({
      from: startOfYear(older.lastDate),
      to: older.lastDate,
    });
  });

  it('MAX is the actual coverage', () => {
    expect(resolveRange({ kind: 'preset', preset: 'MAX' }, long)).toEqual({
      from: long.firstDate,
      to: last,
      selection: 'MAX',
      limited: false,
    });
  });

  it('never depends on the current date', () => {
    const history = { firstDate: addYears(last, -20), lastDate: addYears(last, -15) };
    expect(resolveRange({ kind: 'preset', preset: '1M' }, history)).toMatchObject({
      from: addMonths(history.lastDate, -1),
      to: history.lastDate,
    });
  });
});

describe('preset availability for short histories', () => {
  // About 46 trading days of coverage: only the first preset reaching the start is offered.
  const short = { firstDate: addDays(last, -64), lastDate: last };

  it('keeps presets inside the coverage, plus the shortest one that reaches its start', () => {
    expect([...availablePresets(short)].sort()).toEqual(['1M', '3M', 'MAX', 'YTD'].sort());
    expect(defaultPreset(short)).toBe('MAX');
  });

  it('offers 1Y (limited) for a history just under one year, and makes it the default', () => {
    const almostYear = { firstDate: addDays(addYears(last, -1), 2), lastDate: last };
    expect(availablePresets(almostYear).has('1Y')).toBe(true);
    expect(availablePresets(almostYear).has('3Y')).toBe(false);
    expect(defaultPreset(almostYear)).toBe('1Y');
    expect(resolveRange({ kind: 'default' }, almostYear)).toEqual({
      from: almostYear.firstDate,
      to: last,
      selection: '1Y',
      limited: true,
    });
  });

  it('shows a disabled preset requested by a URL as the whole history, flagged as limited', () => {
    expect(resolveRange({ kind: 'preset', preset: '5Y' }, short)).toEqual({
      from: short.firstDate,
      to: last,
      selection: 'MAX',
      limited: true,
    });
  });
});

describe('custom ranges', () => {
  it('keeps a range inside the coverage as is', () => {
    const from = addMonths(last, -2);
    const to = addMonths(last, -1);
    expect(resolveRange({ kind: 'custom', from, to }, long)).toEqual({
      from,
      to,
      selection: 'custom',
      limited: false,
    });
  });

  it('limits a range reaching outside the coverage, and says so', () => {
    expect(
      resolveRange(
        { kind: 'custom', from: addYears(long.firstDate, -1), to: addDays(last, 30) },
        long,
      ),
    ).toEqual({ from: long.firstDate, to: last, selection: 'custom', limited: true });
  });

  it('validates user input', () => {
    expect(validateCustomRange(long.firstDate, last, long)).toBeNull();
    expect(validateCustomRange('', last, long)).toBe('invalid-from');
    expect(validateCustomRange(long.firstDate, 'x', long)).toBe('invalid-to');
    expect(validateCustomRange(last, long.firstDate, long)).toBe('reversed');
    expect(validateCustomRange(addDays(long.firstDate, -1), last, long)).toBe('outside-coverage');
    expect(validateCustomRange(long.firstDate, addDays(last, 1), long)).toBe('outside-coverage');
  });
});

describe('readRangeRequest', () => {
  it('reads presets and custom ranges', () => {
    expect(readRangeRequest(new URLSearchParams('range=6M'))).toEqual({
      request: { kind: 'preset', preset: '6M' },
      invalid: false,
    });
    const from = addMonths(last, -2);
    expect(readRangeRequest(new URLSearchParams(`range=custom&from=${from}&to=${last}`))).toEqual({
      request: { kind: 'custom', from, to: last },
      invalid: false,
    });
    expect(readRangeRequest(new URLSearchParams(''))).toEqual({
      request: { kind: 'default' },
      invalid: false,
    });
  });

  it.each([
    'range=2W',
    'range=custom',
    `range=custom&from=${last}&to=${addDays(last, -1)}`,
    'range=custom&from=x&to=y',
  ])('falls back to the default for %s and reports it', (search) => {
    expect(readRangeRequest(new URLSearchParams(search))).toEqual({
      request: { kind: 'default' },
      invalid: true,
    });
  });

  it('gives every request a stable cache key', () => {
    expect(rangeKey({ kind: 'default' })).toBe('default');
    expect(rangeKey({ kind: 'preset', preset: '1Y' })).toBe('1Y');
    expect(rangeKey({ kind: 'custom', from: long.firstDate, to: last })).toBe(
      `${long.firstDate}..${last}`,
    );
  });
});
