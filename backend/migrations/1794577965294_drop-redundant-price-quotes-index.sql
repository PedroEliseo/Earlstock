-- Up Migration

-- The UNIQUE (stock_id, observed_at, provider) constraint already maintains a B-tree whose leading
-- columns are (stock_id, observed_at). PostgreSQL can scan it backwards to serve
--   WHERE stock_id = $1 ORDER BY observed_at DESC
-- so this extra index only added write overhead and storage on the highest-volume table.
-- Revisit with EXPLAIN (ANALYZE, BUFFERS) on real data before re-adding it.
DROP INDEX price_quotes_stock_id_observed_at_idx;

-- Down Migration

CREATE INDEX price_quotes_stock_id_observed_at_idx ON price_quotes (stock_id, observed_at DESC);
