import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';

/**
 * Upper bound on the input size. The whole file is held in memory so that the SHA-256 and the
 * validated rows come from the same bytes; this limit keeps that memory bounded. It is far above
 * the current dataset's size and can be raised deliberately if a larger dataset is ever imported.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface DatasetFile {
  /** Base name only (data_imports.source_file never stores a path). */
  fileName: string;
  sizeBytes: number;
  sha256: string;
  bytes: Buffer;
}

export class DatasetFileError extends Error {
  override readonly name = 'DatasetFileError';
}

/** Reads a regular file once, checking its size first, and hashes exactly the bytes read. */
export async function readDatasetFile(
  filePath: string,
  maxBytes: number = MAX_FILE_BYTES,
): Promise<DatasetFile> {
  const fileName = path.basename(filePath);
  if (fileName === '' || fileName.length > 255) {
    throw new DatasetFileError('the file name must be 1-255 characters long');
  }
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch (err) {
    throw new DatasetFileError(`cannot open the dataset file: ${(err as Error).message}`, {
      cause: err,
    });
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new DatasetFileError('the dataset path is not a regular file');
    if (info.size > maxBytes) {
      throw new DatasetFileError(
        `the dataset file is ${String(info.size)} bytes, above the ${String(maxBytes)}-byte limit`,
      );
    }
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) {
      throw new DatasetFileError('the dataset file grew beyond the size limit while being read');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { fileName, sizeBytes: bytes.length, sha256, bytes };
  } finally {
    await handle.close();
  }
}
