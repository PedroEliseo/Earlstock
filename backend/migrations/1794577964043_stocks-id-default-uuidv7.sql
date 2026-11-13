-- Up Migration

-- Let PostgreSQL generate time-ordered UUIDv7 identifiers (native since PostgreSQL 18), so the
-- application no longer needs to generate them. Changing a column default is a metadata-only
-- change: existing rows are untouched and no table rewrite happens.
ALTER TABLE stocks ALTER COLUMN id SET DEFAULT uuidv7();

-- Down Migration

ALTER TABLE stocks ALTER COLUMN id DROP DEFAULT;
