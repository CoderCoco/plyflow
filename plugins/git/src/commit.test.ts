import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGitCommitStep } from './commit.js';
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

describe('git.commit', () => {
  it('stages, commits, and returns committed:true with the new sha', async () => {
    const seen: Array<{ cmd: string; cwd?: string }> = [];
    const exec = mockExec({
      'git status --porcelain': { stdout: ' M file.ts\n' },
      'git add -A': { stdout: '' },
      'git commit -m': { stdout: '' },
      'git rev-parse HEAD': { stdout: 'deadbeef\n' },
    });
    const traced = async (cmd: string | string[], opts?: { cwd?: string }) => { seen.push({ cmd: Array.isArray(cmd) ? cmd.join(' ') : cmd, cwd: opts?.cwd }); return exec(cmd, opts); };
    const step = makeGitCommitStep(traced);
    const res = await step.run(step.parse({ id: 'c', step: 'git.commit' }), ctx({
      with: { path: '/wt', message: 'feat: do it\n\nRefs #1' },
    }));
    expect(res.output).toEqual({ committed: true, sha: 'deadbeef' });
    expect(seen.every((s) => s.cwd === '/wt')).toBe(true);
    expect(seen.some((s) => s.cmd.includes('git commit -m feat: do it'))).toBe(true);
  });

  it('returns committed:false on a clean tree without committing', async () => {
    const exec = mockExec({ 'git status --porcelain': { stdout: '' } });
    const step = makeGitCommitStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'git.commit' }), ctx({
      with: { path: '/wt', message: 'noop' },
    }));
    expect(res.output).toEqual({ committed: false });
  });

  it('under dryRun returns committed:true without calling exec', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '', code: 0 }; };
    const step = makeGitCommitStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'git.commit' }), ctx({
      with: { path: '/wt', message: 'x' }, dryRun: true,
    }));
    expect(called).toBe(false);
    expect(res.output).toMatchObject({ committed: true });
  });
});
