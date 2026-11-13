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
cd backend
cp .env.example .env               # only if you do not have a .env yet
# Create backend/.env.local with the two role URLs (see "Database roles"), with generated passwords.
npm install
npm run db:setup                   # start PostgreSQL, provision roles, apply migrations
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
is invalid. Variables the application does not define are ignored. Every npm script loads
`backend/.env` and then `backend/.env.local` (both git-ignored). See `backend/.env.example`.

| Variable                   | Used by                     | Description                                                     |
| -------------------------- | --------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`                 | backend                     | `development`, `test` or `production` (default `development`)   |
| `PORT`                     | backend                     | HTTP port (default `3000`)                                      |
| `MARKET_DATA_DATABASE_URL` | **backend** (required), provisioning, tests | Read-only API role. The backend has no fallback to any other URL. |
| `DATABASE_POOL_MAX`        | backend                     | Maximum pooled connections, 1–100 (default `10`)                |
| `MIGRATION_DATABASE_URL`   | migrations, provisioning, tests | Schema-owner role                                           |
| `DATABASE_URL`             | safety checks only          | Administrative (superuser) connection to the development database; not used to connect |
| `TEST_DATABASE_URL`        | test setup                  | Administrative connection to the test database, used only to drop and recreate it; see [Testing](#testing) |

Credentials live only in git-ignored `.env` files; only `.env.example` is committed. The superuser
values in it are local Docker Compose defaults for a database bound to localhost. The EarlStock role
passwords are generated per developer and kept only in `backend/.env.local`.

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

### Database roles

The application runs with least privilege; the superuser is never used by the backend or by
migrations.

| Role                 | Kind             | Can do                                                                  | Used by |
| -------------------- | ---------------- | ----------------------------------------------------------------------- | ------- |
| `earlstock_owner`    | login            | Owns the database and every object in it; runs DDL. Not superuser; cannot create roles or databases. | migrations (`MIGRATION_DATABASE_URL`) |
| `market_data_reader` | group (no login) | `CONNECT`, `USAGE` on schema `public`, `SELECT` on `stocks`, `daily_prices`, `data_imports` (granted by a migration) | — |
| `earlstock_api`      | login            | Member of `market_data_reader` only; sessions start read-only. Owns nothing; cannot write, change the schema, read migration history or use sequences. | backend (`MARKET_DATA_DATABASE_URL`) |
| superuser (`POSTGRES_USER`) | login     | Everything                                                              | only provisioning and creating/dropping test databases |

- **Grants are explicit** per table, in migrations; there are no default privileges, so a new table
  is not readable by the API until a migration grants it.
- **Read-only is enforced by grants.** `default_transaction_read_only` is only an extra layer: the
  tests show writes still fail when a session switches it off.
- PostgreSQL's defaults for `PUBLIC` (`CONNECT`, `TEMP`) are left in place: the API role can create
  session-local temporary tables, but cannot read or change anything else.

**Provisioning** (`npm run db:provision`, run as the superuser by a one-shot Compose service)
creates or corrects the roles from `MIGRATION_DATABASE_URL` and `MARKET_DATA_DATABASE_URL` in
`backend/.env.local`, the same file the backend and migrations use, so passwords have a single
source. It reads them with psql's `\getenv` (never as command-line arguments), never prints them, and
transfers ownership of the database and of every object in schema `public` (tables, views,
materialized views, sequences, types, routines) to the owner role, then verifies that nothing else
owns anything. It is idempotent and refuses invalid configurations (missing or malformed URLs, the
same role for both, a superuser or system database, passwords needing URL encoding).

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
cd backend && npm run db:setup && npm test
```

- **Unit tests** (`src/**/*.test.ts`, `tests/setup/*.test.ts`) need no database.
- **HTTP tests** (`tests/*.test.ts`) run the Express app in-process with Supertest.
- **Database tests** (`tests/*.db.test.ts`) run against the test database. Before each run, the
  test setup **drops and recreates** it (owned by the owner role) and applies every migration as
  the owner role, so each run starts empty and exercises the full migration chain; each test then
  starts from truncated tables. **The application under test connects as the read-only API role**,
  exactly as in production; fixtures are written as the owner role. Test connections reuse the
  role credentials from `MIGRATION_DATABASE_URL` and `MARKET_DATA_DATABASE_URL`, retargeted at the
  test database, so no credentials are configured twice. They
  are skipped when `TEST_DATABASE_URL` is unset. Because all database test files share one
  database, Jest runs test files one at a time (`maxWorkers: 1`).
- **Schema tests** (`tests/schema.db.test.ts`) check every constraint with direct SQL.
- **Permission tests** (`tests/permissions.db.test.ts`) run statements as each role and check
  PostgreSQL's actual answers: the API role can read the three data tables and run the application,
  and cannot write (even with read-only switched off), change the schema, read migration history,
  use sequences, perform administrative operations or assume other roles.
- **Migration tests** (`tests/migrations.db.test.ts`) use a second disposable database, named after
  the test database with `_migrations` inserted (e.g. `earlstock_migrations_test`). It passes the
  same safeguards, and its name must also differ from the test database's. The tests run every
  migration up and down, check that rollbacks restore exact table definitions, and check that
  destructive migrations refuse to run on data.

Safeguards keep tests away from any other database. They fail closed: anything ambiguous is refused.

- The test database name must end in `_test`.
- The superuser connection (`TEST_DATABASE_URL`) is used only to drop and create test databases.
  If it is set, the role URLs are required too: tests never fall back to the superuser.
- `TEST_DATABASE_URL` is compared with `DATABASE_URL`, `MIGRATION_DATABASE_URL` and
  `MARKET_DATA_DATABASE_URL` after parsing (host, port and database name, independently of
  credentials); the API role must differ from the owner and administrative roles. The same database name is refused even on a different host or port, because host
  aliases and port forwarding can reach the same server. URLs without an explicit host, or with
  query parameters that could redirect the connection, are refused.
- The database is dropped through a separate maintenance connection (to `postgres`), after asking
  the server which database that connection is on.
- Before truncating, the test helper asks the server for `current_database()` and refuses unless it
  ends in `_test`. This still holds when Jest is started without the global setup (IDE runners,
  custom configs).
