import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { DiffOutput } from './schemas.js';

const Input = z.object({ path: z.string(), base: z.string().default('main') });

/** Changed files + patch for a worktree against origin/<base>...HEAD. */
export function makeGitDiffStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'git.diff',
    match: (def) => def.step === 'git.diff',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { path, base } = Input.parse(ctx.with);
      const opts = { cwd: path };
      const range = `origin/${base}...HEAD`;

      if (ctx.dryRun) {
        return { output: DiffOutput.parse({ files: [], patch: '' }) };
      }

      const names = await exec(shJoin(['git', 'diff', '--name-only', range]), opts);
      if (names.code !== 0) throw new Error(`git diff --name-only failed (code ${names.code}): ${names.stderr.trim()}`);
      const files = names.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');

      const patchRes = await exec(shJoin(['git', 'diff', range]), opts);
      if (patchRes.code !== 0) throw new Error(`git diff failed (code ${patchRes.code}): ${patchRes.stderr.trim()}`);

      return { output: DiffOutput.parse({ files, patch: patchRes.stdout }) };
    },
  };
}
