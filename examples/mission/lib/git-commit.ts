import { defaultExec } from './exec.js';
import type { Exec } from './exec.js';

export interface GitCommitInput {
  worktree_path: string;
  message: string;
}

export interface GitCommitResult {
  committed: boolean;
  sha?: string;
}

/**
 * Build a conventional-commit message for a mission task.
 *   feat: <taskName> — <title>
 *
 *   Refs #<issue>
 */
export function buildTaskCommitMessage(
  taskName: string,
  title: string,
  issue: number,
): string {
  return `feat: ${taskName} — ${title}\n\nRefs #${issue}`;
}

/**
 * Stage all changes and commit with the given message in the worktree.
 * Returns { committed: false } when there is nothing to commit (clean tree).
 */
export default async function gitCommit(
  input: GitCommitInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<GitCommitResult> {
  const cwd = input.worktree_path;

  // Check porcelain status — empty means nothing to commit
  const statusResult = await exec('git', ['status', '--porcelain'], { cwd });
  if (statusResult.code !== 0) {
    throw new Error(`git status failed (code ${statusResult.code}): ${statusResult.stderr}`);
  }
  if (statusResult.stdout.trim() === '') {
    return { committed: false };
  }

  // Stage all changes
  const addResult = await exec('git', ['add', '-A'], { cwd });
  if (addResult.code !== 0) {
    throw new Error(`git add -A failed (code ${addResult.code}): ${addResult.stderr}`);
  }

  // Commit
  const commitResult = await exec('git', ['commit', '-m', input.message], { cwd });
  if (commitResult.code !== 0) {
    throw new Error(`git commit failed (code ${commitResult.code}): ${commitResult.stderr}`);
  }

  // Optionally parse SHA
  const revResult = await exec('git', ['rev-parse', 'HEAD'], { cwd });
  const sha = revResult.code === 0 ? revResult.stdout.trim() : undefined;

  return { committed: true, sha };
}
