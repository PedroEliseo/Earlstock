import { describe, expect, it } from 'vitest';
import { addDays, addMonths, addYears, isIsoDate, maxDate, minDate, startOfYear } from './dates';

/** Most recent year before the current one with the given leap-ness (computed, never hard-coded). */
function recentYear(leap: boolean): string {
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  let year = new Date().getUTCFullYear() - 1;
  while (isLeap(year) !== leap) year -= 1;
  return String(year);
}
const leap = recentYear(true);
const common = recentYear(false);
const next = (year: string) => String(Number(year) + 1);
const previous = (year: string) => String(Number(year) - 1);

describe('isIsoDate', () => {
  it('accepts real days, including 29 February of a leap year', () => {
    expect(isIsoDate(`${leap}-02-29`)).toBe(true);
    expect(isIsoDate(`${common}-12-31`)).toBe(true);
  });

  it.each([
    () => `${common}-02-29`,
    () => `${common}-04-31`,
    () => `${common}-13-01`,
    () => `${common}-00-10`,
    () => `${common}-1-05`,
    () => '0000-01-01',
    () => 'not a date',
  ])('rejects an impossible or non-ISO date (%#)', (date) => {
    expect(isIsoDate(date())).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays(`${common}-12-31`, 1)).toBe(`${next(common)}-01-01`);
    expect(addDays(`${leap}-03-01`, -1)).toBe(`${leap}-02-29`);
    expect(addDays(`${common}-03-01`, -1)).toBe(`${common}-02-28`);
  });

  it('clamps month arithmetic to the end of shorter months', () => {
    expect(addMonths(`${common}-03-31`, -1)).toBe(`${common}-02-28`);
    expect(addMonths(`${leap}-03-31`, -1)).toBe(`${leap}-02-29`);
    expect(addMonths(`${common}-05-31`, -1)).toBe(`${common}-04-30`);
    expect(addMonths(`${common}-01-15`, -3)).toBe(`${previous(common)}-10-15`);
    expect(addMonths(`${common}-08-31`, -6)).toBe(`${common}-02-28`);
  });

  it('maps 29 February to 28 February in non-leap years', () => {
    expect(addYears(`${leap}-02-29`, -1)).toBe(`${previous(leap)}-02-28`);
    expect(addYears(`${leap}-02-29`, -4)).toBe(`${String(Number(leap) - 4)}-02-29`);
  });

  it('finds the start of the year and orders dates as strings', () => {
    expect(startOfYear(`${common}-07-19`)).toBe(`${common}-01-01`);
    expect(minDate(`${common}-01-02`, `${common}-01-10`)).toBe(`${common}-01-02`);
    expect(maxDate(`${common}-01-02`, `${common}-01-10`)).toBe(`${common}-01-10`);
  });
});
