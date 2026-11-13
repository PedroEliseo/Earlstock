# EarlStock

Stock market tracking application. This repository currently contains the backend API (`backend/`);
the React frontend will be added later.

## Getting started

Requirements: Node.js 22.12+, Docker.

```sh
docker compose up -d --wait        # PostgreSQL 18 on localhost:5432
cd backend
cp .env.example .env
npm install
npm run migrate:up                 # apply migrations to the development database
npm run dev                        # http://localhost:3000
```

## Backend scripts

| Script                                   | Purpose                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                            | Start with hot reload (tsx)                                           |
| `npm run build` / `npm start`            | Compile to `dist/` / run the compiled build                           |
| `npm run migrate:up` / `migrate:down`    | Apply all pending migrations / revert the latest one                  |
| `npm run migrate:create -- <name>`       | Create a new SQL migration in `migrations/`                           |
| `npm test`                               | Unit + integration tests (see [Testing](#testing))                    |
| `npm run check`                          | Typecheck, lint, format check and tests — what CI should run          |
| `npm run lint` / `format` / `typecheck`  | Individual quality checks                                             |

## Configuration

Environment variables are validated at startup; the process exits with a descriptive error if any
is invalid. See `backend/.env.example`.

| Variable            | Required | Default       | Description                                                   |
| ------------------- | -------- | ------------- | ------------------------------------------------------------- |
| `NODE_ENV`          | no       | `development` | `development`, `test` or `production`                         |
| `PORT`              | no       | `3000`        | HTTP port                                                     |
| `DATABASE_URL`      | yes      | —             | `postgres://user:password@host:port/database`                 |
| `DATABASE_POOL_MAX` | no       | `10`          | Maximum pooled connections (1–100)                            |
| `TEST_DATABASE_URL` | no       | —             | Isolated test database; must end in `_test` (tests only)      |
| `MARKET_DATA_PROVIDER` | no    | `demo`        | `demo` (synthetic data, no key, no external calls) or `eodhd` |
| `EODHD_API_KEY`     | with `eodhd` | —         | EODHD API key. The app refuses to start with `eodhd` and no key. |
| `EODHD_DAILY_CALL_BUDGET` | no | `15`          | Max EODHD API calls per UTC day (free plan: 20, minus a 5-call margin) |

Secrets such as `EODHD_API_KEY` belong in `backend/.env`, which is git-ignored. They are only read
by the backend, are never returned by any endpoint, and never appear in error messages or logs.

## API

All responses are JSON. Successful responses wrap the payload in `data`; errors always use the same
shape:

```json
{ "error": { "message": "Request validation failed", "details": [{ "path": "currency", "message": "must be a 3-letter ISO 4217 code" }] } }
```

`details` is present only for validation errors (HTTP 400).

### Health

| Method | Path            | Description                                                                 |
| ------ | --------------- | --------------------------------------------------------------------------- |
| GET    | `/health`       | Liveness. `200` while the process is serving HTTP; never checks the database. |
| GET    | `/health/ready` | Readiness. `200 {"status":"ok"}` or `503 {"status":"unavailable"}` depending on database reachability. |

### Stocks

A stock:

```json
{
  "id": "01a1d532-0c63-78b9-a7df-5ada06ef20de",
  "symbol": "MSFT",
  "name": "Microsoft",
  "exchange": "NASDAQ",
  "currency": "USD",
  "createdAt": "2026-11-13T13:56:29.410Z"
}
```

#### `GET /api/stocks`

Lists stocks ordered by `exchange`, then `symbol`.

| Query param | Default | Constraints     |
| ----------- | ------- | --------------- |
| `limit`     | `20`    | integer, 1–100  |
| `offset`    | `0`     | integer, ≥ 0    |

`200`:

```json
{ "data": [/* stocks */], "pagination": { "limit": 20, "offset": 0, "total": 42 } }
```

`400` for invalid pagination parameters.

#### `GET /api/stocks/:id`

`200 { "data": stock }` · `400` if `id` is not a UUID · `404` if no such stock.

#### `POST /api/stocks`

```json
{ "symbol": "MSFT", "name": "Microsoft", "exchange": "NASDAQ", "currency": "USD" }
```

| Field      | Rules                                                                       |
| ---------- | --------------------------------------------------------------------------- |
| `symbol`   | 1–16 chars: letters, digits, `.`, `-`. Trimmed and upper-cased.             |
| `name`     | 1–255 chars. Trimmed.                                                       |
| `exchange` | 1–32 chars: letters, digits, `.`, `-`. Trimmed and upper-cased.             |
| `currency` | ISO 4217 code (3 letters). Upper-cased.                                     |

Unknown fields are rejected; the `id` is generated by the database.

`201 { "data": stock }` with a `Location: /api/stocks/:id` header · `400` for an invalid or malformed
body · `409` if a stock with the same `exchange` and `symbol` already exists (case-insensitive, as
both are upper-cased).

#### `DELETE /api/stocks/:id`

`204` (empty body) · `400` if `id` is not a UUID · `404` if no such stock · `409` if the stock has
price quotes — historical data is never deleted implicitly.

### Price quotes

A quote:

```json
{
  "id": "1",
  "stockId": "01a1d53c-b304-7f86-ac27-dacdf414f662",
  "price": "189.25",
  "volume": "52164503",
  "observedAt": "2026-11-13T20:30:00.000Z",
  "provider": "manual",
  "createdAt": "2026-11-13T20:30:01.460Z"
}
```

- **`price` and `volume` are decimal strings**, never JSON numbers, in both requests and responses.
  JSON numbers are binary doubles and silently lose precision beyond ~15 significant digits; the
  database stores exact `NUMERIC(20,8)` / `NUMERIC(24,8)` values and the API passes them through
  as text. Trailing zeros are dropped (`"189.50000000"` → `"189.5"`); the value is unchanged.
- **`id` is a string** because it is a `BIGINT`, which can exceed JavaScript's safe integer range.
- **Timestamps** are ISO 8601 and are always returned in UTC with millisecond precision.

#### `POST /api/stocks/:stockId/quotes`

```json
{ "price": "189.25", "volume": "52164503", "observedAt": "2026-11-13T15:30:00-05:00", "provider": "manual" }
```

| Field        | Rules                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| `price`      | Required. Decimal string > 0, at most 12 integer digits and 8 decimal places.          |
| `volume`     | Optional (`null` or omitted). Decimal string ≥ 0, at most 16 integer and 8 decimal digits. |
| `observedAt` | Required. ISO 8601 date-time **with an offset** (`Z` or `±hh:mm`), at most millisecond precision. |
| `provider`   | Required. 1–32 chars: letters, digits, `.`, `_`, `-`. Trimmed and lower-cased.         |

`201 { "data": quote }` · `400` for invalid input or stock id · `404` if the stock does not exist ·
`409` if a quote for the same stock, instant and provider already exists.

**Duplicates are rejected, never overwritten.** Uniqueness is on `(stock, observedAt, provider)`,
where `observedAt` is compared as an instant (`16:30+01:00` and `15:30Z` are the same) and
`provider` case-insensitively. The original quote is kept unchanged.

#### `GET /api/stocks/:stockId/quotes/latest`

The quote with the most recent `observedAt` (not the most recently inserted). Quotes from several
providers at the same instant are tie-broken by `provider`, descending.

`200 { "data": quote }` · `200 { "data": null }` if the stock exists but has no quotes yet ·
`400` for an invalid stock id · `404` if the stock does not exist.

#### `GET /api/stocks/:stockId/quotes`

Historical quotes, newest first (`observedAt` descending, then `provider` descending).

| Query param | Default | Constraints                                                   |
| ----------- | ------- | ------------------------------------------------------------- |
| `from`      | —       | ISO 8601 with offset. **Inclusive**: `observedAt >= from`.     |
| `to`        | —       | ISO 8601 with offset. **Exclusive**: `observedAt < to`. Must be later than `from`. |
| `limit`     | `20`    | integer, 1–100                                                |
| `offset`    | `0`     | integer, ≥ 0                                                  |

Omitting a bound leaves that side open. URL-encode offsets: a literal `+` in a query string
decodes to a space (`from=2026-11-13T10:00:00%2B01:00`).

`200 { "data": [quotes], "pagination": { "limit", "offset", "total" } }`, where `total` counts all
quotes in the range · `400` for invalid parameters · `404` if the stock does not exist.

### Synchronization

#### `POST /api/sync`

Fetches quotes for **every stock** from the configured market data provider and stores them. It
always runs on the backend; the browser never talks to the provider and never sees the API key.

```json
{ "mode": "latest" }            // default: one current quote per stock (EODHD: 15–20 min delayed)
{ "mode": "daily", "days": 30 } // daily closes for the last `days` UTC days, today included (1–365)
```

The body is optional. `200` returns a summary; individual stock failures do not fail the request:

```json
{
  "data": {
    "provider": "eodhd",
    "mode": "latest",
    "startedAt": "2026-11-13T14:23:46.481Z",
    "finishedAt": "2026-11-13T14:23:47.102Z",
    "totals": { "symbols": 3, "succeeded": 2, "failed": 1, "inserted": 1, "skippedDuplicates": 1 },
    "symbols": [
      { "stockId": "…", "symbol": "AAPL", "exchange": "NASDAQ", "status": "ok", "inserted": 1, "skippedDuplicates": 0 },
      { "stockId": "…", "symbol": "MSFT", "exchange": "NASDAQ", "status": "ok", "inserted": 0, "skippedDuplicates": 1 },
      { "stockId": "…", "symbol": "NOPE", "exchange": "NASDAQ", "status": "failed", "inserted": 0, "skippedDuplicates": 0,
        "error": { "code": "not_found", "message": "EODHD does not know this ticker" } }
    ],
    "apiUsage": { "provider": "eodhd", "date": "2026-11-13", "callsUsed": 3, "dailyBudget": 15 }
  }
}
```

- `skippedDuplicates`: quotes already stored for the same stock, instant and provider. Existing
  quotes are never overwritten.
- `apiUsage` is `null` in demo mode.
- Error codes: `not_found`, `timeout`, `network`, `http_error`, `invalid_response` (the run
  continues), and `budget_exhausted`, `provider_limit_reached`, `rate_limited`, `unauthorized`
  (the run stops; remaining stocks are reported as `Not attempted: …`).

Other responses: `400` invalid body · `409` a synchronization is already running (enforced with a
PostgreSQL advisory lock, so it also holds across app instances) · `429` the daily API budget is
already used up, with a `Retry-After` header (seconds until 00:00 UTC).

## Market data providers

| Mode    | Source                                   | API key | Stored as `provider` |
| ------- | ---------------------------------------- | ------- | -------------------- |
| `demo`  | Deterministic synthetic prices (no network, no licensed data) | no | `demo` |
| `eodhd` | [EODHD](https://eodhd.com) live (delayed) and end-of-day APIs | yes | `eodhd` |

Every stored quote carries its source in `provider`, so synthetic and real data are never
indistinguishable — including in `GET /api/stocks/:id/quotes/latest`, which returns the newest
quote from any source.

**Run in demo mode** (default): leave `MARKET_DATA_PROVIDER=demo`; no key needed.

**Run with EODHD**: in `backend/.env` set `MARKET_DATA_PROVIDER=eodhd` and
`EODHD_API_KEY=<your key>`, then restart. Only the backend reads the key.

### EODHD specifics

- Tickers are `SYMBOL.EXCHANGE`. US venues (`NASDAQ`, `NYSE`, `AMEX`, `NYSEARCA`, …) map to `US`;
  other exchange codes are passed through unchanged (use EODHD's codes, e.g. `LSE`, `XETRA`). Dots
  in symbols become dashes (`BRK.B` → `BRK-B.US`).
- `latest` uses `GET /api/real-time/{ticker}`; `daily` uses `GET /api/eod/{ticker}` and stores the
  raw `close` (not `adjusted_close`) at 00:00 UTC of the trading day.
- Requests time out after 10 s. Responses are validated (schema, positive prices, matching ticker)
  and then checked against the same rules as manual quote input before anything is stored.

### API call accounting

EODHD bills *API calls*, not HTTP requests, and the free plan allows 20 per day (reset at midnight
GMT). EarlStock enforces its own lower budget (`EODHD_DAILY_CALL_BUDGET`, default 15):

- **Costs per request** follow EODHD's published table: end-of-day = 1 call per request (any date
  range), live quote = 1 call per symbol. Sync requests one symbol at a time, so a sync of N stocks
  costs N calls in either mode.
- **Reserve before sending.** Each request first reserves its cost with a single atomic SQL
  statement on `provider_api_usage (provider, usage_date)`, which only succeeds if the new total
  stays within the budget. Concurrent requests serialize on that row, so the budget can never be
  exceeded, and the count survives restarts.
- **Conservative.** A reserved call stays counted even if the request then fails (EODHD bills 404s,
  and a timed-out request may have been billed). The counter can over-count, never under-count.
- If EODHD answers `402` (its own daily limit reached — e.g. the key is also used elsewhere), the
  day's budget is marked as exhausted.
- Demo mode never touches the counter.

## Database

PostgreSQL 18, accessed with `pg` (no ORM). The schema is managed with plain SQL migrations in
`backend/migrations/` (node-pg-migrate). **Never edit a migration that has been applied anywhere**;
add a new one instead.

### Schema decisions

- **`stocks.id` defaults to `uuidv7()`** (native in PostgreSQL 18). IDs are generated by the
  database and are time-ordered, which keeps primary-key inserts append-mostly in the B-tree.
- **`price_quotes.stock_id` references `stocks(id)` with no `ON DELETE` action.** PostgreSQL rejects
  deleting a stock that has quotes; the API surfaces this as `409`.
- **No separate `(stock_id, observed_at DESC)` index on `price_quotes`.** The
  `UNIQUE (stock_id, observed_at, provider)` index already serves
  `WHERE stock_id = $1 ORDER BY observed_at DESC` via a backward index scan (verified with
  `EXPLAIN`), so an extra index would only add write and storage cost on the highest-volume table.
  Revisit with `EXPLAIN (ANALYZE, BUFFERS)` against realistic data once quote queries exist.
  Checked again with the Price Quotes queries on 600k rows: latest-quote and history-page queries
  are backward index scans on that unique index with no sort step (5 and 19 buffers). Ordering ties
  by `provider` rather than `id` is what keeps the sort inside the index.

## Testing

```sh
docker compose up -d --wait
cd backend && npm test
```

- **Unit tests** (`src/**/*.test.ts`) need no database.
- **HTTP tests** (`tests/*.test.ts`) run the Express app in-process with Supertest.
- **No test calls EODHD.** The EODHD adapter is tested with a stubbed `fetch`; the demo provider
  needs no network at all.
- **Database tests** (`tests/*.db.test.ts`) run against `TEST_DATABASE_URL`. Before the run, the
  test setup creates that database if missing and applies all migrations; each test starts from
  truncated tables. They are skipped when `TEST_DATABASE_URL` is unset. Because all database test
  files share one database, Jest runs test files one at a time (`maxWorkers: 1`).

Two safeguards keep tests away from the development database:

- The test setup refuses to run unless the test database name ends in `_test` and differs from
  `DATABASE_URL`.
- Before truncating, the test helper asks the server for `current_database()` and refuses unless it
  ends in `_test`. This still holds when Jest is started without the global setup (IDE runners,
  custom configs).

Credentials live only in `.env` files, which are git-ignored; only `.env.example` is committed. Its
values are the local Docker Compose defaults, not real credentials.
