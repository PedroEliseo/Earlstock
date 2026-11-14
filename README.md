# EarlStock – Historical Stock Market Explorer

EarlStock explores historical daily stock prices: browse the stocks of a dataset, inspect one stock's
price history with interactive charts, and compare the relative performance of several stocks.

Historical data is loaded from a CSV dataset into PostgreSQL by a command-line importer. PostgreSQL is
the application's source of truth at runtime: the API only ever reads it, never the CSV. There are no
live prices and no external market-data services. EarlStock is not a trading or real-time platform.

| Part | Path | Stack |
| ---- | ---- | ----- |
| Frontend | `frontend/` | React 19, TypeScript, Vite, Material UI, TanStack Query, React Router, lightweight-charts |
| API | `backend/` | Node.js, Express 5, TypeScript, `pg` (no ORM), zod |
| Importer | `backend/src/importer/` | Node.js CLI, `csv-parse` |
| Database | `docker-compose.yml`, `backend/migrations/` | PostgreSQL 18, plain SQL migrations |

## Features

- **Explorer** (`/`): every stock of the active dataset with its first and last available date.
  Case-insensitive ticker search, sorting by ticker or date, pages of 50; search, sort and page live
  in the URL. The API searches, sorts and pages, so each view is a single request for the 50 rows
  shown.
- **Stock detail** (`/stocks/:ticker`): coverage, the latest daily bar, range presets (1M, 3M, 6M,
  YTD, 1Y, 3Y, 5Y, MAX) anchored to the stock's **last available date** (never today's date), a
  custom range, a candlestick or line chart (close or adjusted close) with volume, and a paged table
  of every bar in the range.
- **Comparison** (`/compare`): two to five stocks on the trading dates **they all have in common**,
  each indexed to 100 on the first common date, with cumulative return, annualized realized
  volatility and maximum drawdown, and a table of the aligned observations.

### The dataset and its limits

- The dataset provides, per ticker and trading day: open, high, low, close, adjusted close and
  volume. It provides no company names, sectors, currencies or exchange calendar, so EarlStock shows
  none of them and never displays a currency symbol.
- `close` and `adj_close` are shown **as provided by the dataset**. The source does not state how
  the adjusted close was adjusted, so EarlStock makes no claim about it.
- Stocks can cover different periods. Ranges are always computed from the data actually available,
  and the interface states when a request was limited to the available history.
- Prices are exact decimals end to end (see [Numeric values](#numeric-values)).

## Architecture

```
browser ──► Vite dev server (proxy /api, /health) ──► Express API ──► PostgreSQL ◄── importer CLI
            React + MUI + TanStack Query               read-only role                 importer role
```

### Backend

Layered: routes → controllers (input validation with zod, HTTP mapping) → services (rules, e.g. "no
active dataset") → repositories (SQL) → a small `Database` wrapper over the `pg` pool that names every
query, logs slow ones and translates driver errors into application errors. Errors reach clients
only as `{ error: { code, message, details? } }`; SQL, parameters and PostgreSQL details are logged,
never returned. The API connects with a read-only role and accepts no request bodies.

### Dataset snapshots

Each successful import is one row of `data_imports`; `dataset_snapshot` points at the **active**
import. Prices are stored once per stock and date, and an import replaces them in a single
transaction that also moves the pointer, so readers see either the old dataset or the new one,
never a mixture (see [Replacement and activation](#replacement-and-activation)).

Every API query is a single SQL statement reading only the active import, and every data response
carries a **`Dataset-Snapshot: <importId>`** header naming the import it came from. The frontend
uses it to guarantee consistency across requests:

- A view built from several requests (a stock's metadata plus every price page, all stocks of a
  comparison) is loaded as one operation: every response must carry the
  same snapshot. If one differs, everything loaded so far is discarded, in-flight sibling requests
  are cancelled and the operation restarts (at most three attempts, then a recoverable error).
- The frontend remembers the newest snapshot it has seen. A late response from an older snapshot is
  discarded rather than displayed. When a newer snapshot appears, cached data from older snapshots is
  refetched once and a notice tells the user that a new dataset was activated.
- Snapshot ids are import ids, which only increase, because the importer always activates a newly
  created import.

### Frontend

`frontend/src/`:

| Folder | Responsibility |
| ------ | -------------- |
| `api/` | Typed fetch client, zod response validation, error types and user-facing error text, snapshot coordination (`loadConsistent`). No React. |
| `domain/` | Pure logic: calendar dates, range presets, exact decimal formatting, ticker parsing, date alignment, performance metrics. No React, no MUI. |
| `query/` | TanStack Query client and the snapshot provider (invalidation on a newer dataset). |
| `features/` | `explorer/`, `stock-detail/`, `comparison/`: a page, its query hook and its components. |
| `components/` | Shared UI (layout, status messages, range controls) and the shared chart lifecycle hook. |
| `theme/` | The single Material UI theme (light and dark color schemes). |

- **Server state** lives in TanStack Query; **view state** (search, sort, range, chart type,
  selected tickers, price basis) lives in the URL, so every view can be shared, reloaded and reached
  with the browser's back and forward buttons. There is no global state library.
- **Requests** are cancelled with `AbortSignal` when they become obsolete (leaving a page, changing a
  selection), and an obsolete response can never overwrite a current one.
- **Charts** use lightweight-charts through one lifecycle hook (`useLightweightChart`): the chart is
  created once per mount, resized with a `ResizeObserver`, and disposed on unmount, together with
  its crosshair subscription. Series and data are updated in place, never by re-creating the chart.
- **Code splitting**: the detail and comparison pages are lazy routes, and the chart library is
  loaded only with a chart, so the Explorer's initial bundle contains neither.
- **Errors** are shown with fixed text per error code (`describeError`). Server messages are never
  displayed.
- **Accessibility**: skip link, focus moved to the main content after navigation, keyboard-operable
  controls with visible focus, polite status and assertive error announcements, captioned tables. Every
  chart has a text description and a table with all its values. Rising and falling candles differ
  by fill (hollow or filled), and compared series by line pattern as well as color. Light and dark
  themes meet WCAG AA contrast, and reduced-motion preferences are respected.

### Numeric values

- **Prices** are `NUMERIC(18,6)` in PostgreSQL and travel as **decimal strings** through the API and
  the frontend. Every displayed price is formatted from its original string (grouping and padding
  only, never rounding), in the browser's locale.
- **Volume** is a `BIGINT` limited to 2^53 − 1, so the API can return it as an exact JSON number.
- **Chart coordinates and metrics** are the only places where prices become JavaScript numbers: the
  chart needs numbers to draw, and returns, volatility and drawdown are derived percentages shown
  with two decimals.
- **Dates** are `YYYY-MM-DD` strings everywhere (no time zone can shift a day).

### Comparison methodology

- **Common dates.** Only dates on which every selected stock has a price are compared. A date
  missing for any stock is left out for all of them; nothing is filled in or interpolated. The
  comparison range is resolved on the period all stocks cover: the latest first date to the earliest
  last date.
- **Index.** `price / price on the first common date × 100`, using the same price basis (close or
  adjusted close) for every stock.
- **Cumulative return.** `(last common price / first common price − 1) × 100`.
- **Maximum drawdown.** The most negative `price / running peak − 1` over the common dates, the
  baseline included. It is always ≤ 0.
- **Annualized volatility.** Historical realized volatility computed from **each stock's own** daily
  prices between the first and last common date: the sample standard deviation (n − 1) of returns
  between consecutive trading sessions × √252. It is reported only when there are at least 20 daily
  returns. It is not implied volatility and not a forecast.
  - **Limitation:** the dataset has no exchange calendar, so trading sessions are inferred from the
    data. Two observations are consecutive sessions when no selected stock traded between them and
    they are at most 5 calendar days apart. Returns across a gap are excluded and counted, never
    treated as daily. A session missing for **every** selected stock inside an ordinary short gap
    cannot be detected, and **adding or removing a stock can change another stock's volatility**.
    The interface states this next to the metric.

## Getting started

Requirements: Node.js 22.22 or later, Docker.

```sh
# 1. Database: start PostgreSQL, create the roles, apply migrations
cd backend
cp .env.example .env               # only if you do not have a .env yet
# Create backend/.env.local with the three role URLs (see "Database roles"), with generated passwords.
npm install
npm run db:setup

# 2. Data: place the dataset CSV under data/ (see "Dataset files"), then import it
npm run import -- --file ../data/<dataset>.csv --dry-run
npm run import -- --file ../data/<dataset>.csv

# 3. API
npm run dev                        # http://localhost:3000

# 4. Frontend (second terminal)
cd frontend
npm install
npm run dev                        # http://localhost:5173, proxies /api and /health to the API
```

The Vite dev server forwards `/api` and `/health` to `http://localhost:3000`. Set
`EARLSTOCK_API_URL` to use another API address. The browser therefore talks to a single origin and
the API needs no CORS configuration. How the built frontend is served in production is not decided
yet: `npm run build` produces static files in `frontend/dist/`, which any static host or reverse
proxy can serve if it also routes `/api` to the backend.

### Dataset files

The historical dataset is a CSV file kept under `data/` at the repository root. It is **not
committed** (git-ignored) until its source and redistribution licence have been verified, so it must
be placed there manually. Until a dataset is imported, the API answers `503 DATASET_NOT_LOADED` and
the frontend explains that no dataset is loaded.

## Scripts

**Backend** (`backend/`):

| Script                                   | Purpose                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                            | Start the API with hot reload (tsx)                                   |
| `npm run build` / `npm start`            | Compile to `dist/` / run the compiled build                           |
| `npm run import -- --file <csv> [...]`   | Validate and import a dataset CSV (see [Importing the dataset](#importing-the-dataset)) |
| `npm run db:setup`                       | Start PostgreSQL, provision roles, apply migrations                   |
| `npm run migrate:up` / `migrate:down`    | Apply all pending migrations / revert the latest one                  |
| `npm run migrate:create -- <name>`       | Create a new SQL migration in `migrations/`                           |
| `npm test`                               | Unit, HTTP and PostgreSQL integration tests (see [Testing](#testing)) |
| `npm run check`                          | Typecheck, lint, format check and tests                               |

**Frontend** (`frontend/`):

| Script                                  | Purpose                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                           | Vite dev server with the API proxy                                    |
| `npm run build` / `npm run preview`     | Typecheck and build to `dist/` / serve the build locally              |
| `npm test`                              | Unit and component tests (Vitest, React Testing Library, jsdom)       |
| `npm run check`                         | Typecheck, lint, format check and tests                               |
| `npm run notices`                       | Regenerate `public/third-party-notices.txt` (also runs before `dev` and `build`) |

## Configuration

Environment variables are validated at startup, and the process exits with a descriptive error if
any is invalid. Every backend npm script loads `backend/.env` and then `backend/.env.local` (both
git-ignored). See `backend/.env.example`.

| Variable                   | Used by                     | Description                                                     |
| -------------------------- | --------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`                 | API                         | `development`, `test` or `production` (default `development`)   |
| `PORT`                     | API                         | HTTP port (default `3000`)                                      |
| `MARKET_DATA_DATABASE_URL` | **API** (required), provisioning, tests | Read-only API role. The API has no fallback to any other URL. |
| `DATABASE_POOL_MAX`        | API                         | Maximum pooled connections, 1–100 (default `10`)                |
| `DATABASE_STATEMENT_TIMEOUT_MS` | API                    | Per-statement time limit for the API pool, 100–60000 ms (default `5000`) |
| `MIGRATION_DATABASE_URL`   | migrations, provisioning, tests | Schema-owner role                                           |
| `IMPORTER_DATABASE_URL`    | **importer** (required), provisioning, tests | Dataset importer role. The importer has no fallback to any other URL and refuses to run if this URL reuses another role. |
| `DATABASE_URL`             | safety checks only          | Administrative (superuser) connection to the development database; not used to connect |
| `TEST_DATABASE_URL`        | test setup                  | Administrative connection to the test database, used only to drop and recreate it; see [Testing](#testing) |
| `EARLSTOCK_API_URL`        | frontend dev server         | API address for the Vite proxy (default `http://localhost:3000`) |

Credentials live only in git-ignored `.env` files, and only `.env.example` is committed. The superuser
values in it are local Docker Compose defaults for a database bound to localhost. The EarlStock role
passwords are generated per developer and kept only in `backend/.env.local`.

## API

All endpoints are `GET` and read-only. Successful responses are JSON objects with a `data` field.

### Errors

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed", "details": [{ "path": "limit", "message": "…" }] } }
```

| Status | `code` | When |
| ------ | ------ | ---- |
| 400 | `VALIDATION_FAILED` | Invalid path or query parameter; `details` lists each problem |
| 400 | `BAD_REQUEST` | Malformed request |
| 404 | `NOT_FOUND` | Unknown route, or no such stock in the active dataset |
| 503 | `DATASET_NOT_LOADED` | No dataset has been imported and activated yet |
| 503 | `DATABASE_UNAVAILABLE` | The database cannot be reached (with a `Retry-After` header) |
| 503 | `DATABASE_TIMEOUT` | A query exceeded its time limit |
| 500 | `INTERNAL` | Anything else; no details are returned |

### Dataset snapshot header

Every successful `/api/stocks…` response carries `Dataset-Snapshot: <importId>`, the import the
data was read from. Clients combining several responses (pages, or a stock's metadata and prices)
must check that they all carry the same value, and start again if not.

### Health

| Path            | Response |
| --------------- | -------- |
| `/health`       | Liveness: `200 { "status": "ok", "uptime": <seconds>, "timestamp": "<ISO 8601>" }` while the process serves HTTP. Never touches the database. |
| `/health/ready` | Readiness: `200` or `503` with `{ "status": "ok" \| "unavailable", "checks": { "database": "up" \| "down", "dataset": "loaded" \| "empty" \| "unknown", "privileges": "ok" \| "excessive" \| "unknown" } }`. Ready means the database answers, a dataset is active, and the API role has no more privileges than it should. |

### `GET /api/stocks`

Stocks of the active dataset, searched, ordered and paged by the database.

| Query param | Default  | Constraints / meaning |
| ----------- | -------- | --------------------- |
| `limit`     | `20`     | integer, 1–100 |
| `offset`    | `0`      | integer, ≥ 0 |
| `q`         | —        | Case-insensitive ticker substring, at most 32 characters; blank means no filter. Matched literally (`%` and `_` are not wildcards). |
| `sort`      | `ticker` | `ticker`, `firstDate` or `lastDate` |
| `dir`       | `asc`    | `asc` or `desc`; ties are always broken by ticker ascending, so pages are deterministic |

Tickers order byte-wise (locale-independent). `pagination.total` counts every stock matching `q`.
Sorting by date considers all matching stocks, not only the page: each stock's first and last date
come from two index probes on the `(stock_id, trade_date)` primary key.

```json
{
  "data": [{ "ticker": "BRK.B", "firstDate": "YYYY-MM-DD", "lastDate": "YYYY-MM-DD" }],
  "pagination": { "limit": 20, "offset": 0, "total": 500 }
}
```

### `GET /api/stocks/:ticker`

A stock's coverage and its latest bar. The ticker is matched case-insensitively. Encode special
characters in the path (`^GSPC` → `%5EGSPC`). `404` if the active dataset has no such stock.

```json
{
  "data": {
    "ticker": "AAPL",
    "coverage": { "firstDate": "YYYY-MM-DD", "lastDate": "YYYY-MM-DD", "tradingDays": 250 },
    "latest": { "date": "YYYY-MM-DD", "open": "273.06", "high": "273.68", "low": "271.75",
                "close": "271.86", "adjClose": "271.122", "volume": 27293600 }
  }
}
```

### `GET /api/stocks/:ticker/prices`

Daily bars, oldest first, with cursor pagination.

| Query param | Default | Description |
| ----------- | ------- | ----------- |
| `from`      | —       | First date, inclusive (`YYYY-MM-DD`) |
| `to`        | —       | Last date, inclusive; not earlier than `from` |
| `after`     | —       | Exclusive cursor: only dates strictly after it; must lie within `[from, to]` |
| `limit`     | `1000`  | Bars per page, 1–5000 |

```json
{
  "data": [{ "date": "YYYY-MM-DD", "open": "…", "high": "…", "low": "…", "close": "…", "adjClose": "…", "volume": 0 }],
  "page": { "limit": 1000, "nextAfter": "YYYY-MM-DD" }
}
```

`nextAfter` is the last date of the page when more bars follow, otherwise `null`. Pass it as `after`
(with the same `from` and `to`) to get the next page. Prices are decimal strings with trailing zeros
removed, and `volume` is a JSON number.

## Database

PostgreSQL 18, accessed with `pg` (no ORM). The schema is managed with plain SQL migrations in
`backend/migrations/` (node-pg-migrate). **Never edit a migration that has been applied anywhere**;
add a new one instead. Migrations that destroy data refuse to run while the affected tables
contain rows: take a backup (`pg_dump`) and empty them explicitly first.

### Database roles

The application runs with least privilege; the superuser is never used by the backend or by
migrations.

| Role                 | Kind             | Can do                                                                  | Used by |
| -------------------- | ---------------- | ----------------------------------------------------------------------- | ------- |
| `earlstock_owner`    | login            | Owns the database and every object in it; runs DDL. Not superuser; cannot create roles or databases. | migrations (`MIGRATION_DATABASE_URL`) |
| `market_data_reader` | group (no login) | `CONNECT`, `USAGE` on schema `public`, `SELECT` on `stocks`, `daily_prices`, `data_imports`, `dataset_snapshot` (granted by migrations) | — |
| `earlstock_api`      | login            | Member of `market_data_reader` only; sessions start read-only. Owns nothing; cannot write, change the schema, read migration history or use sequences. | backend (`MARKET_DATA_DATABASE_URL`) |
| `market_data_writer` | group (no login) | `CONNECT`, `USAGE` on `public`; `SELECT, INSERT, DELETE` on `stocks` and `daily_prices`; `SELECT, INSERT` and column-limited `UPDATE` on `data_imports` (status and result columns) and `dataset_snapshot` (`import_id`, `activated_at`) (granted by migration `importer-permissions`) | — |
| `earlstock_importer` | login            | Member of `market_data_writer` only. Owns nothing; no `UPDATE` of prices or stocks, no `TRUNCATE`, no `DELETE` of import history or of the snapshot pointer, no DDL, no sequences, no migration history, no administrative operations. | importer (`IMPORTER_DATABASE_URL`) |
| superuser (`POSTGRES_USER`) | login     | Everything                                                              | only provisioning and creating/dropping test databases |

- **Grants are explicit** per table, in migrations; there are no default privileges, so a new table
  is not readable by the API until a migration grants it.
- **Read-only is enforced by grants.** `default_transaction_read_only` is only an extra layer: the
  tests show writes still fail when a session switches it off.
- PostgreSQL's defaults for `PUBLIC` (`CONNECT`, `TEMP`) are left in place: the API role can create
  session-local temporary tables, but cannot read or change anything else.

**Provisioning** (`npm run db:provision`, run as the superuser by a one-shot Compose service)
creates or corrects the roles from `MIGRATION_DATABASE_URL`, `MARKET_DATA_DATABASE_URL` and
`IMPORTER_DATABASE_URL` in `backend/.env.local`, the same file the backend and migrations use, so passwords have a single
source. It reads them with psql's `\getenv` (never as command-line arguments), never prints them, and
transfers ownership of the database and of every object in schema `public` (tables, views,
materialized views, sequences, types, routines) to the owner role, then verifies that nothing else
owns anything. It is idempotent and refuses invalid configurations (missing or malformed URLs, a
role shared by two URLs, URLs naming different databases, a superuser or system database,
passwords needing URL encoding).

`npm run db:setup` runs the whole sequence from `backend/`: start PostgreSQL and wait until it is
healthy, provision, then apply migrations as the owner role. Real environments provision their own
roles and passwords; the Compose defaults are for local development only.

### Data model

| Table          | Purpose                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `stocks`       | One row per instrument: internal `id` (UUIDv7, generated by PostgreSQL) and a unique `ticker` |
| `daily_prices` | One row per stock and trading date: `open`, `high`, `low`, `close`, `adj_close`, `volume`, and the `import_id` that wrote it |
| `data_imports` | One row per import attempt: source file name, SHA-256, status, timestamps and statistics |

- **Tickers** are canonical upper-case identifiers: alphanumeric segments joined by `.`, `-` or `=`,
  optionally prefixed with `^`, up to 32 characters (e.g. `BRK.B`, `BRK-B`, `EURUSD=X`, `^GSPC`).
  Lower case, whitespace and `/` are rejected; tickers sort byte-wise (`COLLATE "C"`).
- **Prices** are `NUMERIC(18,6)` and hold the dataset's values exactly as provided. The schema does
  not assert how `close` or `adj_close` were adjusted; that depends on the data source. Constraints
  enforce `low ≤ open, close ≤ high`, positive prices and a positive `adj_close`.
- **Volume** is a `BIGINT` between 0 and 2^53 − 1, so it can always be represented exactly where a
  JSON number is required.
- **`trade_date`** is a `DATE` with no assumed range or calendar; any trading day can be stored.
- **Primary key** `(stock_id, trade_date)` prevents duplicate bars and serves every per-stock query
  (date ranges, latest bar, first and last dates). No other indexes are added until a query needs one.
- **No JIT for the API.** The API pool disables PostgreSQL's JIT compilation (`jit=off` per session):
  its queries are short index lookups, but the planner can overestimate them. The stock list was
  estimated at millions of cost units, triggering about 66 ms of LLVM compilation for 2 ms of work.
- **Foreign keys** from `daily_prices` to `stocks` and `data_imports` do not cascade: deleting a stock
  or an import that still has prices fails.
- A **succeeded** import must record `rows_read`, `stock_count` and `price_count` as non-NULL and
  greater than zero (checked explicitly, because a SQL `CHECK` accepts NULL), with
  `stock_count ≤ price_count ≤ rows_read`. A **running** import has no `finished_at`; a **failed** one
  must have an `error_summary`.

### History

- `stocks.id` defaults to `uuidv7()` (native in PostgreSQL 18): time-ordered IDs keep primary-key
  inserts append-mostly in the B-tree.
- Live quote ingestion was removed (migration `remove-live-ingestion`, which drops `price_quotes`
  and `provider_api_usage`). The previous implementation remains available in the repository's
  baseline commit.
- `historical-daily-prices` reshaped `stocks` (dropping `name`, `exchange` and `currency`, which the
  historical dataset does not provide) and created `daily_prices` and `data_imports`. It refuses to
  run while `stocks` has rows, and its rollback refuses to run while any of the three tables has rows.
- `market-data-permissions` grants the read-only API group its `SELECT` privileges.
- `dataset-snapshot` adds the `dataset_snapshot` pointer to the active import.
- `importer-permissions` grants the importer group its write privileges.

## Importing the dataset

```sh
cd backend
npm run import -- --file ../data/<dataset>.csv --dry-run   # validate and compare; writes nothing
npm run import -- --file ../data/<dataset>.csv             # validate, replace and activate
```

The importer is a standalone CLI (`src/importer/`), never an HTTP endpoint or part of API startup.
It connects only as `earlstock_importer` (`IMPORTER_DATABASE_URL`), over **one dedicated
PostgreSQL session** (a single `pg.Client`, never a pool) used for the lock, the bookkeeping and
the replacement. It first checks its own role and refuses to run if the role has more privileges
than it needs (superuser, ownership, DDL, `TRUNCATE`, `UPDATE` of prices, rewriting provenance, …).

| Option           | Effect |
| ---------------- | ------ |
| `--file <path>`  | The CSV to import (required). Only its base name is recorded. |
| `--dry-run`      | Read, hash and fully validate the file, and compare it with the active dataset. The session is switched to read-only: no lock, no `data_imports` record, no write of any kind. |
| `--force`        | Re-import even if this exact file (same SHA-256) is already the active dataset. |
| `--allow-shrink` | Accept a dataset that is smaller than the active one (see below). |

Exit codes: `0` imported, already active, or dry run passed · `1` rejected (validation or shrink;
recorded as a failed import, except in dry runs) · `2` bad arguments, configuration, unreadable
file or over-privileged role · `3` another import is running (nothing done) · `4` database or
unexpected error (recorded as a failed import when possible). Logs are JSON lines with line and
column numbers, never credentials or field values.

### Input format and validation

The whole file is validated **before** any active data is touched; one problem rejects the whole
file. Nothing is trimmed, normalized, rounded or guessed.

- At most 64 MiB, read once: the SHA-256 recorded in `data_imports` is computed over exactly the
  bytes that are validated and imported. Strict UTF-8 (a leading byte-order mark is ignored); `LF`
  or `CRLF` line endings; RFC 4180 quoting via `csv-parse`.
- Header exactly `date,ticker,open,high,low,close,adj_close,volume`, in that order. Every row has 8
  fields; no field may be empty or have surrounding whitespace.
- `date`: `YYYY-MM-DD`, a real calendar day. **Future-date rule:** a date later than the execution
  date in UTC is rejected (the execution date itself is accepted). The result therefore depends on
  when the importer runs; a file dated "today" in a time zone ahead of UTC could be rejected until
  UTC reaches that date.
- `ticker`: already canonical, as the database requires (upper case, `A-Z0-9` segments joined by
  `.`, `-` or `=`, optional `^` prefix, at most 32 characters). Lower case is rejected, not
  converted, so two spellings can never be merged silently. Tickers are stored as provided
  (`BRK.B` is not mapped to `BRK-B`).
- Prices: plain decimals (no sign, exponent or leading zeros), at most 12 integer digits and **at
  most 6 decimals**: a 7th decimal is rejected, because `NUMERIC(18,6)` would round it. Values are
  compared as exact fixed-point `BigInt`s and stored from their original text; JavaScript `Number`
  is never used. `low > 0`, `adj_close > 0`, `low ≤ open, close ≤ high`. `close` and `adj_close`
  are kept separately as provided; no relationship between them is assumed.
- `volume`: a non-negative integer up to 2^53 − 1.
- **Duplicates:** any repeated `(ticker, date)` rejects the file, including exact duplicate rows.
  No winner is ever chosen.
- An empty or header-only file is rejected.

### Replacement and activation

`daily_prices` holds one version of each stock and date, so an import **replaces** the dataset:

1. Take the importer advisory lock (`pg_try_advisory_lock`, session-level, non-blocking). If another
   importer holds it, exit `3` without writing anything.
2. Mark any import still `running` as `failed` ("abandoned"): with the lock held, no importer is
   running, so such a row can only come from a process that died.
3. If the file's SHA-256 equals the active import's and `--force` is not given: no-op, exit `0`, no
   record.
4. Insert a `running` record (committed on its own, so every attempt leaves a trace).
5. Validate the whole file. On failure, mark the record `failed` with a bounded, value-free summary.
6. **Shrink guard:** compare with the active dataset, measured from its stored rows. If the new
   dataset has fewer stocks, fewer price rows, coverage starting later or coverage ending earlier,
   it is refused (and recorded as failed, naming every dimension) unless `--allow-shrink` is given.
7. In **one transaction** (`READ COMMITTED`, `lock_timeout` 10 s): lock the pointer row and check it
   has not changed; insert new tickers (`ON CONFLICT DO NOTHING`, so stock ids stay stable);
   `DELETE` all prices; insert the new ones in batches of 10,000 rows (one `INSERT … SELECT FROM
   unnest(typed arrays) JOIN stocks` per batch, every batch's row count checked); delete stocks
   left without prices; verify the table holds exactly the validated row and stock counts; mark the
   import `succeeded`; move `dataset_snapshot` to it; `COMMIT`.
8. On any error the transaction is rolled back, then the record is marked `failed` separately. The
   previous dataset and pointer are untouched. Finally the lock is released (it would also be
   released by closing the session).

**What readers see.** Every API query is a single statement, and PostgreSQL gives each statement
one snapshot (MVCC). Until `COMMIT`, readers see the previous rows and pointer; after it, the new
ones; never a mixture. `DELETE` (not `TRUNCATE`) is used because it takes a `ROW EXCLUSIVE` lock,
which blocks no reader; `TRUNCATE`'s `ACCESS EXCLUSIVE` lock would block the API for the whole
import, which is why the importer is not granted it.

**What the advisory lock guarantees, precisely.** It serializes sessions that take the same lock,
that is, runs of this importer: two importers can never interleave. It does **not** stop a session
that ignores it, such as the owner role or a superuser writing directly. The other safeguards are
narrower but real: only the owner, the superuser and the importer role can write these tables (the
API role cannot); the replacement aborts if the pointer changed since validation or if the final
row counts differ from the validated dataset; and primary keys, foreign keys and `CHECK`
constraints hold for every writer. Known trade-off: `DELETE` privilege also allows `LOCK TABLE` in
any mode, so an `earlstock_importer` session *could* lock out readers explicitly; the importer
never does.

**Maintenance.** Each replacement leaves the old rows as dead tuples. The importer cannot `VACUUM`
or `ANALYZE` (that needs ownership or `MAINTAIN`, which would also allow `CLUSTER`/`REINDEX` and
their exclusive locks); PostgreSQL's autovacuum handles it.

## Testing

```sh
cd backend && npm run db:setup && npm test    # API, importer and PostgreSQL integration tests
cd frontend && npm test                        # frontend unit and component tests
```

**Frontend tests** (`frontend/src/**/*.test.ts(x)`, Vitest with jsdom and React Testing Library) need
no backend. `fetch` is replaced by an in-memory fake API that sends `Dataset-Snapshot` headers like the
real one, and `lightweight-charts` by a recording fake, so chart creation, updates, resizing and
disposal are verified without a canvas. They cover the API client and snapshot coordination
(restarts, cancellation, stale responses), pagination of lists and price histories, every page's
states, URL state, ranges, exact formatting, comparison alignment and metrics. Test dates are
computed relative to the current date and never hard-coded.

**Backend tests:**

- **Unit tests** (`src/**/*.test.ts`, `tests/setup/*.test.ts`) need no database.
- **HTTP tests** (`tests/*.test.ts`) run the Express app in-process with Supertest.
- **Database tests** (`tests/*.db.test.ts`) run against the test database. Before each run, the
  test setup **drops and recreates** it (owned by the owner role) and applies every migration as
  the owner role, so each run starts empty and exercises the full migration chain; each test then
  starts from truncated tables. **The application under test connects as the read-only API role**
  and **the importer as the importer role**, exactly as in production; fixtures are written as the
  owner role. Test connections reuse the role credentials from `MIGRATION_DATABASE_URL`,
  `MARKET_DATA_DATABASE_URL` and `IMPORTER_DATABASE_URL`, retargeted at the test database, so no
  credentials are configured twice. They
  are skipped when `TEST_DATABASE_URL` is unset. Because all database test files share one
  database, Jest runs test files one at a time (`maxWorkers: 1`).
- **Schema tests** (`tests/schema.db.test.ts`) check every constraint with direct SQL.
- **Permission tests** (`tests/permissions.db.test.ts`) run statements as each role and check
  PostgreSQL's actual answers: the API role can read the three data tables and run the application,
  and cannot write (even with read-only switched off), change the schema, read migration history,
  use sequences, perform administrative operations or assume other roles.
  `tests/importer-permissions.db.test.ts` does the same for the importer role: exactly the granted
  table and column privileges, every statement the importer runs succeeds, and `UPDATE` of
  prices, `TRUNCATE`, deleting history, DDL, maintenance, sequences, migration history, file access
  and role changes are refused.
- **Importer tests**: `src/importer/*.test.ts` cover parsing and validation without a database
  (dates relative to the execution date, never hard-coded); `tests/importer.db.test.ts` covers
  activation, exact decimal storage, idempotency, rejection, rollback of failed batches and of
  database errors, what concurrent API readers see before and after `COMMIT`, the advisory lock
  (held by the writing session throughout, released on success and failure, a second importer
  refused), abandoned imports, retries, the shrink guard, dry runs leaving every table unchanged,
  and the CLI's exit codes.
- **Migration tests** (`tests/migrations.db.test.ts`) use a second disposable database, named after
  the test database with `_migrations` inserted (e.g. `earlstock_migrations_test`). It passes the
  same safeguards, and its name must also differ from the test database's. The tests run every
  migration up and down, check that rollbacks restore exact table definitions, and check that
  destructive migrations refuse to run on data.

Safeguards keep tests away from any other database. They fail closed: anything ambiguous is refused.

- The test database name must end in `_test`.
- The superuser connection (`TEST_DATABASE_URL`) is used only to drop and create test databases.
  If it is set, the role URLs are required too: tests never fall back to the superuser.
- `TEST_DATABASE_URL` is compared with `DATABASE_URL`, `MIGRATION_DATABASE_URL`,
  `MARKET_DATA_DATABASE_URL` and `IMPORTER_DATABASE_URL` after parsing (host, port and database
  name, independently of credentials); the API and importer roles must differ from each other and
  from the owner and administrative roles. The same database name is refused even on a different host or port, because host
  aliases and port forwarding can reach the same server. URLs without an explicit host, or with
  query parameters that could redirect the connection, are refused.
- The database is dropped through a separate maintenance connection (to `postgres`), after asking
  the server which database that connection is on.
- Before truncating, the test helper asks the server for `current_database()` and refuses unless it
  ends in `_test`. This still holds when Jest is started without the global setup (IDE runners,
  custom configs).
