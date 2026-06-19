import { defaultExec } from './exec.js';
import type { Exec } from './exec.js';

export interface GitPushInput {
  worktree_path: string;
  branch: string;
}

export interface GitPushResult {
  pushed: true;
}

/**
 * Push the branch to origin, setting the upstream tracking ref.
 */
export default async function gitPush(
  input: GitPushInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<GitPushResult> {
  // Dry-run: skip the push.
  if (process.env.MISSION_DRYRUN === '1') {
    return { pushed: true };
  }

  const { code, stderr } = await exec(
    'git',
    ['push', '-u', 'origin', input.branch],
    { cwd: input.worktree_path },
  );
  if (code !== 0) {
    throw new Error(`git push failed (code ${code}): ${stderr}`);
  }
  return { pushed: true };
}
