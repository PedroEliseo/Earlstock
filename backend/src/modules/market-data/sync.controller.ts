import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validation.js';
import { syncRequestSchema } from './sync.schemas.js';
import type { SyncService } from './sync.service.js';

export function createSyncController(service: SyncService) {
  return {
    run: async (req, res) => {
      // Express leaves req.body undefined when the request has no JSON body.
      const request = parseInput(syncRequestSchema, req.body ?? {});
      res.json({ data: await service.run(request) });
    },
  } satisfies Record<string, RequestHandler>;
}
