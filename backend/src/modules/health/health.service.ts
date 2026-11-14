import type { Logger } from '../../shared/logger.js';
import { serializeError } from '../../shared/logger.js';
import type { DatasetRepository } from '../dataset/dataset.repository.js';

export interface ReadinessReport {
  ready: boolean;
  checks: {
    database: 'up' | 'down';
    dataset: 'loaded' | 'empty' | 'unknown';
    privileges: 'ok' | 'excessive' | 'unknown';
  };
}

/**
 * Ready = the database answers, a dataset snapshot is active, and the connected role is
 * least-privileged. Details (errors, which privileges are excessive) go to logs, never to the
 * response.
 */
export function createReadinessCheck(
  dataset: Pick<DatasetRepository, 'getStatus' | 'findPrivilegeViolations'>,
  logger: Logger,
) {
  return async function checkReadiness(): Promise<ReadinessReport> {
    try {
      const status = await dataset.getStatus();
      const violations = await dataset.findPrivilegeViolations();
      if (violations.length > 0) {
        logger.error('database role has excessive privileges', { violations });
      }
      const checks = {
        database: 'up',
        dataset: status.snapshot ? 'loaded' : 'empty',
        privileges: violations.length === 0 ? 'ok' : 'excessive',
      } as const;
      return { ready: checks.dataset === 'loaded' && checks.privileges === 'ok', checks };
    } catch (err) {
      logger.warn('readiness check failed', { error: serializeError(err) });
      return {
        ready: false,
        checks: { database: 'down', dataset: 'unknown', privileges: 'unknown' },
      };
    }
  };
}
