import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { WorktreeOutput } from './schemas.js';

const Input = z.object({
  issue: z.coerce.number().int(),
  slug: z.string(),
  base: z.string().default('main'),
});

function slugify(s: string, maxLen = 40): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
}

/** Create or reuse a git worktree for an issue; derive branch + path from issue+slug. */
export function makeGitWorktreeStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'git.worktree',
    match: (def) => def.step === 'git.worktree',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { issue, slug, base } = Input.parse(ctx.with);
      const slugPart = slugify(slug);
      const branch = `claude/issue-${issue}-${slugPart}`;
      const path = `.claude/worktrees/issue-${issue}-${slugPart}`;

      if (ctx.dryRun) {
        return { output: WorktreeOutput.parse({ path, branch, created: false }) };
      }

      const list = await exec(['git', 'worktree', 'list']);
      if (list.code === 0 && list.stdout.includes(`[${branch}]`)) {
        const line = list.stdout.split('\n').find((l) => l.includes(`[${branch}]`));
        const existingPath = line ? line.split(/\s+/)[0]! : path;
        return { output: WorktreeOutput.parse({ path: existingPath, branch, created: false }) };
      }

      const verify = await exec(['git', 'rev-parse', '--verify', branch]);
      const add =
        verify.code === 0
          ? await exec(['git', 'worktree', 'add', path, branch])
          : await exec(['git', 'worktree', 'add', path, '-b', branch, `origin/${base}`]);
      if (add.code !== 0) {
        throw new Error(`git worktree add failed (code ${add.code}): ${add.stderr.trim() || add.stdout.trim()}`);
      }
      return { output: WorktreeOutput.parse({ path, branch, created: true }) };
    },
  };
}
