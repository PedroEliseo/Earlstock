-- Up Migration

-- Removes the live market-data ingestion tables. Destructive, so it refuses to run on data:
-- back up (pg_dump) and empty both tables explicitly first.
--
-- ACCESS EXCLUSIVE locks are taken BEFORE the emptiness checks and held until this migration's
-- transaction ends, so no concurrent insert can land between the check and the DROP.
LOCK TABLE price_quotes, provider_api_usage IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM price_quotes) THEN
    RAISE EXCEPTION 'price_quotes is not empty; back it up (pg_dump) and empty it before running this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM provider_api_usage) THEN
    RAISE EXCEPTION 'provider_api_usage is not empty; back it up (pg_dump) and empty it before running this migration';
  END IF;
END $$;

-- No CASCADE: if anything unexpected depends on these tables, fail instead of dropping it too.
DROP TABLE provider_api_usage;
DROP TABLE price_quotes;

-- Down Migration

-- Recreates both tables EMPTY, exactly as they were before this migration. Their data can only be
-- restored from a backup, e.g. pg_restore --data-only -t price_quotes -t provider_api_usage.
CREATE TABLE price_quotes (
  id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stock_id    UUID          NOT NULL REFERENCES stocks (id),
  price       NUMERIC(20,8) NOT NULL,
  volume      NUMERIC(24,8),
  observed_at TIMESTAMPTZ   NOT NULL,
  provider    VARCHAR(32)   NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT price_quotes_stock_observed_provider_key UNIQUE (stock_id, observed_at, provider)
);

CREATE TABLE provider_api_usage (
  provider   VARCHAR(32) NOT NULL,
  usage_date DATE        NOT NULL,
  calls_used INTEGER     NOT NULL CHECK (calls_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, usage_date)
);
