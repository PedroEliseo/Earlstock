import { Router } from 'express';
import { getHealth, getReadiness, type HealthDependencies } from './health.controller.js';

export function healthRouter(deps: HealthDependencies): Router {
  const router = Router();
  router.get('/', getHealth);
  router.get('/ready', getReadiness(deps));
  return router;
}
