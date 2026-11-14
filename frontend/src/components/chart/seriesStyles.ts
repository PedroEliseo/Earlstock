/**
 * Visual identity of compared series by position: a color AND a line pattern, so series remain
 * distinguishable without color. Charts map `pattern` to the chart library's line style; legends
 * draw the same pattern with `dashArray` (SVG).
 */
export const SERIES_PATTERNS = [
  { pattern: 'solid', dashArray: undefined },
  { pattern: 'dashed', dashArray: '6 4' },
  { pattern: 'dotted', dashArray: '2 3' },
  { pattern: 'long dashes', dashArray: '10 5' },
  { pattern: 'sparse dots', dashArray: '2 7' },
] as const;
export type SeriesPattern = (typeof SERIES_PATTERNS)[number]['pattern'];

export function seriesPattern(index: number) {
  return SERIES_PATTERNS[index % SERIES_PATTERNS.length] ?? SERIES_PATTERNS[0];
}
