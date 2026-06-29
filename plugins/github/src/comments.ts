import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { CommentsOutput } from './schemas.js';

const Input = z.object({
  pr: z.coerce.number().int(),
  repo: z.string().optional(),
  since: z.string().optional(),
});

// Pinned so output shape is stable across gh versions.
const PR_FIELDS = ['number', 'merged', 'statusCheckRollup', 'reviewThreads', 'comments', 'reviews', 'url', 'headRefName', 'baseRefName', 'title'].join(',');

/** Fetch PR comments + CI status via `gh pr view --json`. */
export function makeGithubCommentsStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.comments',
    match: (def) => def.step === 'github.comments',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { pr, repo, since } = Input.parse(ctx.with);

      if (ctx.dryRun) {
        return { output: CommentsOutput.parse({ comments: [], ci: { passing: true }, merged: false }) };
      }

      const args = ['gh', 'pr', 'view', String(pr), '--json', PR_FIELDS];
      if (repo) args.push('--repo', repo);
      const r = await exec(shJoin(args));
      if (r.code !== 0) throw new Error(`gh pr view failed (code ${r.code}): ${r.stderr.trim()}`);

      const data = JSON.parse(r.stdout) as Record<string, unknown>;
      const checks = (data['statusCheckRollup'] as Array<{ state: string }> | undefined) ?? [];
      const passing = checks.length === 0 || checks.every((c) => c.state === 'SUCCESS');

      let comments = (data['comments'] as Array<{ createdAt?: string }> | undefined) ?? [];
      if (since) {
        const cutoff = new Date(since).getTime();
        comments = comments.filter((c) => (c.createdAt ? new Date(c.createdAt).getTime() > cutoff : true));
      }

      // Spread the raw pinned fields first, then override the derived ones, so
      // headRefName/reviewThreads/etc. pass through to consumers.
      return {
        output: CommentsOutput.parse({ ...data, comments, ci: { passing }, merged: Boolean(data['merged']) }),
      };
    },
  };
}
