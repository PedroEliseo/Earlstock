import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { logger, serializeError } from '../shared/logger.js';
import { loadImporterConfig } from './config.js';
import { DatasetFileError, readDatasetFile } from './dataset-file.js';
import { ExcessivePrivilegesError, type ImportOutcome, runImport } from './import-runner.js';

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

  let config;
  let file;
  try {
    config = loadImporterConfig(env);
    file = await readDatasetFile(args.file);
  } catch (err) {
    logger.error('importer not started', { error: serializeError(err) });
    return EXIT.usage;
  }
  logger.info('dataset file read', {
    file: file.fileName,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    dryRun: args['dry-run'],
  });

  // ONE session for the whole run: lock, bookkeeping and replacement share this connection.
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: 'earlstock-importer',
    connectionTimeoutMillis: 10_000,
    idle_in_transaction_session_timeout: 60_000,
  });
  client.on('error', (err) => {
    logger.error('importer database connection error', { error: serializeError(err) });
  });
  try {
    await client.connect();
    const outcome = await runImport(client, file, {
      dryRun: args['dry-run'],
      force: args.force,
      allowShrink: args['allow-shrink'],
    });
    return exitCodeFor(outcome);
  } catch (err) {
    if (err instanceof ExcessivePrivilegesError) {
      logger.error('importer refused to run', { violations: err.violations });
      return EXIT.usage;
    }
    if (err instanceof DatasetFileError) return EXIT.usage;
    logger.error('import failed', { error: serializeError(err) });
    return EXIT.failed;
  } finally {
    await client.end().catch(() => undefined);
  }
}
