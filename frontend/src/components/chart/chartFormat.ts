/**
 * Number formatting for chart axes and crosshair labels, matching the rest of the interface: the
 * same Intl locale (the browser's) as formatDecimal/formatIndex, so a value never reads "271.86"
 * on the axis and "271,86" in the table. Display only: the chart's coordinates are unchanged.
 */
export function priceFormat(precision: number) {
  const format = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
  return {
    type: 'custom' as const,
    minMove: 10 ** -precision,
    formatter: (value: number) => format.format(value),
  };
}

/** Volumes in compact notation (e.g. 27.3M / 27,3 M), locale-aware. */
export function volumeFormat() {
  const format = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return {
    type: 'custom' as const,
    minMove: 1,
    formatter: (value: number) => format.format(value),
  };
}
