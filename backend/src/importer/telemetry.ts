/**
 * Importer metrics. Every attribute is a closed set (mode, outcome, reason, stage): never a file
 * name, path, checksum, import id, ticker or error message. Without the telemetry preload the meter
 * is a no-op. Recording never queries the database; the values come from the import itself.
 *
 * - earlstock.import.executions {execution}: one per run, by mode, outcome and (if not successful)
 *   reason. Lock contention is outcome = busy.
 * - earlstock.import.duration (s): wall time of a run, by mode and outcome.
 * - earlstock.import.rows {row}: rows read from the file (stage = read) and price rows committed
 *   (stage = imported).
 * - earlstock.import.batch.duration (s): one INSERT batch inside the replacement transaction; its
 *   count is the number of batches.
 */
import { fileURLToPath } from 'node:url';
import { type Attributes, metrics, type Span, ValueType } from '@opentelemetry/api';
import { isDatabaseFailure, sqlstateOf } from '../db/errors.js';
import { type LogFields, serializeError } from '../shared/logger.js';
import { withSpan } from '../shared/telemetry.js';
import { DatasetFileError } from './dataset-file.js';

export type ImportMode = 'import' | 'dry_run';
export type ExecutionOutcome = 'success' | 'no_op' | 'rejected' | 'busy' | 'failure';
export type ExecutionReason =
  | 'validation'
  | 'shrink'
  | 'usage'
  | 'privileges'
  | 'concurrent_change'
  | 'database'
  | 'unexpected';

const meter = metrics.getMeter('earlstock-importer');

const executions = meter.createCounter('earlstock.import.executions', {
  description: 'Importer runs, by mode, outcome and reason.',
  unit: '{execution}',
  valueType: ValueType.INT,
});
const duration = meter.createHistogram('earlstock.import.duration', {
  description: 'Wall time of an importer run.',
  unit: 's',
  advice: { explicitBucketBoundaries: [0.5, 1, 2.5, 5, 10, 20, 30, 60, 120, 300, 600] },
});
const rows = meter.createCounter('earlstock.import.rows', {
  description:
    'Rows read from the dataset file (stage=read) and price rows committed (stage=imported).',
  unit: '{row}',
  valueType: ValueType.INT,
});
const batchDuration = meter.createHistogram('earlstock.import.batch.duration', {
  description: 'Duration of one price INSERT batch inside the replacement transaction.',
  unit: 's',
  advice: { explicitBucketBoundaries: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
});

export function recordExecution(
  mode: ImportMode,
  outcome: ExecutionOutcome,
  reason: ExecutionReason | undefined,
  seconds: number,
): void {
  executions.add(1, { mode, outcome, ...(reason ? { reason } : {}) });
  duration.record(seconds, { mode, outcome });
}

export function recordRows(stage: 'read' | 'imported', count: number): void {
  rows.add(count, { stage });
}

export function recordBatch(seconds: number): void {
  batchDuration.record(seconds);
}

/** A bounded failure category for an error that ended a run. */
export function failureReason(err: unknown): ExecutionReason {
  if (err instanceof DatasetFileError) return 'usage';
  // By name: import.repository.ts imports this module, so importing its class here would be circular.
  if (err instanceof Error && err.name === 'ConcurrentChangeError') return 'concurrent_change';
  // A PostgreSQL error (SQLSTATE) or a lost/refused connection; other coded errors stay unexpected.
  if (isDatabaseFailure(err)) return 'database';
  return 'unexpected';
}

/**
 * error.type for importer spans: the SQLSTATE of a PostgreSQL error (node-postgres names all of them
 * "error"), otherwise the error class name. Never a message, path or parameter.
 */
export function importErrorType(err: unknown): string {
  return sqlstateOf(err) ?? (err instanceof Error ? err.name : 'unknown');
}

/** withSpan with importer error types. */
export function withImportSpan<T>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(name, attributes, operation, importErrorType);
}

/** The backend directory (this file is src/importer/*.ts or dist/importer/*.js). */
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * serializeError for importer logs, with the local backend directory removed from every message and
 * stack (`<backend>/src/x.ts:1:2` becomes `src/x.ts:1:2`), so neither the console nor the exported
 * log records disclose local filesystem paths.
 */
export function serializeImporterError(err: unknown): LogFields {
  return stripLocalPaths(serializeError(err)) as LogFields;
}

function stripLocalPaths(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replaceAll(`file://${BACKEND_ROOT}`, '').replaceAll(BACKEND_ROOT, '');
  }
  if (Array.isArray(value)) return value.map(stripLocalPaths);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripLocalPaths(v)]));
  }
  return value;
}
