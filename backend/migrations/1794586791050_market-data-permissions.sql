-- Up Migration

-- Read-only access for the API, granted to the market_data_reader group role. Login roles (such as
-- the API's) and their passwords are environment-specific and created by provisioning, never by
-- migrations; this migration only grants to the group, so it contains no credentials.
-- Grants are explicit per table (no default privileges): a new table is not readable by the API
-- until a migration grants it. pgmigrations and all sequences are deliberately not granted.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_data_reader') THEN
    RAISE EXCEPTION 'role market_data_reader does not exist: run database provisioning first (npm run db:provision)';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO market_data_reader', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO market_data_reader;
GRANT SELECT ON stocks, daily_prices, data_imports TO market_data_reader;

-- Down Migration

REVOKE SELECT ON stocks, daily_prices, data_imports FROM market_data_reader;
REVOKE USAGE ON SCHEMA public FROM market_data_reader;

DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM market_data_reader', current_database());
END $$;
