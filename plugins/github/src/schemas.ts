import { z } from 'zod';

export const IssueOutput = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
});

export const PrOutput = z.object({
  number: z.number(),
  url: z.string(),
  created: z.boolean(),
});

// Passthrough so the raw pinned `gh pr view` fields (headRefName, reviewThreads,
// reviews, url, title, baseRefName) remain available to consumers that need
// them (e.g. mission's comms workflow pushes `headRefName`).
export const CommentsOutput = z
  .object({
    comments: z.array(z.unknown()),
    ci: z.object({ passing: z.boolean() }),
    merged: z.boolean(),
    headRefName: z.string().optional(),
  })
  .passthrough();

export const ReviewOutput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comment'), body: z.string() }),
  z.object({ action: z.literal('reRequest'), reviewers: z.array(z.string()) }),
  z.object({ action: z.literal('resolveThread'), resolved: z.boolean() }),
]);
