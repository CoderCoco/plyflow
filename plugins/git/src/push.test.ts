import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGitPushStep } from './push.js';
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

describe('git.push', () => {
  it('pushes the given branch with -u and returns the ref', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'git push': { stdout: '' } });
    const traced = async (cmd: string, opts?: { cwd?: string }) => { calls.push(cmd); return exec(cmd, opts); };
    const step = makeGitPushStep(traced);
    const res = await step.run(step.parse({ id: 'p', step: 'git.push' }), ctx({
      with: { path: '/wt', branch: 'claude/issue-1-x' },
    }));
    expect(res.output).toEqual({ pushed: true, ref: 'claude/issue-1-x' });
    expect(calls.some((c) => c.includes('git push -u origin claude/issue-1-x'))).toBe(true);
  });

  it('resolves the current branch when none is given', async () => {
    const exec = mockExec({
      'git rev-parse --abbrev-ref HEAD': { stdout: 'feature-x\n' },
      'git push': { stdout: '' },
    });
    const step = makeGitPushStep(exec);
    const res = await step.run(step.parse({ id: 'p', step: 'git.push' }), ctx({ with: { path: '/wt' } }));
    expect(res.output).toEqual({ pushed: true, ref: 'feature-x' });
  });

  it('under dryRun returns pushed:true without calling exec', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '', code: 0 }; };
    const step = makeGitPushStep(exec);
    const res = await step.run(step.parse({ id: 'p', step: 'git.push' }), ctx({
      with: { path: '/wt', branch: 'b' }, dryRun: true,
    }));
    expect(called).toBe(false);
    expect(res.output).toEqual({ pushed: true, ref: 'b' });
  });
});
