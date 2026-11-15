/**
 * Structured logger: one JSON object per line (JSON Lines) on stdout/stderr, and, when the optional
 * EDOT preload is active, the same record through the OpenTelemetry Logs API (exported by EDOT's own
 * batched OTLP processor; nothing is exported without the preload).
 *
 * Every line has `time`, `level` and `message`; `service.name` when OTEL_SERVICE_NAME is set; and
 * `trace_id`/`span_id` when logged inside an active span, so a log line can be matched to its trace.
 * Never pass SQL text, query parameters, credentials or request bodies as fields.
 */
import { isSpanContextValid, trace } from '@opentelemetry/api';
import { type AnyValueMap, logs, SeverityNumber } from '@opentelemetry/api-logs';
import { isTelemetryShuttingDown } from './telemetry.js';

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

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

/** Resolved on each call: a no-op until EDOT registers its LoggerProvider (never, without it). */
function otelLogger() {
  return logs.getLogger('earlstock');
}

export function createLogger(write: LogWriter = writeToConsole): Logger {
  const serviceName = process.env['OTEL_SERVICE_NAME'] || undefined;

  const log = (level: LogLevel, message: string, fields: LogFields = {}) => {
    const time = new Date();
    const safeFields = normalizeFields(fields);
    const spanContext = trace.getActiveSpan()?.spanContext();
    const correlation =
      spanContext && isSpanContextValid(spanContext)
        ? { trace_id: spanContext.traceId, span_id: spanContext.spanId }
        : {};

    // Reserved keys come first and cannot be overwritten by a field of the same name.
    const line: LogFields = {
      time: time.toISOString(),
      level,
      message,
      ...(serviceName ? { 'service.name': serviceName } : {}),
      ...correlation,
    };
    for (const [key, value] of Object.entries(safeFields)) {
      if (!(key in line)) line[key] = value;
    }
    write(level, JSON.stringify(line));

    // The record carries the active context, so the exported log is correlated with its trace by
    // the SDK; no ids are added by hand. service.name comes from the SDK's resource.
    if (isTelemetryShuttingDown()) return;
    otelLogger().emit({
      timestamp: time,
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: toLogAttributes(safeFields),
    });
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

const MAX_DEPTH = 5;

/**
 * Predictable, JSON-safe values: `undefined`, functions and symbols are dropped (null inside
 * arrays, as JSON does); bigint becomes a string; non-finite numbers become strings; dates become
 * ISO strings; Error objects go through serializeError (never their arbitrary own properties);
 * cycles and nesting beyond MAX_DEPTH are replaced by a marker. Plain values pass through unchanged.
 */
function normalizeFields(fields: LogFields): LogFields {
  const result = normalizeValue(fields, 0, new WeakSet());
  return typeof result === 'object' && result !== null && !Array.isArray(result) ? result : {};
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function normalizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): JsonValue | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (value === null) return null;
  const object = value as object;
  if (object instanceof Date) {
    return Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString();
  }
  if (seen.has(object)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(object);
  try {
    if (object instanceof Error) {
      return normalizeValue(serializeError(object), depth + 1, seen);
    }
    if (Array.isArray(object)) {
      return object.map((item) => normalizeValue(item, depth + 1, seen) ?? null);
    }
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(object)) {
      const normalized = normalizeValue(item, depth + 1, seen);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/**
 * Log record attributes: nested objects become dotted keys (`pool.total`); arrays of primitives are
 * kept; other arrays become JSON strings. A top-level serialized `error` uses the OpenTelemetry
 * exception attributes (exception.type / exception.message / exception.stacktrace).
 */
function toLogAttributes(fields: LogFields): AnyValueMap {
  const attributes: AnyValueMap = {};
  const add = (prefix: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      const primitive = value.every((v) => ['string', 'number', 'boolean'].includes(typeof v));
      attributes[prefix] = primitive
        ? (value as (string | number | boolean)[])
        : JSON.stringify(value);
    } else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) add(`${prefix}.${key}`, item);
    } else {
      attributes[prefix] = value as string | number | boolean;
    }
  };

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'error' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const { name, message, stack, ...rest } = value as Record<string, unknown>;
      if (typeof name === 'string') attributes['exception.type'] = name;
      if (typeof message === 'string') attributes['exception.message'] = message;
      if (typeof stack === 'string') attributes['exception.stacktrace'] = stack;
      add('error', rest);
    } else {
      add(key, value);
    }
  }
  return attributes;
}
