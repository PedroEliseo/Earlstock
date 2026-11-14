/**
 * Domain vocabulary for stored values. Plain string aliases (no runtime cost) that document how
 * PostgreSQL values are represented: none of them is ever converted to a JS Number or Date.
 */

/** Exact decimal from PostgreSQL NUMERIC, e.g. "243.85" (trailing zeros trimmed). */
export type DecimalString = string;

/** Integer from PostgreSQL BIGINT, as base-10 digits. Converted to number only at the API boundary. */
export type IntegerString = string;

/** Calendar date, "YYYY-MM-DD". Independent of time zones. */
export type DateString = string;

/**
 * Instant from PostgreSQL TIMESTAMPTZ as ISO 8601 UTC with milliseconds, e.g. "…T12:34:56.789Z".
 * Formatted in SQL rather than parsed by the driver: the driver's text parsing depends on the
 * session's DateStyle, so a non-ISO DateStyle would silently yield invalid values.
 */
export type TimestampString = string;
