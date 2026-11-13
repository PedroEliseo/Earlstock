import type { Request, RequestHandler, Response } from 'express';

export interface HealthDependencies {
  checkDatabase: () => Promise<boolean>;
}

/** Liveness: the process is up and serving HTTP. Deliberately independent of the database. */
export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

/** Readiness: the service can do useful work, i.e. its dependencies are reachable. */
export function getReadiness({ checkDatabase }: HealthDependencies): RequestHandler {
  return async (_req, res) => {
    const databaseUp = await checkDatabase();
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? 'ok' : 'unavailable',
      checks: { database: databaseUp ? 'up' : 'down' },
    });
  };
}
