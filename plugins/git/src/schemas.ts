import { z } from 'zod';

export const WorktreeOutput = z.object({
  path: z.string(),
  branch: z.string(),
  created: z.boolean(),
});

export const CommitOutput = z.object({
  committed: z.boolean(),
  sha: z.string().optional(),
});

export const PushOutput = z.object({
  pushed: z.boolean(),
  ref: z.string(),
});

export const DiffOutput = z.object({
  files: z.array(z.string()),
  patch: z.string().optional(),
});
