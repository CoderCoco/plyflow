import { z } from 'zod';

export default z.object({
  buckets: z.array(z.string()),
  changed_files: z.array(z.string()),
  specialists: z.array(z.string()),
});
