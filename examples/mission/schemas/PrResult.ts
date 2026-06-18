import { z } from 'zod';

export default z.object({
  pr_number: z.number(),
  pr_url: z.string(),
});
