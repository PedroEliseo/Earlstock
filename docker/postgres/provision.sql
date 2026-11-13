-- EarlStock database provisioning. Run as the PostgreSQL superuser, via `npm run db:provision`.
--
-- Idempotent: creates or corrects the EarlStock roles and moves ownership of the database and of
-- every object in its public schema to the schema-owner role. Role names and passwords are read
-- from the same URLs the application and migrations use (single source of truth):
--   MIGRATION_DATABASE_URL    -> schema-owner role (runs migrations)
--   MARKET_DATA_DATABASE_URL  -> read-only API role, member of market_data_reader
-- Passwords are read from the environment with \getenv and substituted as quoted literals; they are
-- never printed, and statement logging is suppressed for this session.

\set ON_ERROR_STOP on
\set VERBOSITY terse
\set SHOW_CONTEXT never
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET client_min_messages = 'warning';

\getenv migration_url MIGRATION_DATABASE_URL
\getenv api_url MARKET_DATA_DATABASE_URL
\if :{?migration_url}
\else
  \set migration_url ''
\endif
\if :{?api_url}
\else
  \set api_url ''
\endif

-- Parse "postgres://user:password@host[:port]/database". Simple user names and URL-safe passwords
-- only: anything needing percent-encoding is rejected rather than decoded.
SELECT owner_parts[1] AS owner_role, owner_parts[2] AS owner_password, owner_parts[3] AS database_name,
       api_parts[1] AS api_role, api_parts[2] AS api_password,
       coalesce(error, '') AS config_error, error IS NOT NULL AS config_invalid
FROM (
  SELECT owner_parts, api_parts,
    CASE
      WHEN owner_parts IS NULL THEN 'MIGRATION_DATABASE_URL is missing or not of the form postgres://user:password@host[:port]/database'
      WHEN api_parts IS NULL THEN 'MARKET_DATA_DATABASE_URL is missing or not of the form postgres://user:password@host[:port]/database'
      WHEN owner_parts[1] !~ '^[a-z_][a-z0-9_]*$' OR api_parts[1] !~ '^[a-z_][a-z0-9_]*$'
        THEN 'role names must match [a-z_][a-z0-9_]*'
      WHEN owner_parts[2] !~ '^[A-Za-z0-9._~-]+$' OR api_parts[2] !~ '^[A-Za-z0-9._~-]+$'
        THEN 'passwords may only contain [A-Za-z0-9._~-] (no URL encoding)'
      WHEN owner_parts[1] = api_parts[1] THEN 'MIGRATION_DATABASE_URL and MARKET_DATA_DATABASE_URL must use different roles'
      WHEN owner_parts[3] <> api_parts[3] THEN 'MIGRATION_DATABASE_URL and MARKET_DATA_DATABASE_URL must name the same database'
      WHEN owner_parts[3] IN ('postgres', 'template0', 'template1') THEN 'refusing to provision a system database'
      WHEN owner_parts[1] = 'market_data_reader' OR api_parts[1] = 'market_data_reader' THEN 'market_data_reader is reserved for the read-only group role'
      WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (owner_parts[1], api_parts[1]) AND (rolsuper OR oid = 10))
        THEN 'refusing to manage a superuser or bootstrap role as an EarlStock role'
    END AS error
  FROM (
    SELECT regexp_match(:'migration_url', '^postgres(?:ql)?://([^:@/?#]+):([^@/?#]+)@[^/?#]+/([^/?#]+)$') AS owner_parts,
           regexp_match(:'api_url', '^postgres(?:ql)?://([^:@/?#]+):([^@/?#]+)@[^/?#]+/([^/?#]+)$') AS api_parts
  ) urls
) checked
\gset

\if :config_invalid
  \warn 'provisioning refused:' :config_error
  DO $$ BEGIN RAISE EXCEPTION 'invalid provisioning configuration (see message above)'; END $$;
\endif

-- Roles ------------------------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner_role') AS create_owner,
       NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_role') AS create_api,
       NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_data_reader') AS create_reader
\gset

\if :create_owner
  CREATE ROLE :"owner_role";
\endif
\if :create_api
  CREATE ROLE :"api_role";
\endif
\if :create_reader
  CREATE ROLE market_data_reader;
\endif

-- Attributes are (re)applied on every run, so a manually altered role is corrected.
ALTER ROLE :"owner_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE :"owner_role" WITH PASSWORD :'owner_password';
ALTER ROLE :"api_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE :"api_role" WITH PASSWORD :'api_password';
-- Defense in depth only: grants are what actually prevent writes.
ALTER ROLE :"api_role" SET default_transaction_read_only = on;
ALTER ROLE market_data_reader WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT market_data_reader TO :"api_role";

-- Database and object ownership ---------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database_name') AS create_database \gset
\if :create_database
  CREATE DATABASE :"database_name" OWNER :"owner_role";
\endif
ALTER DATABASE :"database_name" OWNER TO :"owner_role";

\connect :"database_name"
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET client_min_messages = 'warning';
SELECT set_config('earlstock.owner_role', :'owner_role', false) AS owner_role_setting \gset

-- Every object in schema public not owned by the owner role moves to it: tables, partitioned and
-- foreign tables, views, materialized views, free-standing sequences (sequences owned by a column
-- follow their table), types and domains (not tables' row types), and routines. Objects that belong
-- to an extension are left alone.
DO $$
DECLARE
  owner_role text := current_setting('earlstock.owner_role');
  item record;
BEGIN
  FOR item IN
    SELECT format('ALTER %s %s OWNER TO %I',
                  CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'TABLE' WHEN 'f' THEN 'FOREIGN TABLE'
                                 WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' END,
                  c.oid::regclass, owner_role) AS statement
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
      AND pg_get_userbyid(c.relowner) <> owner_role
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                        AND d.deptype IN ('a', 'i') AND d.refclassid = 'pg_class'::regclass)  -- column-owned sequences
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    UNION ALL
    SELECT format('ALTER %s %s OWNER TO %I', CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, t.oid::regtype, owner_role)
    FROM pg_type t
    WHERE t.typnamespace = 'public'::regnamespace
      AND t.typtype IN ('c', 'd', 'e', 'r')                     -- multiranges follow their range type
      AND t.typcategory <> 'A'                                  -- array types follow their element type
      AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')  -- not tables' row types
      AND pg_get_userbyid(t.typowner) <> owner_role
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
    UNION ALL
    SELECT format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, owner_role)
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND pg_get_userbyid(p.proowner) <> owner_role
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE item.statement;
  END LOOP;
END $$;

-- Verification: refuse to report success unless every relation (indexes and column-owned sequences
-- included), type (row and array types included) and routine in public is owned by the owner role.
SELECT count(*) AS unexpected_owners
FROM (
  SELECT c.relowner AS owner FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S', 'i', 'I', 'c')
  UNION ALL
  SELECT t.typowner FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace
  UNION ALL
  SELECT p.proowner FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
) objects
WHERE pg_get_userbyid(owner) <> current_setting('earlstock.owner_role')
\gset
SELECT :unexpected_owners > 0 AS ownership_incomplete \gset
\if :ownership_incomplete
  \warn 'provisioning failed:' :unexpected_owners 'object(s) in public are not owned by' :owner_role
  DO $$ BEGIN RAISE EXCEPTION 'ownership transfer incomplete'; END $$;
\endif

\echo 'provisioned database' :database_name ': owner role' :owner_role ', API role' :api_role '(member of market_data_reader)'
