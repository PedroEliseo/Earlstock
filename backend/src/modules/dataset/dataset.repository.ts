import type { Database } from '../../db/database.js';
import type { TimestampString } from '../../shared/types.js';

/** The dataset the API currently serves: the import pointed to by dataset_snapshot. */
export interface ActiveSnapshot {
  importId: number;
  /** When the snapshot was activated (ISO 8601 UTC). */
  activatedAt: TimestampString;
}

export interface DatasetStatus {
  /** Null when no snapshot is active (nothing imported and activated yet). */
  snapshot: ActiveSnapshot | null;
}

/** Which least-privilege expectations the connected role violates (empty when it complies). */
export type PrivilegeViolation =
  | 'superuser'
  | 'privileged_attributes'
  | 'owns_objects'
  | 'can_create_objects'
  | 'can_write_data'
  | 'privileged_membership';

/** Built-in roles the API (and importer) roles must not belong to, directly or through inheritance. */
export const PRIVILEGED_ROLES = [
  'pg_database_owner',
  'pg_read_all_data',
  'pg_write_all_data',
  'pg_read_all_settings',
  'pg_read_all_stats',
  'pg_monitor',
  'pg_read_server_files',
  'pg_write_server_files',
  'pg_execute_server_program',
  'pg_signal_backend',
  'pg_checkpoint',
  'pg_maintain',
  'pg_create_subscription',
  'pg_use_reserved_connections',
];

/** TIMESTAMPTZ formatted in SQL as ISO 8601 UTC: independent of the session's TimeZone and DateStyle. */
export const ISO_UTC = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// One row always (sentinel), with NULLs when no snapshot is active.
const STATUS_SQL = `
  SELECT s.import_id AS "importId", ${ISO_UTC('s.activated_at')} AS "activatedAt"
  FROM (SELECT 1) AS sentinel
  LEFT JOIN dataset_snapshot s ON true`;

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Maps the snapshot columns of a sentinel row. Both NULL means "no active snapshot"; anything else
 * that is not a valid pair is a fault (never silently treated as "not loaded").
 */
export function toActiveSnapshot(
  row: { importId: unknown; activatedAt: unknown } | undefined,
): ActiveSnapshot | null {
  if (!row) throw new Error('snapshot query returned no row');
  if (row.importId === null && row.activatedAt === null) return null;
  if (
    typeof row.importId !== 'number' ||
    typeof row.activatedAt !== 'string' ||
    !ISO_UTC_PATTERN.test(row.activatedAt)
  ) {
    throw new Error('unexpected database value for the active snapshot');
  }
  return { importId: row.importId, activatedAt: row.activatedAt };
}

// Evaluated for current_user, i.e. the role this connection actually authenticated as.
const PRIVILEGES_SQL = `
  WITH me AS (SELECT * FROM pg_roles WHERE rolname = current_user)
  SELECT
    me.rolsuper AS "superuser",
    (me.rolcreaterole OR me.rolcreatedb OR me.rolreplication OR me.rolbypassrls) AS "privilegedAttributes",
    (EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = me.oid)
      OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'public' AND n.nspowner = me.oid)
      OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = me.oid))
      AS "ownsObjects",
    (has_schema_privilege('public', 'CREATE') OR has_database_privilege(current_database(), 'CREATE'))
      AS "canCreateObjects",
    EXISTS (SELECT 1 FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
              AND has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')) AS "canWriteData",
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = ANY ($1::text[]) AND pg_has_role(r.oid, 'MEMBER'))
      AS "privilegedMembership"
  FROM me`;

interface PrivilegesRow {
  superuser: boolean;
  privilegedAttributes: boolean;
  ownsObjects: boolean;
  canCreateObjects: boolean;
  canWriteData: boolean;
  privilegedMembership: boolean;
}

export function createDatasetRepository(db: Database) {
  return {
    async getStatus(): Promise<DatasetStatus> {
      const [row] = await db.query<{ importId: unknown; activatedAt: unknown }>(
        'dataset.status',
        STATUS_SQL,
      );
      return { snapshot: toActiveSnapshot(row) };
    },

    async findPrivilegeViolations(): Promise<PrivilegeViolation[]> {
      const [row] = await db.query<PrivilegesRow>('dataset.privileges', PRIVILEGES_SQL, [
        PRIVILEGED_ROLES,
      ]);
      if (!row) throw new Error('privilege check returned no row');
      const checks: [PrivilegeViolation, boolean][] = [
        ['superuser', row.superuser],
        ['privileged_attributes', row.privilegedAttributes],
        ['owns_objects', row.ownsObjects],
        ['can_create_objects', row.canCreateObjects],
        ['can_write_data', row.canWriteData],
        ['privileged_membership', row.privilegedMembership],
      ];
      return checks.filter(([, violated]) => violated).map(([name]) => name);
    },
  };
}

export type DatasetRepository = ReturnType<typeof createDatasetRepository>;
