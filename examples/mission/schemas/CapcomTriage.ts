import { z } from 'zod';

export default z.object({
  comments: z.array(
    z.object({
      id: z.string(),
      category: z.enum(['actionable', 'question', 'acknowledge', 'ignore', 'ambiguous']),
      fix_hint: z.string().optional(),
      reply_draft: z.string().optional(),
    }),
  ),
});
