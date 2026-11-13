-- Up Migration

-- Historical data model: one stock entity (stocks, reshaped), daily prices, and the imports that
-- load them. Destructive for stocks (drops name, exchange, currency), so it refuses to run while
-- stocks has rows: back up (pg_dump) and empty it explicitly first.
--
-- The lock is taken BEFORE the emptiness check and held until this transaction ends, so no
-- concurrent insert can land in between. lock_timeout makes the migration fail fast instead of
-- queueing behind a long transaction (a waiting ACCESS EXCLUSIVE request blocks later readers).
SET LOCAL lock_timeout = '10s';
LOCK TABLE stocks IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM stocks) THEN
    RAISE EXCEPTION 'stocks is not empty: this migration drops its name, exchange and currency columns. Back it up (pg_dump) and empty it before running this migration';
  END IF;
END $$;

-- stocks keeps its id column and uuidv7() default untouched; only identity columns change.
ALTER TABLE stocks DROP CONSTRAINT stocks_exchange_symbol_key;
ALTER TABLE stocks DROP COLUMN name, DROP COLUMN exchange, DROP COLUMN currency;
ALTER TABLE stocks RENAME COLUMN symbol TO ticker;
-- Tickers are identifiers: byte-wise "C" collation gives a stable, locale-independent order.
ALTER TABLE stocks ALTER COLUMN ticker TYPE VARCHAR(32) COLLATE "C";
ALTER TABLE stocks
  ADD CONSTRAINT stocks_ticker_key UNIQUE (ticker),
  -- Canonical upper-case ticker: alphanumeric segments joined by ".", "-" or "=", optionally
  -- prefixed with "^" (index symbols). Covers forms such as BRK.B, BRK-B, BTC-USD, EURUSD=X, ^GSPC.
  -- Excludes lower case (no case-only duplicates), whitespace and "/" (tickers appear in URL paths).
  ADD CONSTRAINT stocks_ticker_format CHECK (ticker ~ '^\^?[A-Z0-9]+([.=-][A-Z0-9]+)*$');

CREATE TABLE data_imports (
  id            INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_file   VARCHAR(255) NOT NULL,   -- file name only, never a path
  source_sha256 CHAR(64)     NOT NULL,
  status        VARCHAR(16)  NOT NULL,
  started_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,             -- NULL while the import is running
  rows_read     INTEGER,
  stock_count   INTEGER,
  price_count   INTEGER,
  error_summary TEXT,
  CONSTRAINT data_imports_status            CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT data_imports_sha256_format     CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT data_imports_source_file       CHECK (source_file <> '' AND source_file !~ '[/\\]'),
  CONSTRAINT data_imports_finished_iff_done CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT data_imports_finished_after_start CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT data_imports_error_iff_failed  CHECK ((status = 'failed') = (error_summary IS NOT NULL)),
  -- A CHECK passes when its expression is NULL (NULL > 0 is NULL, not false), so IS NOT NULL must be
  -- explicit. status is NOT NULL, so the first branch is never NULL.
  CONSTRAINT data_imports_succeeded_has_stats CHECK (
    status <> 'succeeded' OR (
          rows_read   IS NOT NULL AND rows_read   > 0
      AND stock_count IS NOT NULL AND stock_count > 0
      AND price_count IS NOT NULL AND price_count > 0
      AND stock_count <= price_count
      AND price_count <= rows_read))
);

CREATE TABLE daily_prices (
  stock_id   UUID          NOT NULL REFERENCES stocks (id),
  trade_date DATE          NOT NULL,
  -- Price columns hold the dataset's values exactly as provided; their adjustment methodology
  -- depends on the data source and is not asserted here.
  open       NUMERIC(18,6) NOT NULL,
  high       NUMERIC(18,6) NOT NULL,
  low        NUMERIC(18,6) NOT NULL,
  close      NUMERIC(18,6) NOT NULL,
  adj_close  NUMERIC(18,6) NOT NULL,
  volume     BIGINT        NOT NULL,
  import_id  INTEGER       NOT NULL REFERENCES data_imports (id),
  CONSTRAINT daily_prices_pkey     PRIMARY KEY (stock_id, trade_date),
  CONSTRAINT daily_prices_ohlc     CHECK (low <= open AND low <= close AND high >= open AND high >= close),
  -- low > 0 plus the OHLC ordering makes open, high and close positive too.
  CONSTRAINT daily_prices_positive CHECK (low > 0 AND adj_close > 0),
  -- Upper bound is 2^53 - 1, the largest integer every JSON/JavaScript consumer represents exactly.
  CONSTRAINT daily_prices_volume   CHECK (volume BETWEEN 0 AND 9007199254740991)
);

-- Down Migration

-- Refuses to destroy data: stocks, daily_prices and data_imports must all be empty, because their
-- contents cannot be represented in the previous schema. Back up and empty them explicitly first.
SET LOCAL lock_timeout = '10s';
LOCK TABLE stocks, daily_prices, data_imports IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM daily_prices) OR EXISTS (SELECT 1 FROM data_imports) OR EXISTS (SELECT 1 FROM stocks) THEN
    RAISE EXCEPTION 'refusing to revert: stocks, daily_prices and data_imports must be empty (their data cannot be represented in the previous schema). Back them up (pg_dump) and empty them first';
  END IF;
END $$;

DROP TABLE daily_prices;
DROP TABLE data_imports;

-- stocks is proven empty, so it is recreated exactly as it was before this migration (re-adding the
-- dropped columns with ALTER would place them after created_at).
DROP TABLE stocks;
CREATE TABLE stocks (
  id         UUID         PRIMARY KEY DEFAULT uuidv7(),
  symbol     VARCHAR(16)  NOT NULL,
  name       VARCHAR(255) NOT NULL,
  exchange   VARCHAR(32)  NOT NULL,
  currency   CHAR(3)      NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT stocks_exchange_symbol_key UNIQUE (exchange, symbol)
);
