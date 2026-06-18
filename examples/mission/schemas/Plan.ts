import { z } from 'zod';

export default z.object({
  issue_title: z.string(),
  branch: z.string(),
  worktree_path: z.string(),
  tasks: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      files: z.array(z.string()),
      depends_on: z.array(z.string()),
      acceptance: z.string(),
    }),
  ),
  open_questions: z.array(z.string()),
});
