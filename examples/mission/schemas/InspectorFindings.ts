import { z } from 'zod';

export default z.object({
  findings: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      severity: z.enum(['blocker', 'major', 'minor', 'nit']),
      confidence: z.number(),
      summary: z.string(),
      suggestion: z.string(),
    }),
  ),
});
