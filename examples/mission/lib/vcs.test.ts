import { describe, it, expect } from 'vitest';
import { buildTaskCommitMessage } from './git-commit.js';
import { buildPrBody } from './gh-pr.js';
import gitCommit from './git-commit.js';
import gitPush from './git-push.js';
import ghPr from './gh-pr.js';
import type { Exec } from './exec.js';

// ---------------------------------------------------------------------------
// Fake Exec factory
// ---------------------------------------------------------------------------
type Call = { cmd: string; args: string[]; cwd?: string };

function makeFakeExec(
  handler: (cmd: string, args: string[]) => { stdout: string; stderr: string; code: number },
): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    return Promise.resolve(handler(cmd, args));
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// buildTaskCommitMessage
// ---------------------------------------------------------------------------
describe('buildTaskCommitMessage', () => {
  it('produces feat: <taskName> — <title>\\n\\nRefs #<issue>', () => {
    const msg = buildTaskCommitMessage('implement-auth', 'Add JWT authentication', 42);
    expect(msg).toBe('feat: implement-auth — Add JWT authentication\n\nRefs #42');
  });
});

// ---------------------------------------------------------------------------
// buildPrBody
// ---------------------------------------------------------------------------
describe('buildPrBody', () => {
  it('includes ## Summary, ## Changes, ## Test plan, Closes #<issue>', () => {
    const body = buildPrBody({
      summary_bullets: ['Added auth layer', 'Fixed login bug'],
      diffstat: '5 files changed, 100 insertions(+), 10 deletions(-)',
      test_plan: ['Run unit tests', 'Manual login check'],
      issue: 99,
    });
    expect(body).toContain('## Summary');
    expect(body).toContain('- Added auth layer');
    expect(body).toContain('- Fixed login bug');
    expect(body).toContain('## Changes');
    expect(body).toContain('5 files changed, 100 insertions(+), 10 deletions(-)');
    expect(body).toContain('## Test plan');
    expect(body).toContain('- [ ] Run unit tests');
    expect(body).toContain('- [ ] Manual login check');
    expect(body).toContain('Closes #99');
  });
});

// ---------------------------------------------------------------------------
// gitCommit
// ---------------------------------------------------------------------------
describe('gitCommit', () => {
  it('runs git add -A then git commit -m <message> and returns committed:true', async () => {
    const { exec, calls } = makeFakeExec((cmd, args) => {
      if (args[0] === 'status') return { stdout: 'M file.ts', stderr: '', code: 0 };
      if (args[0] === 'add') return { stdout: '', stderr: '', code: 0 };
      if (args[0] === 'commit') return { stdout: '[main abc1234] feat: foo\n', stderr: '', code: 0 };
      if (args[0] === 'rev-parse') return { stdout: 'abc1234\n', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await gitCommit(
      { worktree_path: '/tmp/wt', message: 'feat: foo — bar\n\nRefs #1' },
      undefined,
      exec,
    );

    expect(result.committed).toBe(true);
    // Should have called git add -A in the worktree
    const addCall = calls.find((c) => c.args[0] === 'add');
    expect(addCall).toBeDefined();
    expect(addCall?.args).toContain('-A');
    expect(addCall?.cwd).toBe('/tmp/wt');
    // Should have called git commit
    const commitCall = calls.find((c) => c.args[0] === 'commit');
    expect(commitCall).toBeDefined();
    expect(commitCall?.args).toContain('feat: foo — bar\n\nRefs #1');
    expect(commitCall?.cwd).toBe('/tmp/wt');
  });

  it('returns committed:false when porcelain status is empty (nothing to commit)', async () => {
    const { exec } = makeFakeExec((cmd, args) => {
      if (args[0] === 'status') return { stdout: '', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await gitCommit(
      { worktree_path: '/tmp/wt', message: 'feat: nothing' },
      undefined,
      exec,
    );

    expect(result.committed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// gitPush
// ---------------------------------------------------------------------------
describe('gitPush', () => {
  it('runs git push -u origin <branch> in the worktree and returns pushed:true', async () => {
    const { exec, calls } = makeFakeExec(() => ({ stdout: '', stderr: '', code: 0 }));

    const result = await gitPush(
      { worktree_path: '/tmp/wt', branch: 'feat/my-branch' },
      undefined,
      exec,
    );

    expect(result.pushed).toBe(true);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.cmd).toBe('git');
    expect(c.args).toEqual(['push', '-u', 'origin', 'feat/my-branch']);
    expect(c.cwd).toBe('/tmp/wt');
  });
});

// ---------------------------------------------------------------------------
// ghPr
// ---------------------------------------------------------------------------
describe('ghPr', () => {
  it('creates a new PR when none exists and returns pr_number + pr_url', async () => {
    const { exec, calls } = makeFakeExec((cmd, args) => {
      // gh pr list --head <branch> --json number,url → empty array
      if (args[0] === 'pr' && args[1] === 'list') {
        return { stdout: '[]', stderr: '', code: 0 };
      }
      // gh pr create → returns url
      if (args[0] === 'pr' && args[1] === 'create') {
        return {
          stdout: 'https://github.com/owner/repo/pull/7\n',
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await ghPr(
      {
        branch: 'feat/my-branch',
        title: 'My PR',
        body: 'The body',
      },
      undefined,
      exec,
    );

    expect(result.pr_number).toBe(7);
    expect(result.pr_url).toBe('https://github.com/owner/repo/pull/7');
    const createCall = calls.find((c) => c.args[1] === 'create');
    expect(createCall).toBeDefined();
    expect(createCall?.args).toContain('--title');
    expect(createCall?.args).toContain('My PR');
  });

  it('reuses an existing PR when one is found and returns its number/url', async () => {
    const existingPr = [{ number: 42, url: 'https://github.com/owner/repo/pull/42' }];
    const { exec, calls } = makeFakeExec((cmd, args) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return { stdout: JSON.stringify(existingPr), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await ghPr(
      {
        branch: 'feat/existing-branch',
        title: 'Existing PR',
        body: 'Body',
      },
      undefined,
      exec,
    );

    expect(result.pr_number).toBe(42);
    expect(result.pr_url).toBe('https://github.com/owner/repo/pull/42');
    // Should NOT have called gh pr create
    const createCall = calls.find((c) => c.args[1] === 'create');
    expect(createCall).toBeUndefined();
  });

  it('passes --repo when provided', async () => {
    const { exec, calls } = makeFakeExec((cmd, args) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return { stdout: '[]', stderr: '', code: 0 };
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        return { stdout: 'https://github.com/owner/repo/pull/8\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });

    await ghPr(
      {
        repo: 'owner/repo',
        branch: 'feat/branch',
        title: 'Title',
        body: 'Body',
      },
      undefined,
      exec,
    );

    const listCall = calls.find((c) => c.args[1] === 'list');
    expect(listCall?.args).toContain('--repo');
    expect(listCall?.args).toContain('owner/repo');
    const createCall = calls.find((c) => c.args[1] === 'create');
    expect(createCall?.args).toContain('--repo');
    expect(createCall?.args).toContain('owner/repo');
  });
});
