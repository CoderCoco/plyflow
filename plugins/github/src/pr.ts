import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { PrOutput } from './schemas.js';

const Input = z.object({
  title: z.string(),
  body: z.string(),
  head: z.string(),
  base: z.string().default('main'),
  repo: z.string().optional(),
});

/** Create a PR for `head`, or reuse the open one if it already exists. */
export function makeGithubPrStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.pr',
    match: (def) => def.step === 'github.pr',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { title, body, head, base, repo } = Input.parse(ctx.with);

      if (ctx.dryRun) {
        return { output: PrOutput.parse({ number: 0, url: 'https://github.com/dry-run/pull/0', created: false }) };
      }

      const listArgs = ['gh', 'pr', 'list', '--head', head, '--json', 'number,url'];
      if (repo) listArgs.push('--repo', repo);
      const list = await exec(shJoin(listArgs));
      if (list.code !== 0) throw new Error(`gh pr list failed (code ${list.code}): ${list.stderr.trim()}`);

      const existing = JSON.parse(list.stdout) as Array<{ number: number; url: string }>;
      if (existing.length > 0) {
        const pr = existing[0]!;
        return { output: PrOutput.parse({ number: pr.number, url: pr.url, created: false }) };
      }

      const createArgs = ['gh', 'pr', 'create', '--title', title, '--body', body, '--base', base, '--head', head];
      if (repo) createArgs.push('--repo', repo);
      const create = await exec(shJoin(createArgs));
      if (create.code !== 0) throw new Error(`gh pr create failed (code ${create.code}): ${create.stderr.trim()}`);

      const url = create.stdout.trim();
      const m = url.match(/\/pull\/(\d+)\b/);
      if (!m) throw new Error(`could not parse PR number from gh pr create output: ${url}`);
      return { output: PrOutput.parse({ number: parseInt(m[1]!, 10), url, created: true }) };
    },
  };
}
