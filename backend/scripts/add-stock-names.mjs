// Adds a `name` column to a dataset CSV, from Wikipedia's "List of S&P 500 companies" table.
//
//   node scripts/add-stock-names.mjs <prices.csv> <constituents.wikitext> <output.csv>
//
// The wikitext is downloaded beforehand (see README, "Stock names"), so this script needs no
// network access and its result is reproducible from the two input files. It:
//  - never modifies the input CSV and refuses to overwrite an existing output file;
//  - copies every original line byte for byte and appends one CSV field: the ticker's name, or an
//    empty field when the source does not list the ticker (unresolved, never guessed);
//  - verifies that removing the new column reproduces the input exactly;
//  - prints a report: matched tickers, unresolved tickers, both SHA-256 checksums.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [pricesPath, wikitextPath, outputPath] = process.argv.slice(2);
if (!pricesPath || !wikitextPath || !outputPath) {
  console.error(
    'usage: node scripts/add-stock-names.mjs <prices.csv> <constituents.wikitext> <output.csv>',
  );
  process.exit(2);
}
if (existsSync(outputPath)) {
  console.error(`refusing to overwrite ${outputPath}`);
  process.exit(2);
}

/** Ticker -> name from the "constituents" table (symbol templates such as {{NyseSymbol|MMM}}). */
function parseConstituents(wikitext) {
  const start = wikitext.indexOf('id="constituents"');
  if (start < 0) throw new Error('constituents table not found');
  const end = wikitext.indexOf('\n|}', start);
  const clean = (cell) =>
    cell
      .trim()
      .replace(/<ref[^>]*>.*?<\/ref>|<ref[^>]*\/>/g, '')
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1') // [[target|label]] -> label
      .replace(/'''?/g, '')
      .trim();
  const names = new Map();
  for (const row of wikitext.slice(start, end).split('\n|-').slice(1)) {
    const cells = row.split(/\n\|\|?|\|\|/).filter((cell) => cell.trim());
    const symbol = /\{\{[A-Za-z ]+\|([^}|]+)\}\}/.exec(cells[0] ?? '');
    const name = clean(cells[1] ?? '');
    if (symbol && name) names.set(symbol[1].trim(), name);
  }
  return names;
}

/** A CSV field, quoted only when needed (RFC 4180). */
const field = (value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

const input = readFileSync(pricesPath);
const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
if (text.includes('"'))
  throw new Error(
    'the input CSV contains quoted fields; this script expects the plain dataset format',
  );
const newline = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(newline);
const trailingNewline = lines.at(-1) === '';
if (trailingNewline) lines.pop();
const [header, ...rows] = lines;
if (header !== 'date,ticker,open,high,low,close,adj_close,volume')
  throw new Error('unexpected header');

const names = parseConstituents(readFileSync(wikitextPath, 'utf8'));
const tickers = new Set();
const output = [`${header},name`];
for (const row of rows) {
  const ticker = row.split(',')[1] ?? '';
  tickers.add(ticker);
  output.push(`${row},${field(names.get(ticker) ?? '')}`);
}
const result = output.join(newline) + (trailingNewline ? newline : '');

// Removing the appended field must give back the input exactly.
const restored =
  output
    .map((line, i) =>
      i === 0
        ? header
        : line.slice(0, line.length - field(names.get(line.split(',')[1] ?? '') ?? '').length - 1),
    )
    .join(newline) + (trailingNewline ? newline : '');
if (restored !== text) throw new Error('verification failed: original columns were not preserved');

writeFileSync(outputPath, result, { flag: 'wx' });
const sha = (data) => createHash('sha256').update(data).digest('hex');
const unresolved = [...tickers].filter((t) => !names.has(t)).sort();
console.log(
  JSON.stringify(
    {
      rows: rows.length,
      tickers: tickers.size,
      named: tickers.size - unresolved.length,
      unresolved,
      inputSha256: sha(input),
      outputSha256: sha(result),
    },
    null,
    2,
  ),
);
