import { z } from 'zod';

export default z.object({
  task_name: z.string(),
  status: z.enum(['done', 'plan_problem']),
  files_modified: z.array(z.string()),
  summary: z.string(),
  plan_problem_description: z.string().optional(),
});
