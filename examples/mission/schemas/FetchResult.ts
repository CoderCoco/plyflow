import { z } from 'zod';

export default z.object({
  merged: z.boolean(),
  ci_passing: z.boolean(),
  all_threads_resolved: z.boolean(),
  new_comments: z.array(z.unknown()),
  open_threads: z.array(z.unknown()),
  viewer_login: z.string(),
});
