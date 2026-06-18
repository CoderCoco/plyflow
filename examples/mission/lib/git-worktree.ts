import { defaultExec } from './exec.js';
import type { Exec } from './exec.js';

export interface GitWorktreeInput {
  issue: number;
  slug: string;
  base?: string;
}

export interface GitWorktreeResult {
  branch: string;
  worktree_path: string;
}

function slugify(s: string, maxLen = 40): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
}

export default async function gitWorktree(
  input: GitWorktreeInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<GitWorktreeResult> {
  const { issue, slug, base = 'main' } = input;
  const slugPart = slugify(slug);
  const branch = `claude/issue-${issue}-${slugPart}`;
  const worktree_path = `.claude/worktrees/issue-${issue}-${slugPart}`;

  // Check if the branch/worktree already exists via `git worktree list`
  const { stdout: listOut } = await exec('git', ['worktree', 'list']);
  if (listOut.includes(branch)) {
    return { branch, worktree_path };
  }

  // Check if the branch ref already exists (but worktree was removed)
  const { code: verifyCode } = await exec('git', ['rev-parse', '--verify', branch]);

  if (verifyCode === 0) {
    // Branch exists — add worktree without -b
    await exec('git', ['worktree', 'add', worktree_path, branch]);
  } else {
    // Branch does not exist — create it from origin/<base>
    await exec('git', ['worktree', 'add', worktree_path, '-b', branch, `origin/${base}`]);
  }

  return { branch, worktree_path };
}
