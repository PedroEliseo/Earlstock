import { metrics, ValueType } from '@opentelemetry/api';
import type { Pool } from 'pg';
import { poolStats } from './pool.js';

/**
 * Connection-pool gauges read from the pool itself when metrics are collected (no database call).
 *
 * They replace the pg instrumentation's db.client.connection.* metrics, which are updated from pool
 * events, so they lag one event behind (a released connection still counts as used until the next
 * event) and report max 0 when the pool ends; telemetry/register.mjs drops those with metric views. They carry no attributes besides the connection state: no host, database
 * or connection string.
 *
 * - earlstock.db.pool.connections {connection}, state = used | idle: open connections.
 * - earlstock.db.pool.pending_requests {request}: queries waiting for a free connection.
 * - earlstock.db.pool.max_connections {connection}: configured upper bound of the pool.
 *
 * Nothing is reported once the pool is closing, so shutdown does not record an empty pool as data.
 * Without the telemetry preload the meter is a no-op and this registers nothing.
 */
export function observePool(pool: Pool, maxConnections: number): void {
  const meter = metrics.getMeter('earlstock');
  const connections = meter.createObservableGauge('earlstock.db.pool.connections', {
    description: 'Open connections in the API database pool, by state (used or idle).',
    unit: '{connection}',
    valueType: ValueType.INT,
  });
  const pending = meter.createObservableGauge('earlstock.db.pool.pending_requests', {
    description: 'Requests waiting for a free connection in the API database pool.',
    unit: '{request}',
    valueType: ValueType.INT,
  });
  const max = meter.createObservableGauge('earlstock.db.pool.max_connections', {
    description: 'Configured maximum number of connections in the API database pool.',
    unit: '{connection}',
    valueType: ValueType.INT,
  });

  meter.addBatchObservableCallback(
    (result) => {
      if (pool.ending) return;
      // One read, so the three gauges describe the same instant.
      const { total, idle, waiting } = poolStats(pool);
      result.observe(connections, total - idle, { state: 'used' });
      result.observe(connections, idle, { state: 'idle' });
      result.observe(pending, waiting);
      result.observe(max, maxConnections);
    },
    [connections, pending, max],
  );
}
