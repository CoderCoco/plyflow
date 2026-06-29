import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { IssueOutput } from './schemas.js';

const Input = z.object({ number: z.coerce.number().int(), repo: z.string().optional() });
const ISSUE_FIELDS = 'number,title,body';

/** Read a GitHub issue via `gh issue view --json number,title,body`. */
export function makeGithubIssueStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.issue',
    match: (def) => def.step === 'github.issue',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { number, repo } = Input.parse(ctx.with);

      if (ctx.dryRun) {
        return { output: IssueOutput.parse({ number, title: 'dry-run issue', body: 'dry-run placeholder body' }) };
      }

      const args = ['gh', 'issue', 'view', String(number), '--json', ISSUE_FIELDS];
      if (repo) args.push('--repo', repo);
      const r = await exec(shJoin(args));
      if (r.code !== 0) throw new Error(`gh issue view failed (code ${r.code}): ${r.stderr.trim()}`);

      const data = JSON.parse(r.stdout) as { number: number; title: string; body: string };
      return { output: IssueOutput.parse({ number: data.number, title: data.title, body: data.body }) };
    },
  };
}
