import { jest } from '@jest/globals';
import { EXIT, exitCodeFor, main } from './cli.js';

describe('importer CLI (no database)', () => {
  const output = jest.spyOn(console, 'log');
  const errors = jest.spyOn(console, 'error');
  beforeEach(() => {
    output.mockImplementation(() => undefined);
    errors.mockImplementation(() => undefined);
  });
  afterAll(() => {
    output.mockRestore();
    errors.mockRestore();
  });

  const env = { IMPORTER_DATABASE_URL: 'postgres://importer:pw@127.0.0.1:1/unreachable' };

  it('prints usage with --help', async () => {
    expect(await main(['--help'], env)).toBe(EXIT.ok);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('--allow-shrink'));
  });

  it.each([[[]], [['--file']], [['--unknown']], [['positional.csv']]])(
    'rejects invalid arguments %j with the usage exit code',
    async (argv) => {
      expect(await main(argv, env)).toBe(EXIT.usage);
    },
  );

  it('refuses to start without IMPORTER_DATABASE_URL', async () => {
    expect(await main(['--file', 'whatever.csv'], {})).toBe(EXIT.usage);
  });

  it('refuses an unreadable file before connecting', async () => {
    expect(await main(['--file', 'definitely-missing.csv'], env)).toBe(EXIT.usage);
  });

  it('maps outcomes to exit codes', () => {
    expect(exitCodeFor({ status: 'unchanged', activeImportId: 1 })).toBe(EXIT.ok);
    expect(exitCodeFor({ status: 'busy' })).toBe(EXIT.busy);
    expect(
      exitCodeFor({
        status: 'rejected',
        reason: 'shrink',
        importId: 1,
        rowsRead: 1,
        dryRun: false,
      }),
    ).toBe(EXIT.rejected);
  });
});
