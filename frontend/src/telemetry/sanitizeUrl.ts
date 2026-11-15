/**
 * URL privacy for browser telemetry: drops the query string and fragment (search text, comparison
 * selections, filters) and replaces the ticker in `/stocks/<ticker>` and `/api/stocks/<ticker>` with
 * `{ticker}`. Applied to every URL the enabled instrumentations export.
 */
export function sanitizeUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? '';
  return withoutQuery.replace(
    /^((?:[a-z][a-z\d+.-]*:\/\/[^/]+)?\/(?:api\/)?stocks\/)[^/]+/i,
    '$1{ticker}',
  );
}
