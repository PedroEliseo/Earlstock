-- Up Migration

-- Write access for the dataset importer, granted to the market_data_writer group role (the
-- earlstock_importer login and its password are created by provisioning, never by migrations).
--
-- Least privilege, derived from the statements the importer actually runs:
--  * stocks, daily_prices: SELECT, INSERT, DELETE. Rows are replaced, never updated: no UPDATE.
--    New tickers use INSERT ... ON CONFLICT DO NOTHING, which needs no UPDATE.
--  * data_imports: SELECT, INSERT, and UPDATE limited to the status/result columns. The provenance
--    columns (id, source_file, source_sha256, started_at) cannot be rewritten. No DELETE.
--    The id is an identity column: inserting needs no privilege on its sequence.
--  * dataset_snapshot: SELECT (and SELECT ... FOR UPDATE), INSERT for the first activation, UPDATE of
--    import_id and activated_at only. No DELETE: deactivating a dataset is an administrator's job.
--  * No TRUNCATE: it takes an ACCESS EXCLUSIVE lock, which would block every API read for the whole
--    import. No MAINTAIN, REFERENCES or TRIGGER, no sequences, no pgmigrations, no schema CREATE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_data_writer') THEN
    RAISE EXCEPTION 'role market_data_writer does not exist: run database provisioning first (npm run db:provision)';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO market_data_writer', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO market_data_writer;
GRANT SELECT, INSERT, DELETE ON stocks, daily_prices TO market_data_writer;
GRANT SELECT, INSERT ON data_imports TO market_data_writer;
GRANT UPDATE (status, finished_at, rows_read, stock_count, price_count, error_summary)
  ON data_imports TO market_data_writer;
GRANT SELECT, INSERT ON dataset_snapshot TO market_data_writer;
GRANT UPDATE (import_id, activated_at) ON dataset_snapshot TO market_data_writer;

-- Down Migration

-- Table-level REVOKE also removes the column-level UPDATE grants.
REVOKE ALL ON stocks, daily_prices, data_imports, dataset_snapshot FROM market_data_writer;
REVOKE USAGE ON SCHEMA public FROM market_data_writer;

DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM market_data_writer', current_database());
END $$;
