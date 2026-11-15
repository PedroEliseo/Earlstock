import { parseArgs } from 'node:util';
import { SpanStatusCode } from '@opentelemetry/api';
import { Client } from 'pg';
import { logger } from '../shared/logger.js';
import { loadImporterConfig } from './config.js';
import { DatasetFileError, readDatasetFile } from './dataset-file.js';
import {
  ExcessivePrivilegesError,
  type ImportOutcome,
  isReportedImportError,
  runImport,
} from './import-runner.js';
import {
  type ExecutionOutcome,
  type ExecutionReason,
  failureReason,
  importErrorType,
  type ImportMode,
  recordExecution,
  serializeImporterError,
  withImportSpan,
} from './telemetry.js';

/**
 * CSV-to-PostgreSQL importer: `npm run import -- --file <path> [options]`. A standalone process,
 * never part of the API. Logs are JSON lines; they never contain credentials or row values.
 */

export const EXIT = {
  ok: 0, // imported, already active (no-op), or dry run passed
  rejected: 1, // validation failed or shrink refused; the active dataset is unchanged
  usage: 2, // bad arguments, configuration, unreadable file or over-privileged role
  busy: 3, // another import holds the lock; nothing was done
  failed: 4, // database or unexpected error; the active dataset is unchanged
} as const;

const USAGE = `Usage: npm run import -- --file <path> [--dry-run] [--force] [--allow-shrink]

  --file <path>    CSV to import (header: date,ticker,open,high,low,close,adj_close,volume)
  --dry-run        validate and compare with the active dataset; write nothing
  --force          re-import even if this exact file is already the active dataset
  --allow-shrink   accept fewer stocks or prices, or shorter date coverage, than the active dataset`;

export function exitCodeFor(outcome: ImportOutcome): number {
  switch (outcome.status) {
    case 'succeeded':
    case 'unchanged':
    case 'dry-run':
      return EXIT.ok;
    case 'rejected':
      return EXIT.rejected;
    case 'busy':
      return EXIT.busy;
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        file: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        'allow-shrink': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return EXIT.usage;
  }
  if (args.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  if (!args.file) {
    console.error(`--file is required\n\n${USAGE}`);
    return EXIT.usage;
  }

  const mode: ImportMode = args['dry-run'] ? 'dry_run' : 'import';
  const options = { dryRun: args['dry-run'], force: args.force, allowShrink: args['allow-shrink'] };
  const filePath = args.file;

  // One trace per run. Its outcome is set from the result, since failures are returned as exit
  // codes rather than thrown.
  return withImportSpan('import.execute', { 'earlstock.import.mode': mode }, async (span) => {
    const started = performance.now();
    const result: RunResult = await execute(filePath, options, env).catch((err: unknown) => {
      // Not expected (execute handles its errors), but the exit code must stay "failed".
      logger.error('import failed', { error: serializeImporterError(err) });
      return { exitCode: EXIT.failed, outcome: 'failure', reason: 'unexpected' };
    });
    span.setAttribute('earlstock.import.outcome', result.outcome);
    if (result.reason) span.setAttribute('earlstock.import.reason', result.reason);
    if (result.outcome === 'failure' || result.outcome === 'rejected') {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (result.errorType) span.setAttribute('error.type', result.errorType);
    }
    recordExecution(mode, result.outcome, result.reason, (performance.now() - started) / 1000);
    return result.exitCode;
  });
}

interface RunResult {
  exitCode: number;
  outcome: ExecutionOutcome;
  reason?: ExecutionReason;
  /** Error class name when the run ended with an error. */
  errorType?: string;
}

function resultFor(outcome: ImportOutcome): RunResult {
  const exitCode = exitCodeFor(outcome);
  switch (outcome.status) {
    case 'succeeded':
    case 'dry-run':
      return { exitCode, outcome: 'success' };
    case 'unchanged':
      return { exitCode, outcome: 'no_op' };
    case 'busy':
      return { exitCode, outcome: 'busy' };
    case 'rejected':
      return { exitCode, outcome: 'rejected', reason: outcome.reason };
  }
}

/** One run after argument parsing; never throws. */
async function execute(
  filePath: string,
  options: { dryRun: boolean; force: boolean; allowShrink: boolean },
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  let config;
  let file;
  try {
    config = loadImporterConfig(env);
    file = await withImportSpan('import.file.read', {}, async (span) => {
      const read = await readDatasetFile(filePath);
      span.setAttribute('earlstock.import.file.size_bytes', read.sizeBytes);
      return read;
    });
  } catch (err) {
    logger.error('importer not started', { error: serializeImporterError(err) });
    return {
      exitCode: EXIT.usage,
      outcome: 'failure',
      reason: 'usage',
      errorType: importErrorType(err),
    };
  }
  logger.info('dataset file read', {
    file: file.fileName,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    dryRun: options.dryRun,
  });

  // ONE session for the whole run: lock, bookkeeping and replacement share this connection.
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: 'earlstock-importer',
    connectionTimeoutMillis: 10_000,
    idle_in_transaction_session_timeout: 60_000,
  });
  client.on('error', (err) => {
    logger.error('importer database connection error', { error: serializeImporterError(err) });
  });
  try {
    await client.connect();
    return resultFor(await runImport(client, file, options));
  } catch (err) {
    if (err instanceof ExcessivePrivilegesError) {
      logger.error('importer refused to run', { violations: err.violations });
      return {
        exitCode: EXIT.usage,
        outcome: 'failure',
        reason: 'privileges',
        errorType: err.name,
      };
    }
    if (err instanceof DatasetFileError) {
      return { exitCode: EXIT.usage, outcome: 'failure', reason: 'usage', errorType: err.name };
    }
    // runImport logs the failures of the import itself; only earlier ones (e.g. connecting) are
    // logged here, so each failure is logged once.
    if (!isReportedImportError(err))
      logger.error('import failed', { error: serializeImporterError(err) });
    return {
      exitCode: EXIT.failed,
      outcome: 'failure',
      reason: failureReason(err),
      errorType: importErrorType(err),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
