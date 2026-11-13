# EarlStock – Historical Stock Market Explorer

EarlStock lets users explore historical daily stock market data: browse stocks, chart price
movements over a chosen date range, compare stocks and calculate historical performance metrics.

Historical data is loaded once from a CSV dataset into PostgreSQL, which is the application's
source of truth at runtime. The API only ever reads PostgreSQL; it never reads the CSV, and there
are no live prices or external market data integrations.

This repository currently contains the backend API (`backend/`); the React frontend will follow.

> **Status:** the project is being restructured into the historical explorer in small phases. The
> API is read-only; the stock endpoints documented below are transitional and will be replaced by
> explorer endpoints (stocks, price history, comparison and metrics) addressed by ticker.

## Getting started

Requirements: Node.js 22.12+, Docker.

```sh
docker compose up -d --wait        # PostgreSQL 18 on localhost:5432
cd backend
cp .env.example .env               # only if you do not have a .env yet
npm install
npm run migrate:up                 # apply migrations to the development database
npm run dev                        # http://localhost:3000
```

## Dataset

The historical dataset is a CSV file kept under `data/` at the repository root. It is **not
committed** (git-ignored) until its source and redistribution licence have been verified, so it
must be placed there manually. Loading it into PostgreSQL will be done by a dedicated import
command; until that exists, the database contains no historical prices.

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
is invalid. Variables the application does not define are ignored. See `backend/.env.example`.

| Variable            | Required | Default       | Description                                                       |
| ------------------- | -------- | ------------- | ----------------------------------------------------------------- |
| `NODE_ENV`          | no       | `development` | `development`, `test` or `production`                             |
| `PORT`              | no       | `3000`        | HTTP port                                                         |
| `DATABASE_URL`      | yes      | —             | `postgres://user:password@host:port/database`                     |
| `DATABASE_POOL_MAX` | no       | `10`          | Maximum pooled connections (1–100)                                |
| `TEST_DATABASE_URL` | no       | —             | Test database, **dropped and recreated on every test run**; see [Testing](#testing) |

Credentials live only in `.env` files, which are git-ignored; only `.env.example` is committed. Its
values are local Docker Compose defaults for a database bound to localhost, not real credentials.

## API

All responses are JSON. Successful responses wrap the payload in `data`; errors always use the same
shape:

```json
{ "error": { "message": "Request validation failed", "details": [{ "path": "id", "message": "Invalid UUID" }] } }
```

`details` is present only for validation errors (HTTP 400).

### Health

| Method | Path            | Description                                                                 |
| ------ | --------------- | --------------------------------------------------------------------------- |
| GET    | `/health`       | Liveness. `200` while the process is serving HTTP; never checks the database. |
| GET    | `/health/ready` | Readiness. `200 {"status":"ok"}` or `503 {"status":"unavailable"}` depending on database reachability. |

### Stocks (transitional)

Read-only: stock data is written exclusively by the data importer, so there are no create, update
or delete endpoints. A stock:

```json
{
  "id": "01a1d532-0c63-78b9-a7df-5ada06ef20de",
  "ticker": "BRK.B",
  "createdAt": "<ISO 8601 timestamp>"
}
```

#### `GET /api/stocks`

Lists stocks ordered by `ticker` (byte-wise, independent of locale).

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

## Database

PostgreSQL 18, accessed with `pg` (no ORM). The schema is managed with plain SQL migrations in
`backend/migrations/` (node-pg-migrate). **Never edit a migration that has been applied anywhere**;
add a new one instead. Migrations that destroy data refuse to run while the affected tables
contain rows: take a backup (`pg_dump`) and empty them explicitly first.

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
- **Foreign keys** from `daily_prices` to `stocks` and `data_imports` do not cascade: deleting a stock
  or an import that still has prices fails.
- A **succeeded** import must record `rows_read`, `stock_count` and `price_count` as non-NULL and
  greater than zero (checked explicitly, because a SQL `CHECK` accepts NULL), with
  `stock_count ≤ price_count ≤ rows_read`. A **running** import has no `finished_at`; a **failed** one
  must have an `error_summary`.

### Numeric values in Node.js

node-postgres returns `NUMERIC` and `BIGINT` as strings, and the code keeps it that way: prices are
never converted to JavaScript numbers on the server, and `volume` stays a string in the persistence
and domain layers. If an API response needs `volume` as a JSON number, it is converted at that
boundary with an explicit safe-integer check. Dates are read as `to_char(trade_date, 'YYYY-MM-DD')`,
because the default parser turns a `DATE` into a `Date` at local midnight. No global type parsers
are installed.

Note that `NUMERIC(18,6)` silently **rounds** values with more than 6 decimals, so the importer must
reject them before inserting.

### History

- `stocks.id` defaults to `uuidv7()` (native in PostgreSQL 18): time-ordered IDs keep primary-key
  inserts append-mostly in the B-tree.
- Live quote ingestion was removed (migration `remove-live-ingestion`, which drops `price_quotes`
  and `provider_api_usage`). The previous implementation remains available in the repository's
  baseline commit.
- `historical-daily-prices` reshaped `stocks` (dropping `name`, `exchange` and `currency`, which the
  historical dataset does not provide) and created `daily_prices` and `data_imports`. It refuses to
  run while `stocks` has rows, and its rollback refuses to run while any of the three tables has rows.

## Testing

```sh
docker compose up -d --wait
cd backend && npm test
```

- **Unit tests** (`src/**/*.test.ts`, `tests/setup/*.test.ts`) need no database.
- **HTTP tests** (`tests/*.test.ts`) run the Express app in-process with Supertest.
- **Database tests** (`tests/*.db.test.ts`) run against `TEST_DATABASE_URL`. Before each run, the
  test setup **drops and recreates** that database and applies every migration, so each run starts
  empty and exercises the full migration chain; each test then starts from truncated tables. They
  are skipped when `TEST_DATABASE_URL` is unset. Because all database test files share one
  database, Jest runs test files one at a time (`maxWorkers: 1`).
- **Schema tests** (`tests/schema.db.test.ts`) check every constraint with direct SQL.
- **Migration tests** (`tests/migrations.db.test.ts`) use a second disposable database, named after
  the test database with `_migrations` inserted (e.g. `earlstock_migrations_test`). It passes the
  same safeguards, and its name must also differ from the test database's. The tests run every
  migration up and down, check that rollbacks restore exact table definitions, and check that
  destructive migrations refuse to run on data.

Safeguards keep tests away from any other database. They fail closed: anything ambiguous is refused.

- The test database name must end in `_test`.
- `TEST_DATABASE_URL` and `DATABASE_URL` are parsed (host, port and database name, independently of
  credentials). The same database name is refused even on a different host or port, because host
  aliases and port forwarding can reach the same server. URLs without an explicit host, or with
  query parameters that could redirect the connection, are refused.
- The database is dropped through a separate maintenance connection (to `postgres`), after asking
  the server which database that connection is on.
- Before truncating, the test helper asks the server for `current_database()` and refuses unless it
  ends in `_test`. This still holds when Jest is started without the global setup (IDE runners,
  custom configs).
