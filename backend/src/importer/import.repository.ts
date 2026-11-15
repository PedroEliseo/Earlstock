import type { Client } from 'pg';
import { PRIVILEGED_ROLES } from '../modules/dataset/dataset.repository.js';
import { recordBatch, withImportSpan } from './telemetry.js';
import type { DatasetStats, PriceRow } from './validation.js';

/**
 * Every SQL statement the importer runs. All functions take the SAME `pg.Client` (one PostgreSQL
 * session, never a pool), so the session-level advisory lock, the import bookkeeping and the
 * replacement transaction are guaranteed to share one connection. Values are always bound
 * parameters; decimals and dates travel as text and are converted by PostgreSQL, never by
 * JavaScript.
 */

/**
 * Advisory-lock key reserved for the importer (an arbitrary constant). Advisory locks only
 * serialize sessions that ask for the same key: they exclude other importer runs, not other
 * writers. See README "Importing the dataset" for the full concurrency guarantee.
 */
export const IMPORT_LOCK_KEY = '4523911250173509';

/** Rows per INSERT statement. Each statement binds 9 parameters (8 column arrays + import id). */
export const INSERT_BATCH_SIZE = 10_000;

export interface ActiveDataset {
  importId: number;
  sha256: string;
  stats: DatasetStats;
}

/** Least-privilege expectations the importer role must meet, else the importer refuses to run. */
export type ImporterPrivilegeViolation =
  | 'superuser'
  | 'privileged_attributes'
  | 'owns_objects'
  | 'can_create_objects'
  | 'privileged_membership'
  | 'can_truncate_or_maintain'
  | 'can_update_prices_or_stocks'
  | 'can_rewrite_import_provenance'
  | 'can_delete_history'
  | 'access_outside_dataset_tables';

const PRIVILEGES_SQL = `
  WITH me AS (SELECT * FROM pg_roles WHERE rolname = current_user),
  dataset_tables(name) AS (VALUES ('stocks'), ('daily_prices'), ('data_imports'), ('dataset_snapshot'))
  SELECT
    me.rolsuper AS "superuser",
    (me.rolcreaterole OR me.rolcreatedb OR me.rolreplication OR me.rolbypassrls) AS "privileged_attributes",
    (EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = me.oid)
      OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'public' AND n.nspowner = me.oid)
      OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = me.oid))
      AS "owns_objects",
    (has_schema_privilege('public', 'CREATE') OR has_database_privilege(current_database(), 'CREATE'))
      AS "can_create_objects",
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = ANY ($1::text[]) AND pg_has_role(r.oid, 'MEMBER'))
      AS "privileged_membership",
    EXISTS (SELECT 1 FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
              AND has_table_privilege(c.oid, 'TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'))
      AS "can_truncate_or_maintain",
    (has_any_column_privilege('daily_prices', 'UPDATE')
      OR EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = 'stocks'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                   AND a.attname <> 'name' AND has_column_privilege('stocks', a.attnum, 'UPDATE')))
      AS "can_update_prices_or_stocks",
    (has_column_privilege('data_imports', 'id', 'UPDATE')
      OR has_column_privilege('data_imports', 'source_file', 'UPDATE')
      OR has_column_privilege('data_imports', 'source_sha256', 'UPDATE')
      OR has_column_privilege('data_imports', 'started_at', 'UPDATE')
      OR has_column_privilege('dataset_snapshot', 'singleton', 'UPDATE')
      OR has_column_privilege('dataset_snapshot', 'import_status', 'UPDATE'))
      AS "can_rewrite_import_provenance",
    (has_table_privilege('data_imports', 'DELETE') OR has_table_privilege('dataset_snapshot', 'DELETE'))
      AS "can_delete_history",
    EXISTS (SELECT 1 FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
              AND c.relname NOT IN (SELECT name FROM dataset_tables)
              AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(c.oid, 'USAGE, SELECT, UPDATE')
                       ELSE has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE')
                            OR has_table_privilege(c.oid, 'DELETE, TRUNCATE') END)
      AS "access_outside_dataset_tables"
  FROM me`;

/** Which least-privilege expectations the connected role violates (empty when it complies). */
export async function findImporterPrivilegeViolations(
  client: Client,
): Promise<ImporterPrivilegeViolation[]> {
  const { rows } = await client.query<Record<ImporterPrivilegeViolation, boolean>>(PRIVILEGES_SQL, [
    PRIVILEGED_ROLES,
  ]);
  const row = rows[0];
  if (!row) throw new Error('privilege check returned no row');
  return (Object.keys(row) as ImporterPrivilegeViolation[]).filter((name) => row[name]);
}

/** Non-blocking: true if this session now holds the importer lock, false if another session does. */
export async function tryAcquireImportLock(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1::bigint) AS locked',
    [IMPORT_LOCK_KEY],
  );
  return rows[0]?.locked === true;
}

export async function releaseImportLock(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ released: boolean }>(
    'SELECT pg_advisory_unlock($1::bigint) AS released',
    [IMPORT_LOCK_KEY],
  );
  return rows[0]?.released === true;
}

/**
 * Marks every 'running' import as failed. Only call while holding the importer lock: then no
 * importer is running, so a 'running' row can only be left over from a process that died.
 */
export async function failAbandonedImports(client: Client): Promise<number[]> {
  const { rows } = await client.query<{ id: number }>(
    `UPDATE data_imports
     SET status = 'failed', finished_at = greatest(clock_timestamp(), started_at),
         error_summary = 'abandoned: the importer stopped before finishing (found by a later run)'
     WHERE status = 'running'
     RETURNING id`,
  );
  return rows.map((row) => row.id).sort((a, b) => a - b);
}

const ACTIVE_DATASET_SQL = `
  SELECT s.import_id AS "importId", i.source_sha256 AS "sha256",
         p.stock_count AS "stockCount", p.price_count AS "priceCount", p.trading_dates AS "tradingDates",
         to_char(p.first_date, 'YYYY-MM-DD') AS "firstDate", to_char(p.last_date, 'YYYY-MM-DD') AS "lastDate"
  FROM dataset_snapshot s
  JOIN data_imports i ON i.id = s.import_id
  CROSS JOIN LATERAL (
    SELECT count(DISTINCT d.stock_id)::int AS stock_count, count(*)::int AS price_count,
           count(DISTINCT d.trade_date)::int AS trading_dates,
           min(d.trade_date) AS first_date, max(d.trade_date) AS last_date
    FROM daily_prices d WHERE d.import_id = s.import_id
  ) p`;

/** The dataset the API currently serves, measured from its stored rows; null if none is active. */
export async function findActiveDataset(client: Client): Promise<ActiveDataset | null> {
  const { rows } = await client.query<{
    importId: number;
    sha256: string;
    stockCount: number;
    priceCount: number;
    tradingDates: number;
    firstDate: string | null;
    lastDate: string | null;
  }>(ACTIVE_DATASET_SQL);
  const row = rows[0];
  if (!row) return null;
  return {
    importId: row.importId,
    sha256: row.sha256,
    stats: {
      stockCount: row.stockCount,
      priceCount: row.priceCount,
      tradingDates: row.tradingDates,
      firstDate: row.firstDate ?? '',
      lastDate: row.lastDate ?? '',
    },
  };
}

/** Records an attempt as 'running' (committed on its own, so every attempt leaves a record). */
export async function insertRunningImport(
  client: Client,
  source: { fileName: string; sha256: string },
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO data_imports (source_file, source_sha256, status) VALUES ($1, $2, 'running') RETURNING id`,
    [source.fileName, source.sha256],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('inserting the import record returned no id');
  return id;
}

/** Marks a running import as failed. Never touches the active snapshot. */
export async function markImportFailed(
  client: Client,
  importId: number,
  errorSummary: string,
  rowsRead: number | null,
): Promise<void> {
  await client.query(
    `UPDATE data_imports
     SET status = 'failed', finished_at = greatest(clock_timestamp(), started_at), error_summary = $2,
         rows_read = $3
     WHERE id = $1 AND status = 'running'`,
    [importId, errorSummary.slice(0, 2000) || 'unknown error', rowsRead],
  );
}

export class ConcurrentChangeError extends Error {
  override readonly name = 'ConcurrentChangeError';
}

export interface ReplacementHooks {
  /** Called inside the transaction after each INSERT batch (tests only). */
  afterBatch?: (insertedSoFar: number) => Promise<void>;
  /** Called inside the transaction just before COMMIT, after the pointer moved (tests only). */
  beforeCommit?: () => Promise<void>;
}

export interface Replacement {
  importId: number;
  /** The snapshot import id observed before validation (null: none was active). */
  expectedActiveImportId: number | null;
  rows: readonly PriceRow[];
  /** Each ticker's name from the file, or null when the file gives none. */
  names: ReadonlyMap<string, string | null>;
  rowsRead: number;
  stats: DatasetStats;
  batchSize?: number;
  hooks?: ReplacementHooks;
}

const INSERT_BATCH_SQL = `
  INSERT INTO daily_prices (stock_id, trade_date, open, high, low, close, adj_close, volume, import_id)
  SELECT s.id, u.trade_date, u.open, u.high, u.low, u.close, u.adj_close, u.volume, $9
  FROM unnest($1::text[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[],
              $7::numeric[], $8::bigint[])
       AS u(ticker, trade_date, open, high, low, close, adj_close, volume)
  JOIN stocks s ON s.ticker = u.ticker`;

/** Column arrays for one batch; every array has exactly `rows.length` elements. */
export function toColumnArrays(rows: readonly PriceRow[]): string[][] {
  const columns: string[][] = [[], [], [], [], [], [], [], []];
  for (const row of rows) {
    columns[0]?.push(row.ticker);
    columns[1]?.push(row.date);
    columns[2]?.push(row.open);
    columns[3]?.push(row.high);
    columns[4]?.push(row.low);
    columns[5]?.push(row.close);
    columns[6]?.push(row.adjClose);
    columns[7]?.push(row.volume);
  }
  if (columns.some((column) => column.length !== rows.length)) {
    throw new Error('column arrays do not all have one element per row');
  }
  return columns;
}

/**
 * Replaces the whole dataset and activates it, in ONE transaction: either everything below commits
 * together or nothing does. Readers (single statements, READ COMMITTED) see the previous dataset
 * until COMMIT and the new one after it. DELETE (not TRUNCATE) keeps readers unblocked: it takes a
 * ROW EXCLUSIVE table lock, which conflicts with no reader.
 */
export async function replaceDataset(client: Client, replacement: Replacement): Promise<void> {
  const { importId, rows, stats, hooks } = replacement;
  const batchSize = replacement.batchSize ?? INSERT_BATCH_SIZE;
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    // Fail fast instead of queueing behind (and in front of) an exclusive lock, e.g. a migration.
    await client.query(`SET LOCAL lock_timeout = '10s'`);
    await client.query(`SET LOCAL statement_timeout = '5min'`);

    // Lock the pointer row (if any) and confirm it is still the one the shrink check compared with.
    const pointer = await client.query<{ importId: number }>(
      'SELECT import_id AS "importId" FROM dataset_snapshot FOR UPDATE',
    );
    const currentActive = pointer.rows[0]?.importId ?? null;
    if (currentActive !== replacement.expectedActiveImportId) {
      throw new ConcurrentChangeError(
        'the active dataset changed after validation started; nothing was replaced',
      );
    }

    // Stocks are kept by ticker, so ids stay stable across imports; new tickers get new ids. A
    // name from the file is stored (or updates the stored one); a missing name (null) never erases
    // a stored name. Inside this transaction, so a failed import leaves names untouched too.
    // Spans below only group the statements (the pg instrumentation traces each one); they add no
    // query and no wait to the transaction.
    const tickers = [...new Set(rows.map((row) => row.ticker))].sort();
    await withImportSpan(
      'import.stocks.upsert',
      { 'earlstock.import.stocks': tickers.length },
      () =>
        client.query(
          `INSERT INTO stocks (ticker, name)
       SELECT t.ticker, t.name FROM unnest($1::text[], $2::text[]) AS t(ticker, name) ORDER BY t.ticker
       ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name
       WHERE EXCLUDED.name IS NOT NULL AND stocks.name IS DISTINCT FROM EXCLUDED.name`,
          [tickers, tickers.map((ticker) => replacement.names.get(ticker) ?? null)],
        ),
    );

    await withImportSpan('import.prices.delete', {}, () =>
      client.query('DELETE FROM daily_prices'),
    );

    await withImportSpan(
      'import.prices.insert',
      { 'earlstock.import.rows': rows.length, 'earlstock.import.batch_size': batchSize },
      async (span) => {
        let inserted = 0;
        let batches = 0;
        for (let start = 0; start < rows.length; start += batchSize) {
          const batch = rows.slice(start, start + batchSize);
          const batchStarted = performance.now();
          const result = await client.query(INSERT_BATCH_SQL, [...toColumnArrays(batch), importId]);
          recordBatch((performance.now() - batchStarted) / 1000);
          if (result.rowCount !== batch.length) {
            throw new Error(
              `batch starting at row ${String(start)} inserted ${String(result.rowCount)} of ${String(batch.length)} rows`,
            );
          }
          inserted += batch.length;
          batches += 1;
          span.setAttribute('earlstock.import.batches', batches);
          await hooks?.afterBatch?.(inserted);
        }
      },
    );

    await withImportSpan('import.stocks.prune', {}, () =>
      client.query(
        'DELETE FROM stocks s WHERE NOT EXISTS (SELECT 1 FROM daily_prices d WHERE d.stock_id = s.id)',
      ),
    );

    // The table must now hold exactly the validated dataset and nothing else.
    await withImportSpan('import.verify', {}, async () => {
      const { rows: counts } = await client.query<{
        total: number;
        imported: number;
        stocks: number;
      }>(
        `SELECT (SELECT count(*)::int FROM daily_prices) AS total,
                (SELECT count(*)::int FROM daily_prices WHERE import_id = $1) AS imported,
                (SELECT count(*)::int FROM stocks) AS stocks`,
        [importId],
      );
      const count = counts[0];
      if (
        count?.total !== stats.priceCount ||
        count.imported !== stats.priceCount ||
        count.stocks !== stats.stockCount
      ) {
        throw new Error('row counts after the replacement do not match the validated dataset');
      }
    });

    await withImportSpan('import.snapshot.activate', {}, async () => {
      const succeeded = await client.query(
        `UPDATE data_imports
         SET status = 'succeeded', finished_at = greatest(clock_timestamp(), started_at),
             rows_read = $2, stock_count = $3, price_count = $4
         WHERE id = $1 AND status = 'running'`,
        [importId, replacement.rowsRead, stats.stockCount, stats.priceCount],
      );
      if (succeeded.rowCount !== 1) throw new Error('the import record is no longer running');

      // The pointer moves last; its foreign key only accepts a succeeded import.
      await client.query(
        `INSERT INTO dataset_snapshot (import_id) VALUES ($1)
         ON CONFLICT (singleton) DO UPDATE SET import_id = EXCLUDED.import_id, activated_at = clock_timestamp()`,
        [importId],
      );
    });

    await hooks?.beforeCommit?.();
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is unusable; PostgreSQL rolls the transaction back when the session ends.
    }
    throw err;
  }
}
