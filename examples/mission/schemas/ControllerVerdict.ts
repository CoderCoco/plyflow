import { z } from 'zod';

export default z.object({
  task_name: z.string(),
  verdict: z.enum(['PASS', 'FAIL']),
  fixes_needed: z.array(z.string()),
});
