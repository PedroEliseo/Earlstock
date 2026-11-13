import { z } from 'zod';

export const stockIdParamsSchema = z.object({ id: z.uuid() });
