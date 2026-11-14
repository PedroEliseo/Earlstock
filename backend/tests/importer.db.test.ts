import type { Express } from 'express';
import type { Client, Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { EXIT, main } from '../src/importer/cli.js';
import {
  ConcurrentChangeError,
  IMPORT_LOCK_KEY,
  insertRunningImport,
  replaceDataset,
} from '../src/importer/import.repository.js';
import { type ImportOptions, runImport } from '../src/importer/import-runner.js';
import type { PriceRow } from '../src/importer/validation.js';
import { createLogger } from '../src/shared/logger.js';
import {
  asDatasetFile,
  buildCsv,
  daysAgo,
  HEADER,
  row,
  type StockSpec,
  withNames,
} from './helpers/csv.js';
import {
  connectImporter,
  createFixturePool,
  createTestPool,
  describeWithDatabase,
  truncateAll,
} from './helpers/database.js';
import { testDatabaseUrls } from './setup/global-setup.js';

/**
 * The importer against a real PostgreSQL test database, as the importer role, with the API reading
 * as the API role. Covers activation, idempotency, rejection, rollback, MVCC visibility, the
 * advisory lock, abandoned imports, retries, shrink protection and dry runs.
 */

const silent = createLogger(() => undefined);
const opts = (extra: ImportOptions = {}): ImportOptions => ({ logger: silent, ...extra });

/** A one-shot barrier: the import waits at a hook until the test releases it. */
function barrier() {
  let reach!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  return {
    reached,
    release,
    wait: async () => {
      reach();
      await released;
    },
  };
}

describeWithDatabase('dataset importer (PostgreSQL)', () => {
  let fixtures: Pool;
  let api: Pool;
  let app: Express;
  let importer: Client;

  beforeAll(() => {
    fixtures = createFixturePool();
    api = createTestPool();
    app = createApp({ pool: api });
  });
  beforeEach(async () => {
    await truncateAll(fixtures);
    importer = await connectImporter();
  });
  afterEach(async () => {
    await importer.end();
  });
  afterAll(async () => {
    await truncateAll(fixtures);
    await api.end();
    await fixtures.end();
  });

  const STOCKS: StockSpec[] = [
    { ticker: 'AAA', days: 5 },
    { ticker: 'BRK.B', days: 3 },
  ];
  const importCsv = (csv: string, extra: ImportOptions = {}) =>
    runImport(importer, asDatasetFile(csv), opts(extra));

  const imports = async () =>
    (
      await fixtures.query<{
        id: number;
        status: string;
        rows_read: number | null;
        stock_count: number | null;
        price_count: number | null;
        error_summary: string | null;
      }>(
        'SELECT id, status, rows_read, stock_count, price_count, error_summary FROM data_imports ORDER BY id',
      )
    ).rows;
  const activeImportId = async () =>
    (await fixtures.query<{ id: number }>('SELECT import_id AS id FROM dataset_snapshot')).rows[0]
      ?.id ?? null;
  /** Byte-level fingerprint of every table the importer can touch. */
  const fingerprint = async () =>
    (
      await fixtures.query(
        `SELECT
           (SELECT md5(coalesce(string_agg(s::text, '|' ORDER BY s.id), '')) FROM stocks s) AS stocks,
           (SELECT md5(coalesce(string_agg(d::text, '|' ORDER BY d.stock_id, d.trade_date), '')) FROM daily_prices d) AS prices,
           (SELECT md5(coalesce(string_agg(i::text, '|' ORDER BY i.id), '')) FROM data_imports i) AS imports,
           (SELECT md5(coalesce(string_agg(x::text, '|'), '')) FROM dataset_snapshot x) AS snapshot`,
      )
    ).rows[0] as Record<string, string>;
  /** The logical dataset: ticker, date and values exactly as stored (independent of ids). */
  const logicalRows = async () =>
    (
      await fixtures.query<Record<string, string>>(
        `SELECT s.ticker, to_char(d.trade_date, 'YYYY-MM-DD') AS date, d.open::text AS open,
                d.high::text AS high, d.low::text AS low, d.close::text AS close,
                d.adj_close::text AS adj_close, d.volume::text AS volume
         FROM daily_prices d JOIN stocks s ON s.id = d.stock_id ORDER BY s.ticker, d.trade_date`,
      )
    ).rows;
  const listedTickers = async () => {
    const res = await request(app).get('/api/stocks?limit=100');
    return {
      status: res.status,
      snapshot: res.headers['dataset-snapshot'],
      tickers: (res.body as { data?: { ticker: string }[] }).data?.map((s) => s.ticker),
    };
  };
  /** The backend pid holding the importer's advisory lock, or null. */
  const lockHolder = async () =>
    (
      await fixtures.query<{ pid: number }>(
        `SELECT pid FROM pg_locks
         WHERE locktype = 'advisory' AND granted AND objsubid = 1
           AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
        [IMPORT_LOCK_KEY],
      )
    ).rows[0]?.pid ?? null;
  const pidOf = async (client: Client) =>
    (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;

  describe('a successful import', () => {
    it('stores the dataset exactly, records it as succeeded and activates it', async () => {
      const csv = buildCsv(STOCKS, [
        `${daysAgo(30)},EXACT,123456789012.123456,123456789012.123456,0.000001,0.1,0.30,9007199254740991`,
      ]);

      const outcome = await importCsv(csv);

      expect(outcome).toMatchObject({
        status: 'succeeded',
        rowsRead: 9,
        stats: { stockCount: 3, priceCount: 9 },
        replacedImportId: null,
      });
      if (outcome.status !== 'succeeded') return;
      expect(await activeImportId()).toBe(outcome.importId);
      expect(await imports()).toEqual([
        {
          id: outcome.importId,
          status: 'succeeded',
          rows_read: 9,
          stock_count: 3,
          price_count: 9,
          error_summary: null,
        },
      ]);
      // Decimal text survives exactly: 12 integer digits, 6 decimals, 2^53 - 1 volume.
      expect((await logicalRows()).find((r) => r['ticker'] === 'EXACT')).toEqual({
        ticker: 'EXACT',
        date: daysAgo(30),
        open: '123456789012.123456',
        high: '123456789012.123456',
        low: '0.000001',
        close: '0.100000',
        adj_close: '0.300000',
        volume: '9007199254740991',
      });
      expect(await listedTickers()).toEqual({
        status: 200,
        snapshot: String(outcome.importId),
        tickers: ['AAA', 'BRK.B', 'EXACT'],
      });
      const { rows } = await fixtures.query<{ file: string; sha: string }>(
        'SELECT source_file AS file, source_sha256 AS sha FROM data_imports',
      );
      expect(rows[0]).toEqual({ file: 'synthetic.csv', sha: asDatasetFile(csv).sha256 });
    });

    it('inserts every row across many batches (no row dropped, counts verified)', async () => {
      const csv = buildCsv([
        { ticker: 'AAA', days: 37 },
        { ticker: 'BBB', days: 41 },
        { ticker: 'CCC', days: 1 },
      ]);
      const batches: number[] = [];

      const outcome = await importCsv(csv, {
        batchSize: 10,
        hooks: {
          afterBatch: (inserted) => {
            batches.push(inserted);
            return Promise.resolve();
          },
        },
      });

      expect(outcome).toMatchObject({ status: 'succeeded', stats: { priceCount: 79 } });
      expect(batches).toEqual([10, 20, 30, 40, 50, 60, 70, 79]);
      expect(await logicalRows()).toHaveLength(79);
    });

    it('produces the same logical dataset whatever the row order', async () => {
      const csv = buildCsv(STOCKS);
      await importCsv(csv);
      const first = await logicalRows();

      const [header, ...rows] = csv.trimEnd().split('\n');
      const reversed = `${[header, ...rows.reverse()].join('\n')}\n`;
      expect(await importCsv(reversed)).toMatchObject({ status: 'succeeded' });

      expect(await logicalRows()).toEqual(first);
    });
  });

  describe('idempotency', () => {
    it('is a no-op for the exact file that is already active: no write, no record', async () => {
      const csv = buildCsv(STOCKS);
      const first = await importCsv(csv);
      const before = await fingerprint();

      const again = await importCsv(csv);

      expect(again).toEqual({
        status: 'unchanged',
        activeImportId: first.status === 'succeeded' ? first.importId : -1,
      });
      expect(await fingerprint()).toEqual(before);
    });

    it('re-imports the same file with --force: a new import, identical data and stock ids', async () => {
      const csv = buildCsv(STOCKS);
      await importCsv(csv);
      const rowsBefore = await logicalRows();
      const stockIds = (await fixtures.query('SELECT id, ticker FROM stocks ORDER BY ticker')).rows;

      const forced = await importCsv(csv, { force: true });

      expect(forced).toMatchObject({ status: 'succeeded' });
      expect(await logicalRows()).toEqual(rowsBefore);
      expect((await fixtures.query('SELECT id, ticker FROM stocks ORDER BY ticker')).rows).toEqual(
        stockIds,
      );
      expect((await imports()).map((i) => i.status)).toEqual(['succeeded', 'succeeded']);
    });

    it('replaces the dataset with a different file, dropping stocks that left it', async () => {
      const first = await importCsv(buildCsv(STOCKS));
      const next = await importCsv(
        buildCsv([
          { ticker: 'AAA', days: 6 },
          { ticker: 'NEW', days: 6 },
        ]),
        { allowShrink: false },
      );

      expect(next).toMatchObject({
        status: 'succeeded',
        replacedImportId: first.status === 'succeeded' ? first.importId : -1,
      });
      expect((await listedTickers()).tickers).toEqual(['AAA', 'NEW']);
      const stocks = await fixtures.query<{ ticker: string }>(
        'SELECT ticker FROM stocks ORDER BY ticker',
      );
      expect(stocks.rows.map((s) => s.ticker)).toEqual(['AAA', 'NEW']);
      // The replaced import stays in the history, still 'succeeded', but holds no prices.
      expect((await imports()).map((i) => i.status)).toEqual(['succeeded', 'succeeded']);
    });
  });

  describe('rejected input never touches the active dataset', () => {
    let original: Record<string, string>;
    let activeId: number | null;
    beforeEach(async () => {
      await importCsv(buildCsv(STOCKS));
      activeId = await activeImportId();
      original = await fingerprint();
    });

    const expectActiveUnchanged = async () => {
      const now = await fingerprint();
      expect({ stocks: now['stocks'], prices: now['prices'], snapshot: now['snapshot'] }).toEqual({
        stocks: original['stocks'],
        prices: original['prices'],
        snapshot: original['snapshot'],
      });
      expect(await activeImportId()).toBe(activeId);
      expect((await listedTickers()).snapshot).toBe(String(activeId));
    };

    it.each([
      ['an empty file', ''],
      ['a header-only file', `${HEADER}\n`],
      ['a partially corrupted file', buildCsv(STOCKS, [`${daysAgo(1)},ZZZ,1,1,1,1,1,-1`])],
      ['a file with an exact duplicate row', buildCsv(STOCKS, [row('AAA', daysAgo(1), 100, 4)])],
      ['a file with conflicting duplicates', buildCsv(STOCKS, [row('AAA', daysAgo(1), 999)])],
      [
        'a file with a 7th decimal place',
        buildCsv(STOCKS, [`${daysAgo(1)},ZZZ,1.0000001,2,1,1,1,1`]),
      ],
      ['a file with a future date', buildCsv(STOCKS, [row('ZZZ', daysAgo(-1))])],
    ])('rejects %s and records the failed attempt', async (_name, csv) => {
      const outcome = await importCsv(csv);

      expect(outcome).toMatchObject({ status: 'rejected', reason: 'validation', dryRun: false });
      const failed = (await imports()).at(-1);
      expect(failed?.status).toBe('failed');
      expect(failed?.error_summary).toMatch(/^validation failed with \d+ issue/);
      await expectActiveUnchanged();
    });

    it('rolls back every batch when one fails mid-replacement, then records the failure', async () => {
      const outcome = importCsv(buildCsv([{ ticker: 'NEW', days: 50 }, ...STOCKS]), {
        batchSize: 10,
        hooks: {
          afterBatch: (inserted) =>
            inserted >= 30
              ? Promise.reject(new Error('injected batch failure'))
              : Promise.resolve(),
        },
      });

      await expect(outcome).rejects.toThrow('injected batch failure');
      await expectActiveUnchanged();
      const failed = (await imports()).at(-1);
      expect(failed).toMatchObject({ status: 'failed', stock_count: null, price_count: null });
      expect(failed?.error_summary).toContain('injected batch failure');
      expect(await lockHolder()).toBeNull();
    });

    it('rolls back on a real database error in a later batch (constraint violation)', async () => {
      // Bypasses validation on purpose: the database CHECK is the last line of defense.
      const importId = await insertRunningImport(importer, {
        fileName: 'x.csv',
        sha256: 'd'.repeat(64),
      });
      const valid: PriceRow = {
        ticker: 'NEW',
        date: daysAgo(1),
        open: '10',
        high: '11',
        low: '9',
        close: '10.5',
        adjClose: '10.5',
        volume: '1',
      };
      const good = Array.from({ length: 25 }, (_, i) => ({ ...valid, date: daysAgo(i + 1) }));
      const bad: PriceRow = { ...valid, date: daysAgo(40), high: '1' }; // high < low

      const attempt = replaceDataset(importer, {
        importId,
        expectedActiveImportId: activeId,
        rows: [...good, bad],
        names: new Map(),
        rowsRead: 26,
        stats: { stockCount: 1, priceCount: 26, tradingDates: 26, firstDate: '', lastDate: '' },
        batchSize: 10,
      });

      await expect(attempt).rejects.toMatchObject({ code: '23514' });
      await expectActiveUnchanged();
      const { rows } = await importer.query<{ status: string }>(
        'SELECT status FROM data_imports WHERE id = $1',
        [importId],
      );
      expect(rows[0]?.status).toBe('running'); // the runner, not the transaction, marks it failed
    });

    it('refuses to replace if the active dataset changed after validation started', async () => {
      const importId = await insertRunningImport(importer, {
        fileName: 'x.csv',
        sha256: 'd'.repeat(64),
      });

      await expect(
        replaceDataset(importer, {
          importId,
          expectedActiveImportId: (activeId ?? 0) + 1000,
          rows: [],
          names: new Map(),
          rowsRead: 0,
          stats: { stockCount: 0, priceCount: 0, tradingDates: 0, firstDate: '', lastDate: '' },
        }),
      ).rejects.toBeInstanceOf(ConcurrentChangeError);
      await expectActiveUnchanged();
    });

    it('succeeds on a retry after a failure, keeping the failure in the history', async () => {
      await importCsv(buildCsv(STOCKS, [`${daysAgo(1)},bad,1,1,1,1,1,1`]));
      const retry = await importCsv(buildCsv([...STOCKS, { ticker: 'NEW', days: 2 }]));

      expect(retry).toMatchObject({ status: 'succeeded' });
      expect((await imports()).map((i) => i.status)).toEqual(['succeeded', 'failed', 'succeeded']);
      expect((await listedTickers()).tickers).toEqual(['AAA', 'BRK.B', 'NEW']);
    });
  });

  describe('stock names', () => {
    const storedNames = async () =>
      Object.fromEntries(
        (
          await fixtures.query<{ ticker: string; name: string | null }>(
            'SELECT ticker, name FROM stocks ORDER BY ticker',
          )
        ).rows.map((r) => [r.ticker, r.name]),
      );

    it('stores the names of a file with a name column; unknown names stay NULL', async () => {
      const outcome = await importCsv(withNames(buildCsv(STOCKS), { AAA: 'Alpha, Inc.' }));
      expect(outcome).toMatchObject({ status: 'succeeded' });
      expect(await storedNames()).toEqual({ AAA: 'Alpha, Inc.', 'BRK.B': null });
    });

    it('keeps stored names when a later file has no name column or an empty name', async () => {
      await importCsv(withNames(buildCsv(STOCKS), { AAA: 'Alpha', 'BRK.B': 'Berkshire' }));
      const legacy = buildCsv([...STOCKS, { ticker: 'NEW', days: 2 }]);
      expect(await importCsv(legacy)).toMatchObject({ status: 'succeeded' });
      expect(await storedNames()).toEqual({ AAA: 'Alpha', 'BRK.B': 'Berkshire', NEW: null });

      const partial = withNames(buildCsv([...STOCKS, { ticker: 'NEW', days: 3 }]), {
        NEW: 'Newco',
      });
      expect(await importCsv(partial)).toMatchObject({ status: 'succeeded' });
      expect(await storedNames()).toEqual({ AAA: 'Alpha', 'BRK.B': 'Berkshire', NEW: 'Newco' });
    });

    it('replaces a stored name with a different one from a newer file', async () => {
      await importCsv(withNames(buildCsv(STOCKS), { AAA: 'Alpha' }));
      await importCsv(
        withNames(buildCsv([...STOCKS, { ticker: 'X', days: 1 }]), { AAA: 'Alpha Holdings' }),
      );
      expect((await storedNames())['AAA']).toBe('Alpha Holdings');
    });

    it('leaves names untouched when the import fails or is rejected', async () => {
      await importCsv(withNames(buildCsv(STOCKS), { AAA: 'Alpha' }));
      const renamed = withNames(buildCsv([...STOCKS, { ticker: 'NEW', days: 2 }]), {
        AAA: 'Changed',
        NEW: 'Newco',
      });

      await expect(
        importCsv(renamed, {
          hooks: { beforeCommit: () => Promise.reject(new Error('injected')) },
        }),
      ).rejects.toThrow('injected');
      const conflicting = `${HEADER},name\n${row('AAA', daysAgo(2))},One\n${row('AAA', daysAgo(1))},Two\n`;
      expect(await importCsv(conflicting)).toMatchObject({
        status: 'rejected',
        reason: 'validation',
      });

      expect(await storedNames()).toEqual({ AAA: 'Alpha', 'BRK.B': null });
    });

    it('treats the identical enriched file as a no-op, and imports prices identically with or without names', async () => {
      const plain = buildCsv(STOCKS);
      await importCsv(plain);
      const pricesWithout = await logicalRows();
      const enriched = withNames(plain, { AAA: 'Alpha' });
      expect(await importCsv(enriched)).toMatchObject({ status: 'succeeded' });
      expect(await logicalRows()).toEqual(pricesWithout);
      const before = await fingerprint();
      expect(await importCsv(enriched)).toMatchObject({ status: 'unchanged' });
      expect(await fingerprint()).toEqual(before);
    });

    it('reports how many stocks are named in a dry run, writing nothing', async () => {
      const logs: string[] = [];
      const before = await fingerprint();
      const outcome = await runImport(
        importer,
        asDatasetFile(withNames(buildCsv(STOCKS), { AAA: 'Alpha' })),
        {
          dryRun: true,
          logger: createLogger((_level, line) => logs.push(line)),
        },
      );
      expect(outcome.status).toBe('dry-run');
      expect(logs.join('\n')).toContain('"namedStocks":1');
      expect(await fingerprint()).toEqual(before);
    });
  });

  describe('shrink protection', () => {
    beforeEach(async () => {
      await importCsv(
        buildCsv([
          { ticker: 'AAA', days: 10, endOffset: 5 },
          { ticker: 'BBB', days: 10, endOffset: 5 },
        ]),
      );
    });

    it.each([
      ['fewer stocks', [{ ticker: 'AAA', days: 30, endOffset: 1 }], ['stocks']],
      [
        'fewer price rows',
        [
          { ticker: 'AAA', days: 10, endOffset: 5 },
          { ticker: 'BBB', days: 9, endOffset: 5 },
        ],
        ['prices'],
      ],
      [
        'coverage starting later',
        [
          { ticker: 'AAA', days: 10, endOffset: 4 },
          { ticker: 'BBB', days: 10, endOffset: 4 },
        ],
        ['first_date'],
      ],
      [
        'coverage ending earlier',
        [
          { ticker: 'AAA', days: 11, endOffset: 6 },
          { ticker: 'BBB', days: 9, endOffset: 6 },
        ],
        ['last_date'],
      ],
      [
        'everything smaller',
        [{ ticker: 'AAA', days: 2, endOffset: 7 }],
        ['stocks', 'prices', 'first_date', 'last_date'],
      ],
    ] as [string, StockSpec[], string[]][])(
      'refuses %s without --allow-shrink, naming the dimensions',
      async (_name, stocks, dimensions) => {
        const before = await fingerprint();

        const outcome = await importCsv(buildCsv(stocks));

        expect(outcome.status).toBe('rejected');
        if (outcome.status !== 'rejected') return;
        expect(outcome.reason).toBe('shrink');
        expect(outcome.shrinkage?.map((s) => s.dimension)).toEqual(dimensions);
        const failed = (await imports()).at(-1);
        expect(failed?.status).toBe('failed');
        for (const dimension of dimensions) expect(failed?.error_summary).toContain(dimension);
        const after = await fingerprint();
        expect([after['prices'], after['snapshot']]).toEqual([
          before['prices'],
          before['snapshot'],
        ]);
      },
    );

    it('replaces with a smaller dataset when --allow-shrink is given', async () => {
      const outcome = await importCsv(buildCsv([{ ticker: 'AAA', days: 2 }]), {
        allowShrink: true,
      });
      expect(outcome).toMatchObject({ status: 'succeeded', stats: { stockCount: 1 } });
      expect((await listedTickers()).tickers).toEqual(['AAA']);
    });

    it('accepts a dataset that is larger in every dimension', async () => {
      const outcome = await importCsv(
        buildCsv([
          { ticker: 'AAA', days: 20, endOffset: 1 },
          { ticker: 'BBB', days: 20, endOffset: 1 },
          { ticker: 'CCC', days: 1, endOffset: 1 },
        ]),
      );
      expect(outcome.status).toBe('succeeded');
    });
  });

  describe('dry run', () => {
    it.each([
      ['a valid file (no active dataset)', () => buildCsv(STOCKS), false, 'dry-run'],
      ['a valid file (with an active dataset)', () => buildCsv(STOCKS), true, 'dry-run'],
      ['an invalid file', () => buildCsv(STOCKS, ['garbage']), true, 'rejected'],
      ['a shrinking file', () => buildCsv([{ ticker: 'AAA', days: 1 }]), true, 'rejected'],
    ])(
      'writes nothing for %s: no record, no lock, every table unchanged',
      async (_name, csv, seeded, status) => {
        if (seeded) await importCsv(buildCsv([{ ticker: 'AAA', days: 2 }]));
        const before = await fingerprint();

        const outcome = await importCsv(csv(), { dryRun: true });

        expect(outcome.status).toBe(status);
        expect(await fingerprint()).toEqual(before);
        expect(await lockHolder()).toBeNull();
      },
    );

    it('reports the validation summary and the comparison with the active dataset', async () => {
      const csv = buildCsv(STOCKS);
      const first = await importCsv(csv);

      const outcome = await importCsv(csv, { dryRun: true });

      expect(outcome).toMatchObject({
        status: 'dry-run',
        rowsRead: 8,
        stats: { stockCount: 2, priceCount: 8 },
        active: {
          importId: first.status === 'succeeded' ? first.importId : -1,
          sameFile: true,
          stats: { stockCount: 2, priceCount: 8 },
        },
        shrinkage: [],
      });
    });

    it('runs in a read-only session: PostgreSQL itself would refuse a write', async () => {
      await importCsv(buildCsv(STOCKS), { dryRun: true });
      await expect(importer.query('DELETE FROM daily_prices')).rejects.toMatchObject({
        code: '25006',
      });
    });
  });

  describe('concurrency', () => {
    it('keeps readers on the old dataset until COMMIT, then shows the new one (never a mixture)', async () => {
      const first = await importCsv(buildCsv(STOCKS));
      const oldId = first.status === 'succeeded' ? first.importId : -1;
      const gate = barrier();

      const running = importCsv(
        buildCsv([
          { ticker: 'AAA', days: 6 },
          { ticker: 'BRK.B', days: 3 },
          { ticker: 'NEW', days: 4 },
        ]),
        { hooks: { beforeCommit: gate.wait } },
      );
      await gate.reached;

      // Inside the import transaction: rows deleted and re-inserted, pointer moved, not committed.
      const during = await listedTickers();
      const duringPrices = await request(app).get('/api/stocks/AAA/prices');
      const missingNew = await request(app).get('/api/stocks/NEW');
      gate.release();
      const outcome = await running;

      expect(during).toEqual({ status: 200, snapshot: String(oldId), tickers: ['AAA', 'BRK.B'] });
      expect(duringPrices.status).toBe(200);
      expect((duringPrices.body as { data: unknown[] }).data).toHaveLength(5);
      expect(missingNew.status).toBe(404);
      expect(outcome).toMatchObject({ status: 'succeeded' });
      const newId = outcome.status === 'succeeded' ? outcome.importId : -2;
      expect(await listedTickers()).toEqual({
        status: 200,
        snapshot: String(newId),
        tickers: ['AAA', 'BRK.B', 'NEW'],
      });
      const afterPrices = await request(app).get('/api/stocks/AAA/prices');
      expect((afterPrices.body as { data: unknown[] }).data).toHaveLength(6);
    });

    it('holds the advisory lock on the importer session for the whole import, then releases it', async () => {
      const importerPid = await pidOf(importer);
      const observed: { lock: number | null; writer: number | null }[] = [];
      const observe = async () => {
        const writer = await fixtures.query<{ pid: number }>(
          `SELECT pid FROM pg_locks
           WHERE locktype = 'relation' AND relation = 'daily_prices'::regclass
             AND mode = 'RowExclusiveLock' AND granted`,
        );
        observed.push({ lock: await lockHolder(), writer: writer.rows[0]?.pid ?? null });
      };

      const outcome = await importCsv(buildCsv([{ ticker: 'AAA', days: 30 }]), {
        batchSize: 10,
        hooks: { afterBatch: observe, beforeCommit: observe },
      });

      expect(outcome.status).toBe('succeeded');
      expect(observed).toHaveLength(4);
      // The lock holder IS the session writing the rows: one connection for everything.
      for (const point of observed)
        expect(point).toEqual({ lock: importerPid, writer: importerPid });
      expect(await lockHolder()).toBeNull();
    });

    it('releases the lock after a failed import, and the session stays usable', async () => {
      await expect(
        importCsv(buildCsv(STOCKS), {
          hooks: { beforeCommit: () => Promise.reject(new Error('injected')) },
        }),
      ).rejects.toThrow('injected');

      expect(await lockHolder()).toBeNull();
      expect(await importCsv(buildCsv(STOCKS))).toMatchObject({ status: 'succeeded' });
    });

    it('refuses a second importer while one is running: no record, no wait, no interleaving', async () => {
      const gate = barrier();
      const firstRun = importCsv(buildCsv(STOCKS), { hooks: { beforeCommit: gate.wait } });
      await gate.reached;
      const recordsDuring = (await imports()).length;

      const second = await connectImporter();
      let secondOutcome;
      try {
        secondOutcome = await runImport(
          second,
          asDatasetFile(buildCsv([{ ticker: 'OTHER', days: 9 }])),
          opts(),
        );
      } finally {
        await second.end();
      }
      const recordsAfterSecond = (await imports()).length;
      gate.release();
      const first = await firstRun;

      expect(secondOutcome).toEqual({ status: 'busy' });
      expect(recordsAfterSecond).toBe(recordsDuring);
      expect(first).toMatchObject({ status: 'succeeded' });
      expect((await listedTickers()).tickers).toEqual(['AAA', 'BRK.B']);
    });

    it('marks imports abandoned by a crashed process as failed on the next run', async () => {
      const { rows } = await fixtures.query<{ id: number }>(
        `INSERT INTO data_imports (source_file, source_sha256, status, started_at)
         VALUES ('crashed.csv', repeat('e', 64), 'running', now() - interval '1 hour') RETURNING id`,
      );

      const outcome = await importCsv(buildCsv(STOCKS));

      expect(outcome).toMatchObject({ status: 'succeeded', abandonedImportIds: [rows[0]?.id] });
      const crashed = (await imports()).find((i) => i.id === rows[0]?.id);
      expect(crashed?.status).toBe('failed');
      expect(crashed?.error_summary).toMatch(/^abandoned/);
    });
  });

  describe('CLI (end to end, as a separate session per run)', () => {
    const urls = testDatabaseUrls();
    let dir: string;
    let logs: string[];
    let restore: () => void;
    beforeAll(async () => {
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      dir = await mkdtemp(path.join(tmpdir(), 'earlstock-cli-'));
    });
    beforeEach(() => {
      logs = [];
      const log = console.log;
      const error = console.error;
      console.log = (line: string) => logs.push(line);
      console.error = (line: string) => logs.push(line);
      restore = () => {
        console.log = log;
        console.error = error;
      };
    });
    afterEach(() => {
      restore();
    });
    afterAll(async () => {
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    });

    const write = async (name: string, text: string) => {
      const { writeFile } = await import('node:fs/promises');
      const file = `${dir}/${name}`;
      await writeFile(file, text);
      return file;
    };
    const env = () => ({ IMPORTER_DATABASE_URL: urls?.importer ?? '' });

    it('imports, then no-ops, then dry-runs, with the documented exit codes', async () => {
      const file = await write('prices.csv', buildCsv(STOCKS));

      expect(await main(['--file', file], env())).toBe(EXIT.ok);
      const afterImport = await fingerprint();
      expect(await main(['--file', file], env())).toBe(EXIT.ok);
      expect(await main(['--file', file, '--dry-run'], env())).toBe(EXIT.ok);

      expect(await fingerprint()).toEqual(afterImport);
      expect((await imports()).map((i) => i.status)).toEqual(['succeeded']);
    });

    it('exits 1 on invalid data and 1 on a refused shrink', async () => {
      await main(['--file', await write('ok.csv', buildCsv(STOCKS))], env());

      expect(await main(['--file', await write('bad.csv', 'nonsense\n')], env())).toBe(
        EXIT.rejected,
      );
      expect(
        await main(
          ['--file', await write('small.csv', buildCsv([{ ticker: 'AAA', days: 1 }]))],
          env(),
        ),
      ).toBe(EXIT.rejected);
    });

    it('never logs credentials or row values', async () => {
      const file = await write(
        'secret.csv',
        buildCsv(STOCKS, [`${daysAgo(1)},SECRETVALUE,x,1,1,1,1,1`]),
      );
      await main(['--file', file], env());

      const output = logs.join('\n');
      const password = new URL(urls?.importer ?? 'postgres://x:y@z/w').password;
      expect(output).not.toContain(password);
      expect(output).not.toContain('SECRETVALUE');
      expect(output).toContain('validation failed');
    });
  });
});
