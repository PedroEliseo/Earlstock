import type { z } from 'zod';
import { ValidationError } from '../errors.js';

/** Parses untrusted request input, throwing a ValidationError (-> 400) with per-field issues. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
