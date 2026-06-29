import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { PushOutput } from './schemas.js';

const Input = z.object({
  path: z.string(),
  branch: z.string().optional(),
  setUpstream: z.boolean().default(true),
});

/** Push a branch to origin; resolves the current branch if none is given. */
export function makeGitPushStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'git.push',
    match: (def) => def.step === 'git.push',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { path, branch, setUpstream } = Input.parse(ctx.with);
      const opts = { cwd: path };

      if (ctx.dryRun) {
        return { output: PushOutput.parse({ pushed: true, ref: branch ?? 'HEAD' }) };
      }

      let ref = branch;
      if (!ref) {
        const head = await exec(shJoin(['git', 'rev-parse', '--abbrev-ref', 'HEAD']), opts);
        if (head.code !== 0) throw new Error(`git rev-parse failed (code ${head.code}): ${head.stderr.trim()}`);
        ref = head.stdout.trim();
      }

      const args = ['git', 'push'];
      if (setUpstream) args.push('-u');
      args.push('origin', ref);
      const push = await exec(shJoin(args), opts);
      if (push.code !== 0) throw new Error(`git push failed (code ${push.code}): ${push.stderr.trim()}`);

      return { output: PushOutput.parse({ pushed: true, ref }) };
    },
  };
}
