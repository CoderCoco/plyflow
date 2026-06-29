import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGitDiffStep } from './diff.js';
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

describe('git.diff', () => {
  it('returns changed files and the patch against origin/<base>...HEAD', async () => {
    const calls: string[] = [];
    const exec = mockExec({
      'git diff --name-only': { stdout: 'a.ts\nb.ts\n' },
      'git diff origin/main...HEAD': { stdout: 'diff --git a/a.ts b/a.ts\n' },
    });
    const traced = async (cmd: string, opts?: { cwd?: string }) => { calls.push(cmd); return exec(cmd, opts); };
    const step = makeGitDiffStep(traced);
    const res = await step.run(step.parse({ id: 'd', step: 'git.diff' }), ctx({ with: { path: '/wt' } }));
    expect(res.output).toEqual({ files: ['a.ts', 'b.ts'], patch: 'diff --git a/a.ts b/a.ts\n' });
    expect(calls.some((c) => c.includes('git diff --name-only origin/main...HEAD'))).toBe(true);
  });

  it('returns an empty file list when there is no diff', async () => {
    const exec = mockExec({ 'git diff': { stdout: '' } });
    const step = makeGitDiffStep(exec);
    const res = await step.run(step.parse({ id: 'd', step: 'git.diff' }), ctx({ with: { path: '/wt', base: 'develop' } }));
    expect(res.output).toEqual({ files: [], patch: '' });
  });
});
