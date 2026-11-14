/**
 * Calendar-date arithmetic on YYYY-MM-DD strings. Dates are days, not instants: everything is
 * computed in UTC so no time zone or daylight-saving rule can shift a day. YYYY-MM-DD strings order
 * correctly as plain strings.
 */

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `text` is YYYY-MM-DD naming a real calendar day. */
export function isIsoDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  if (year < 1) return false;
  const date = utcDate(year, month, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function utcDate(year: number, month: number, day: number): Date {
  // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parts(date: IsoDate): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error('not a YYYY-MM-DD date');
  return match.slice(1).map(Number) as [number, number, number];
}

function format(date: Date): IsoDate {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const daysInMonth = (year: number, month: number) => utcDate(year, month + 1, 0).getUTCDate();

export function addDays(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = parts(date);
  return format(utcDate(year, month, day + days));
}

/**
 * Calendar months, clamping the day to the target month's length: one month before 31 March is the
 * last day of February (28 or 29), never a day in early March.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return format(
    utcDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth))),
  );
}

/** Calendar years; 29 February maps to 28 February in non-leap years. */
export function addYears(date: IsoDate, years: number): IsoDate {
  return addMonths(date, years * 12);
}

/** 1 January of the date's own year. */
export function startOfYear(date: IsoDate): IsoDate {
  return `${date.slice(0, 4)}-01-01`;
}

export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);
export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);
