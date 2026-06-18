import { describe, it, expect } from 'vitest';
import type { Exec } from './exec.js';

// ---------------------------------------------------------------------------
// Fake Exec helper
// ---------------------------------------------------------------------------

interface FakeCall {
  cmd: string;
  args: string[];
  opts?: { cwd?: string };
}

function makeFakeExec(
  responses: Array<{ stdout: string; stderr?: string; code?: number }>,
): { exec: Exec; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let idx = 0;
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const r = responses[idx++] ?? { stdout: '', stderr: '', code: 0 };
    return { stdout: r.stdout, stderr: r.stderr ?? '', code: r.code ?? 0 };
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// ghIssue tests
// ---------------------------------------------------------------------------

describe('ghIssue', () => {
  it('calls gh issue view with the right args and parses JSON', async () => {
    const { exec, calls } = makeFakeExec([
      {
        stdout: JSON.stringify({ number: 42, title: 'Fix the bug', body: 'It is broken.' }),
        code: 0,
      },
    ]);

    const ghIssue = (await import('./gh-issue.js')).default;
    const result = await ghIssue({ issue: 42 }, undefined, exec);

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('gh');
    expect(calls[0].args).toContain('issue');
    expect(calls[0].args).toContain('view');
    expect(calls[0].args).toContain('42');
    expect(calls[0].args).toContain('--json');
    expect(calls[0].args).toContain('number,title,body');
    // no --repo when not provided
    expect(calls[0].args).not.toContain('--repo');

    expect(result).toEqual({ number: 42, title: 'Fix the bug', body: 'It is broken.', repo: undefined });
  });

  it('includes --repo when provided', async () => {
    const { exec, calls } = makeFakeExec([
      {
        stdout: JSON.stringify({ number: 7, title: 'Feature', body: 'Cool feature.' }),
        code: 0,
      },
    ]);

    const ghIssue = (await import('./gh-issue.js')).default;
    const result = await ghIssue({ issue: 7, repo: 'owner/repo' }, undefined, exec);

    const repoIdx = calls[0].args.indexOf('--repo');
    expect(repoIdx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[repoIdx + 1]).toBe('owner/repo');
    expect(result.repo).toBe('owner/repo');
  });

  it('throws when gh exits with non-zero code', async () => {
    const { exec } = makeFakeExec([{ stdout: '', stderr: 'not found', code: 1 }]);
    const ghIssue = (await import('./gh-issue.js')).default;
    await expect(ghIssue({ issue: 999 }, undefined, exec)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// gitWorktree tests
// ---------------------------------------------------------------------------

describe('gitWorktree', () => {
  it('issues git worktree add when worktree does not exist', async () => {
    const { exec, calls } = makeFakeExec([
      // git worktree list — not found
      { stdout: '', code: 0 },
      // git rev-parse --verify (branch doesn't exist)
      { stdout: '', code: 1 },
      // git worktree add
      { stdout: '', code: 0 },
    ]);

    const gitWorktree = (await import('./git-worktree.js')).default;
    const result = await gitWorktree({ issue: 5, slug: 'Add login page' }, undefined, exec);

    expect(result.branch).toBe('claude/issue-5-add-login-page');
    expect(result.worktree_path).toContain('issue-5');

    // find the worktree add call
    const addCall = calls.find(
      (c) => c.cmd === 'git' && c.args.includes('add') && c.args.includes('-b'),
    );
    expect(addCall).toBeDefined();
    expect(addCall!.args).toContain('claude/issue-5-add-login-page');
    expect(addCall!.args).toContain('origin/main');
  });

  it('uses custom base branch when provided', async () => {
    const { exec, calls } = makeFakeExec([
      { stdout: '', code: 0 },
      { stdout: '', code: 1 },
      { stdout: '', code: 0 },
    ]);

    const gitWorktree = (await import('./git-worktree.js')).default;
    await gitWorktree({ issue: 3, slug: 'my-feature', base: 'develop' }, undefined, exec);

    const addCall = calls.find(
      (c) => c.cmd === 'git' && c.args.includes('add') && c.args.includes('-b'),
    );
    expect(addCall!.args).toContain('origin/develop');
  });

  it('slugifies special characters correctly', async () => {
    const { exec } = makeFakeExec([
      { stdout: '', code: 0 },
      { stdout: '', code: 1 },
      { stdout: '', code: 0 },
    ]);

    const gitWorktree = (await import('./git-worktree.js')).default;
    const result = await gitWorktree({ issue: 1, slug: 'Fix: Auth/Login & Session!' }, undefined, exec);

    // lowercase, non-alnum→-, trimmed
    expect(result.branch).toMatch(/^claude\/issue-1-/);
    expect(result.branch).not.toMatch(/[A-Z]/);
    // slug portion (after the prefix) must not contain special chars
    const slugPart = result.branch.replace('claude/issue-1-', '');
    expect(slugPart).not.toMatch(/[&:!/ ]/);
  });

  it('caps branch slug at ~40 chars', async () => {
    const { exec } = makeFakeExec([
      { stdout: '', code: 0 },
      { stdout: '', code: 1 },
      { stdout: '', code: 0 },
    ]);

    const gitWorktree = (await import('./git-worktree.js')).default;
    const result = await gitWorktree(
      { issue: 1, slug: 'this is a very long slug that exceeds the maximum allowed length for branch names' },
      undefined,
      exec,
    );

    // Total branch is "claude/issue-1-<slug>" where slug is capped
    expect(result.branch.length).toBeLessThanOrEqual(60);
  });

  it('does NOT re-add worktree when branch already exists', async () => {
    const existingBranch = 'claude/issue-5-add-login-page';
    const { exec, calls } = makeFakeExec([
      // git worktree list — shows existing
      { stdout: `/some/path  abc1234 [${existingBranch}]\n`, code: 0 },
    ]);

    const gitWorktree = (await import('./git-worktree.js')).default;
    const result = await gitWorktree({ issue: 5, slug: 'Add login page' }, undefined, exec);

    // Should NOT call git worktree add
    const addCall = calls.find(
      (c) => c.cmd === 'git' && c.args.includes('add'),
    );
    expect(addCall).toBeUndefined();

    // Should still return the right branch+path
    expect(result.branch).toBe(existingBranch);
  });
});
