import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
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
      const status = await exec(['git', 'status', '--porcelain'], opts);
      if (status.code !== 0) {
        throw new Error(`git status failed (code ${status.code}): ${status.stderr.trim()}`);
      }
      if (status.stdout.trim() === '') {
        return { output: CommitOutput.parse({ committed: false }) };
      }

      const add = await exec(['git', 'add', '-A'], opts);
      if (add.code !== 0) throw new Error(`git add -A failed (code ${add.code}): ${add.stderr.trim()}`);

      const commit = await exec(['git', 'commit', '-m', message], opts);
      if (commit.code !== 0) throw new Error(`git commit failed (code ${commit.code}): ${commit.stderr.trim()}`);

      const rev = await exec(['git', 'rev-parse', 'HEAD'], opts);
      if (rev.code !== 0) throw new Error(`git rev-parse HEAD failed (code ${rev.code}): ${rev.stderr.trim()}`);
      const sha = rev.stdout.trim();
      return { output: CommitOutput.parse({ committed: true, sha }) };
    },
  };
}
