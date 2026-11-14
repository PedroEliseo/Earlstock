/**
 * Minimal structured logger: one JSON object per line (JSON Lines). Deliberately dependency-free;
 * it is the single place to swap in a full logger (e.g. pino with ECS formatting) later.
 * Never pass SQL text, query parameters or credentials as fields.
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export type LogWriter = (level: LogLevel, line: string) => void;

const writeToConsole: LogWriter = (level, line) => {
  if (level === 'info') console.log(line);
  else console.error(line);
};

export function createLogger(write: LogWriter = writeToConsole): Logger {
  const log = (level: LogLevel, message: string, fields: LogFields = {}) => {
    write(level, JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
  };
  return {
    info: (message, fields) => {
      log('info', message, fields);
    },
    warn: (message, fields) => {
      log('warn', message, fields);
    },
    error: (message, fields) => {
      log('error', message, fields);
    },
  };
}

export const logger = createLogger();

/**
 * A log-safe view of an error and its cause chain: name, message, code and stack, plus selected
 * context. Driver-specific fields that can contain data (e.g. PostgreSQL's `detail`) are omitted.
 */
export function serializeError(err: unknown, depth = 0): LogFields {
  // Duck-typed rather than `instanceof Error`: errors from Node internals or drivers may come from
  // another JavaScript realm.
  if (typeof err !== 'object' || err === null || !('message' in err)) return { value: String(err) };
  const source = err as Record<string, unknown>;
  const fields: LogFields = {
    name: typeof source['name'] === 'string' ? source['name'] : 'Error',
    message: String(source['message']),
  };
  if (typeof source['code'] === 'string') fields['code'] = source['code'];
  if (typeof source['context'] === 'object' && source['context'] !== null) {
    fields['context'] = source['context'];
  }
  if (typeof source['stack'] === 'string') fields['stack'] = source['stack'];
  if (source['cause'] !== undefined && depth < 3) {
    fields['cause'] = serializeError(source['cause'], depth + 1);
  }
  return fields;
}
