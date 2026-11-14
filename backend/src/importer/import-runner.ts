import type { Client } from 'pg';
import { logger as defaultLogger, type Logger, serializeError } from '../shared/logger.js';
import type { DatasetFile } from './dataset-file.js';
import {
  type ActiveDataset,
  failAbandonedImports,
  findActiveDataset,
  findImporterPrivilegeViolations,
  insertRunningImport,
  markImportFailed,
  releaseImportLock,
  replaceDataset,
  type ReplacementHooks,
  tryAcquireImportLock,
} from './import.repository.js';
import {
  type DatasetStats,
  findShrinkage,
  type ShrinkReason,
  summarizeIssues,
  utcToday,
  type ValidationIssue,
  validateDataset,
} from './validation.js';

export interface ImportOptions {
  /** Validate and compare only; no database writes and no import record. */
  dryRun?: boolean;
  /** Re-import even if this exact file (same SHA-256) is already the active dataset. */
  force?: boolean;
  /** Accept a dataset smaller than the active one in some dimension. */
  allowShrink?: boolean;
  /** Execution date (YYYY-MM-DD, UTC) for the future-date rule. Defaults to today. */
  today?: string;
  batchSize?: number;
  hooks?: ReplacementHooks;
  logger?: Logger;
}

export interface ImportTimings {
  validationMs: number;
  transactionMs?: number;
  totalMs: number;
}

export type ImportOutcome =
  | {
      status: 'succeeded';
      importId: number;
      rowsRead: number;
      stats: DatasetStats;
      replacedImportId: number | null;
      abandonedImportIds: number[];
      timings: ImportTimings;
    }
  /** The file is already the active dataset: nothing was written. */
  | { status: 'unchanged'; activeImportId: number }
  /** Another importer session holds the lock: nothing was written. */
  | { status: 'busy' }
  /** Rejected before any replacement; recorded as a failed import (importId null on dry runs). */
  | {
      status: 'rejected';
      reason: 'validation' | 'shrink';
      importId: number | null;
      rowsRead: number;
      issueCount?: number;
      issues?: ValidationIssue[];
      shrinkage?: ShrinkReason[];
      dryRun: boolean;
    }
  | {
      status: 'dry-run';
      rowsRead: number;
      stats: DatasetStats;
      active: { importId: number; stats: DatasetStats; sameFile: boolean } | null;
      shrinkage: ShrinkReason[];
      timings: ImportTimings;
    };

export class ExcessivePrivilegesError extends Error {
  override readonly name = 'ExcessivePrivilegesError';
  constructor(readonly violations: string[]) {
    super(`the importer role has excessive privileges: ${violations.join(', ')}`);
  }
}

/**
 * Runs one import on ONE dedicated PostgreSQL session (`client`, never a pool). The caller owns the
 * connection (connects before, ends after). See README "Importing the dataset" for the semantics.
 */
export async function runImport(
  client: Client,
  file: DatasetFile,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const log = options.logger ?? defaultLogger;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const source = { file: file.fileName, sha256: file.sha256, sizeBytes: file.sizeBytes };

  const violations = await findImporterPrivilegeViolations(client);
  if (violations.length > 0) throw new ExcessivePrivilegesError(violations);

  if (options.dryRun) return dryRun(client, file, options, log, elapsed);

  if (!(await tryAcquireImportLock(client))) {
    log.warn('another import is running; nothing was done', source);
    return { status: 'busy' };
  }
  let importId: number | null = null;
  let rowsRead: number | null = null;
  try {
    const abandonedImportIds = await failAbandonedImports(client);
    if (abandonedImportIds.length > 0) {
      log.warn('marked abandoned imports as failed', { importIds: abandonedImportIds });
    }

    const active = await findActiveDataset(client);
    if (active?.sha256 === file.sha256 && !options.force) {
      log.info(
        'this file is already the active dataset; nothing to do (use --force to re-import)',
        {
          ...source,
          activeImportId: active.importId,
        },
      );
      return { status: 'unchanged', activeImportId: active.importId };
    }

    importId = await insertRunningImport(client, { fileName: file.fileName, sha256: file.sha256 });
    log.info('import started', { importId, ...source });

    const validation = await validateDataset(file.bytes, { today: options.today ?? utcToday() });
    const validationMs = elapsed();
    rowsRead = validation.rowsRead;
    if (!validation.ok) {
      const summary = summarizeIssues(validation.issueCount, validation.issues);
      await markImportFailed(client, importId, summary, validation.rowsRead);
      log.error('import rejected: validation failed', {
        importId,
        rowsRead: validation.rowsRead,
        issueCount: validation.issueCount,
        issues: validation.issues,
      });
      return {
        status: 'rejected',
        reason: 'validation',
        importId,
        rowsRead: validation.rowsRead,
        issueCount: validation.issueCount,
        issues: validation.issues,
        dryRun: false,
      };
    }
    log.info('validation passed', { importId, rowsRead, stats: validation.stats, validationMs });

    const shrinkage = active ? findShrinkage(active.stats, validation.stats) : [];
    if (shrinkage.length > 0 && !options.allowShrink) {
      await markImportFailed(client, importId, shrinkSummary(shrinkage), validation.rowsRead);
      log.error('import rejected: the new dataset is smaller than the active one', {
        importId,
        shrinkage,
      });
      return {
        status: 'rejected',
        reason: 'shrink',
        importId,
        rowsRead: validation.rowsRead,
        shrinkage,
        dryRun: false,
      };
    }
    if (shrinkage.length > 0) {
      log.warn('replacing with a smaller dataset (--allow-shrink)', { importId, shrinkage });
    }

    const transactionStarted = performance.now();
    await replaceDataset(client, {
      importId,
      expectedActiveImportId: active?.importId ?? null,
      rows: validation.rows,
      rowsRead: validation.rowsRead,
      stats: validation.stats,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
    });
    const timings = {
      validationMs,
      transactionMs: Math.round(performance.now() - transactionStarted),
      totalMs: elapsed(),
    };
    log.info('import succeeded and activated', {
      importId,
      replacedImportId: active?.importId ?? null,
      rowsRead,
      stats: validation.stats,
      timings,
    });
    return {
      status: 'succeeded',
      importId,
      rowsRead: validation.rowsRead,
      stats: validation.stats,
      replacedImportId: active?.importId ?? null,
      abandonedImportIds,
      timings,
    };
  } catch (err) {
    // The replacement transaction has already been rolled back; record the failure separately.
    if (importId !== null) {
      try {
        await markImportFailed(client, importId, failureSummary(err), rowsRead);
      } catch (markError) {
        // Left 'running'; the next run marks it abandoned.
        log.error('could not record the failed import', {
          importId,
          error: serializeError(markError),
        });
      }
    }
    log.error('import failed; the active dataset was not changed', {
      importId,
      error: serializeError(err),
    });
    throw err;
  } finally {
    try {
      await releaseImportLock(client);
    } catch {
      // The lock is session-level: it is released when the connection closes.
    }
  }
}

/**
 * Reads, hashes, validates and compares with the active dataset. The session is switched to
 * read-only first, so PostgreSQL itself refuses any write; no lock is taken and no record created.
 */
async function dryRun(
  client: Client,
  file: DatasetFile,
  options: ImportOptions,
  log: Logger,
  elapsed: () => number,
): Promise<ImportOutcome> {
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const validation = await validateDataset(file.bytes, { today: options.today ?? utcToday() });
  const validationMs = elapsed();
  if (!validation.ok) {
    log.error('dry run: validation failed', {
      file: file.fileName,
      sha256: file.sha256,
      rowsRead: validation.rowsRead,
      issueCount: validation.issueCount,
      issues: validation.issues,
    });
    return {
      status: 'rejected',
      reason: 'validation',
      importId: null,
      rowsRead: validation.rowsRead,
      issueCount: validation.issueCount,
      issues: validation.issues,
      dryRun: true,
    };
  }
  const active: ActiveDataset | null = await findActiveDataset(client);
  const shrinkage = active ? findShrinkage(active.stats, validation.stats) : [];
  const summary = {
    file: file.fileName,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    rowsRead: validation.rowsRead,
    stats: validation.stats,
    active: active
      ? { importId: active.importId, stats: active.stats, sameFile: active.sha256 === file.sha256 }
      : null,
    shrinkage,
    timings: { validationMs, totalMs: elapsed() },
  };
  if (shrinkage.length > 0 && !options.allowShrink) {
    log.error('dry run: valid, but an import would be refused without --allow-shrink', summary);
    return {
      status: 'rejected',
      reason: 'shrink',
      importId: null,
      rowsRead: validation.rowsRead,
      shrinkage,
      dryRun: true,
    };
  }
  log.info('dry run: validation passed; nothing was written', summary);
  return { status: 'dry-run', ...summary };
}

function shrinkSummary(shrinkage: ShrinkReason[]): string {
  return `refused without --allow-shrink: the new dataset is smaller in ${shrinkage
    .map((s) => `${s.dimension} (active ${String(s.active)}, new ${String(s.incoming)})`)
    .join(', ')}`;
}

function failureSummary(err: unknown): string {
  const fields = serializeError(err);
  const code = typeof fields['code'] === 'string' ? ` [${fields['code']}]` : '';
  return `${String(fields['name'])}${code}: ${String(fields['message'])}`.slice(0, 2000);
}
