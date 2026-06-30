import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGitWorktreeStep } from './worktree.js';
import type { StepContext } from '@plyflow/core';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {}, env: {}, steps: {}, with: {}, bindings: {},
    provider: {} as never, registry: {} as never, baseDir: '/wf', runDir: '/run',
    isTty: false, dryRun: false, provided: [],
    resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    ...over,
  } as StepContext;
}

describe('git.worktree', () => {
  it('derives branch + path and creates a new worktree from origin/<base>', async () => {
    const calls: string[] = [];
    const exec = mockExec({
      'git worktree list': { stdout: '' },
      'git rev-parse --verify': { code: 1 }, // branch does not exist
      'git worktree add': { stdout: '' },
    });
    const traced = async (cmd: string | string[], opts?: { cwd?: string }) => { calls.push(Array.isArray(cmd) ? cmd.join(' ') : cmd); return exec(cmd, opts); };
    const step = makeGitWorktreeStep(traced);
    const res = await step.run(step.parse({ id: 'w', step: 'git.worktree' }), ctx({
      with: { issue: 12, slug: 'Fix the Thing!', base: 'main' },
    }));
    expect(res.output).toEqual({
      path: '.claude/worktrees/issue-12-fix-the-thing',
      branch: 'claude/issue-12-fix-the-thing',
      created: true,
    });
    expect(calls.some((c) => c.includes('worktree add') && c.includes('-b claude/issue-12-fix-the-thing') && c.includes('origin/main'))).toBe(true);
  });

  it('reuses an existing worktree (created:false) when the branch is already listed', async () => {
    const exec = mockExec({ 'git worktree list': { stdout: '/abs/wt/issue-12  abc1234  [claude/issue-12-fix-the-thing]\n' } });
    const step = makeGitWorktreeStep(exec);
    const res = await step.run(step.parse({ id: 'w', step: 'git.worktree' }), ctx({
      with: { issue: 12, slug: 'fix the thing' },
    }));
    expect(res.output).toEqual({ path: '/abs/wt/issue-12', branch: 'claude/issue-12-fix-the-thing', created: false });
  });

  it('adds worktree for an existing local branch (no -b, no origin/)', async () => {
    const calls: string[] = [];
    const exec = mockExec({
      'git worktree list': { stdout: '' },        // branch not already checked out
      'git rev-parse --verify': { code: 0 },      // branch exists locally
      'git worktree add': { stdout: '' },
    });
    const traced = async (cmd: string | string[], opts?: { cwd?: string }) => { calls.push(Array.isArray(cmd) ? cmd.join(' ') : cmd); return exec(cmd, opts); };
    const step = makeGitWorktreeStep(traced);
    const res = await step.run(step.parse({ id: 'w', step: 'git.worktree' }), ctx({
      with: { issue: 12, slug: 'fix the thing', base: 'main' },
    }));
    expect(res.output).toEqual({
      path: '.claude/worktrees/issue-12-fix-the-thing',
      branch: 'claude/issue-12-fix-the-thing',
      created: true,
    });
    const addCmd = calls.find((c) => c.includes('worktree add'));
    expect(addCmd).toBeDefined();
    expect(addCmd).not.toContain('-b');
    expect(addCmd).not.toContain('origin/');
  });

  it('under dryRun returns synthetic output without calling exec', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '', code: 0 }; };
    const step = makeGitWorktreeStep(exec);
    const res = await step.run(step.parse({ id: 'w', step: 'git.worktree' }), ctx({
      with: { issue: 5, slug: 'x' }, dryRun: true,
    }));
    expect(called).toBe(false);
    expect(res.output).toMatchObject({ created: false, branch: 'claude/issue-5-x' });
  });
});
