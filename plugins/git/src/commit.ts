import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { CommitOutput } from './schemas.js';

const Input = z.object({ path: z.string(), message: z.string() });

/** Stage all changes and commit in the worktree; clean tree → committed:false. */
export function makeGitCommitStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'git.commit',
    match: (def) => def.step === 'git.commit',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { path, message } = Input.parse(ctx.with);

      if (ctx.dryRun) {
        return { output: CommitOutput.parse({ committed: true, sha: '0'.repeat(40) }) };
      }

      const opts = { cwd: path };
      const status = await exec(shJoin(['git', 'status', '--porcelain']), opts);
      if (status.code !== 0) {
        throw new Error(`git status failed (code ${status.code}): ${status.stderr.trim()}`);
      }
      if (status.stdout.trim() === '') {
        return { output: CommitOutput.parse({ committed: false }) };
      }

      const add = await exec(shJoin(['git', 'add', '-A']), opts);
      if (add.code !== 0) throw new Error(`git add -A failed (code ${add.code}): ${add.stderr.trim()}`);

      const commit = await exec(shJoin(['git', 'commit', '-m', message]), opts);
      if (commit.code !== 0) throw new Error(`git commit failed (code ${commit.code}): ${commit.stderr.trim()}`);

      const rev = await exec(shJoin(['git', 'rev-parse', 'HEAD']), opts);
      const sha = rev.code === 0 ? rev.stdout.trim() : undefined;
      return { output: CommitOutput.parse({ committed: true, sha }) };
    },
  };
}
