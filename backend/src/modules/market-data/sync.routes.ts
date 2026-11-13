import { Router } from 'express';
import { createSyncController } from './sync.controller.js';
import type { SyncService } from './sync.service.js';

export function syncRouter(service: SyncService): Router {
  const controller = createSyncController(service);
  const router = Router();
  router.post('/', controller.run);
  return router;
}
