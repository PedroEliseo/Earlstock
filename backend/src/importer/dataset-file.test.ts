import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatasetFileError, readDatasetFile } from './dataset-file.js';

describe('readDatasetFile', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'earlstock-dataset-file-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('returns the base name, size, bytes and the SHA-256 of exactly those bytes', async () => {
    const file = path.join(dir, 'prices.csv');
    const content = Buffer.from('date,ticker\n');
    await writeFile(file, content);

    const result = await readDatasetFile(file);

    expect(result.fileName).toBe('prices.csv');
    expect(result.sizeBytes).toBe(content.length);
    expect(result.bytes.equals(content)).toBe(true);
    expect(result.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the empty file (validation, not reading, rejects it)', async () => {
    const file = path.join(dir, 'empty.csv');
    await writeFile(file, '');
    expect((await readDatasetFile(file)).sha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('refuses files above the size limit before reading them', async () => {
    const file = path.join(dir, 'big.csv');
    await writeFile(file, 'x'.repeat(11));
    await expect(readDatasetFile(file, 10)).rejects.toThrow(/above the 10-byte limit/);
  });

  it('refuses a missing file and a directory', async () => {
    await expect(readDatasetFile(path.join(dir, 'missing.csv'))).rejects.toBeInstanceOf(
      DatasetFileError,
    );
    await expect(readDatasetFile(dir)).rejects.toThrow(/not a regular file/);
  });
});
