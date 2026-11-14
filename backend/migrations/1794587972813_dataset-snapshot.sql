-- Up Migration

-- The active dataset snapshot: an explicit pointer to the import whose data the API serves.
--
-- Storage model: daily_prices has PRIMARY KEY (stock_id, trade_date), so only ONE version of each
-- stock/date can exist at a time. The importer (later phase) therefore replaces the dataset in a
-- single transaction: insert a 'running' data_imports row, replace the daily_prices (and stocks)
-- rows, mark the import 'succeeded', point dataset_snapshot at it, and commit. Readers keep seeing
-- the previous committed dataset until that commit (MVCC), then see the new one; never a mixture.
--
-- Integrity enforced here, not by convention:
--  * at most one row (singleton primary key);
--  * the pointer can only reference a SUCCEEDED import: the composite foreign key targets
--    data_imports (id, status) with import_status fixed to 'succeeded';
--  * the active import's status cannot change and it cannot be deleted while it is active
--    (the same foreign key, NO ACTION);
--  * no row means no active dataset (the API answers 503 DATASET_NOT_LOADED).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_data_reader') THEN
    RAISE EXCEPTION 'role market_data_reader does not exist: run database provisioning first (npm run db:provision)';
  END IF;
END $$;

ALTER TABLE data_imports ADD CONSTRAINT data_imports_id_status_key UNIQUE (id, status);

CREATE TABLE dataset_snapshot (
  singleton     BOOLEAN     NOT NULL DEFAULT true,
  import_id     INTEGER     NOT NULL,
  import_status VARCHAR(16) NOT NULL DEFAULT 'succeeded',
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dataset_snapshot_pkey PRIMARY KEY (singleton),
  CONSTRAINT dataset_snapshot_singleton CHECK (singleton),
  CONSTRAINT dataset_snapshot_import_succeeded CHECK (import_status = 'succeeded'),
  CONSTRAINT dataset_snapshot_import_fkey FOREIGN KEY (import_id, import_status)
    REFERENCES data_imports (id, status)
);

GRANT SELECT ON dataset_snapshot TO market_data_reader;

-- Down Migration

-- Refuses while a snapshot is active: dropping the pointer would silently deactivate the dataset.
SET LOCAL lock_timeout = '10s';
LOCK TABLE dataset_snapshot, data_imports IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dataset_snapshot) THEN
    RAISE EXCEPTION 'refusing to revert: dataset_snapshot has an active snapshot. Back up and empty it first';
  END IF;
END $$;

DROP TABLE dataset_snapshot;
ALTER TABLE data_imports DROP CONSTRAINT data_imports_id_status_key;
