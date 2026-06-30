import { defaultShellExec, type ShellExec, type StepRegistry } from '@plyflow/core';
import { makeGitWorktreeStep } from './worktree.js';
import { makeGitCommitStep } from './commit.js';
import { makeGitPushStep } from './push.js';
import { makeGitDiffStep } from './diff.js';

/** Register all git.* steps wired to a specific ShellExec (used by tests with mockExec). */
export function registerWith(registry: StepRegistry, exec: ShellExec): void {
  registry.register(makeGitWorktreeStep(exec));
  registry.register(makeGitCommitStep(exec));
  registry.register(makeGitPushStep(exec));
  registry.register(makeGitDiffStep(exec));
}

/** Plugin entry: plyflow calls this with the run's step registry. */
export default function register(registry: StepRegistry): void {
  registerWith(registry, defaultShellExec);
}
