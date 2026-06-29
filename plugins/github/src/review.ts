import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { ReviewOutput } from './schemas.js';

const Input = z.object({
  pr: z.coerce.number().int(),
  repo: z.string().optional(),
  comment: z.string().optional(),
  reRequest: z.array(z.string()).optional(),
  resolveThread: z.string().optional(),
});

/** Perform exactly one PR review action: comment | reRequest | resolveThread. */
export function makeGithubReviewStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.review',
    match: (def) => def.step === 'github.review',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { pr, repo, comment, reRequest, resolveThread } = Input.parse(ctx.with);
      const chosen = [comment !== undefined, reRequest !== undefined, resolveThread !== undefined].filter(Boolean).length;
      if (chosen !== 1) {
        throw new Error('github.review requires exactly one of: comment | reRequest | resolveThread');
      }

      const repoArgs = repo ? ['--repo', repo] : [];

      if (ctx.dryRun) {
        if (comment !== undefined) return { output: ReviewOutput.parse({ action: 'comment', body: comment }) };
        if (reRequest !== undefined) return { output: ReviewOutput.parse({ action: 'reRequest', reviewers: reRequest }) };
        return { output: ReviewOutput.parse({ action: 'resolveThread', resolved: true }) };
      }

      if (comment !== undefined) {
        const r = await exec(shJoin(['gh', 'pr', 'comment', String(pr), '--body', comment, ...repoArgs]));
        if (r.code !== 0) throw new Error(`gh pr comment failed (code ${r.code}): ${r.stderr.trim()}`);
        return { output: ReviewOutput.parse({ action: 'comment', body: comment }) };
      }

      if (reRequest !== undefined) {
        const args = ['gh', 'pr', 'edit', String(pr), ...repoArgs];
        for (const reviewer of reRequest) args.push('--add-reviewer', reviewer);
        const r = await exec(shJoin(args));
        if (r.code !== 0) throw new Error(`gh pr edit failed (code ${r.code}): ${r.stderr.trim()}`);
        return { output: ReviewOutput.parse({ action: 'reRequest', reviewers: reRequest }) };
      }

      const r = await exec(shJoin(['gh', 'api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}', '-f', `id=${resolveThread!}`]));
      if (r.code !== 0) throw new Error(`gh api resolveReviewThread failed (code ${r.code}): ${r.stderr.trim()}`);
      return { output: ReviewOutput.parse({ action: 'resolveThread', resolved: true }) };
    },
  };
}
