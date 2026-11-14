import type { Request, RequestHandler, Response } from 'express';
import type { ReadinessReport } from './health.service.js';

export interface HealthDependencies {
  checkReadiness: () => Promise<ReadinessReport>;
}

/** Liveness: the process is up and serving HTTP. Deliberately independent of the database. */
export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

/** Readiness: the service can do useful work (see createReadinessCheck). */
export function getReadiness({ checkReadiness }: HealthDependencies): RequestHandler {
  return async (_req, res) => {
    const { ready, checks } = await checkReadiness();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', checks });
  };
}
