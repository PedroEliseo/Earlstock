-- Up Migration

-- Human-readable stock names. The column is nullable: a name is only stored when the dataset
-- provides one, and no name is ever invented (an unknown name stays NULL). Historical prices are not
-- touched. When present, a name is 1-200 characters without surrounding whitespace or control
-- characters (the importer validates the same rules, with line numbers).
ALTER TABLE stocks
  ADD COLUMN name TEXT,
  ADD CONSTRAINT stocks_name_format CHECK (
    name IS NULL OR (
      char_length(name) BETWEEN 1 AND 200
      AND name = btrim(name)
      AND name !~ '[[:cntrl:]]'));

-- The importer may now set a stock's name, and nothing else on stocks: tickers and ids stay
-- immutable (no table-level UPDATE). Needed because stocks persist across imports
-- (INSERT ... ON CONFLICT DO UPDATE SET name = ...).
GRANT UPDATE (name) ON stocks TO market_data_writer;

-- Down Migration

-- Removes only what the up migration added; prices and every other column are untouched.
REVOKE UPDATE (name) ON stocks FROM market_data_writer;
ALTER TABLE stocks DROP COLUMN name;
