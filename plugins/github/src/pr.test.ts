import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubPrStep } from './pr.js';
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

const withInput = { title: 'My PR', body: '## Summary\n- x', head: 'feature-x', base: 'main' };

describe('github.pr', () => {
  it('reuses an existing open PR (created:false)', async () => {
    const exec = mockExec({ 'gh pr list': { stdout: JSON.stringify([{ number: 42, url: 'https://github.com/o/r/pull/42' }]) } });
    const step = makeGithubPrStep(exec);
    const res = await step.run(step.parse({ id: 'p', step: 'github.pr' }), ctx({ with: withInput }));
    expect(res.output).toEqual({ number: 42, url: 'https://github.com/o/r/pull/42', created: false });
  });

  it('creates a new PR and parses the number from the printed URL', async () => {
    const calls: string[] = [];
    const exec = mockExec({
      'gh pr list': { stdout: '[]' },
      'gh pr create': { stdout: 'https://github.com/o/r/pull/43\n' },
    });
    const traced = async (cmd: string | string[]) => { calls.push(Array.isArray(cmd) ? cmd.join(' ') : cmd); return exec(cmd); };
    const step = makeGithubPrStep(traced);
    const res = await step.run(step.parse({ id: 'p', step: 'github.pr' }), ctx({ with: withInput }));
    expect(res.output).toEqual({ number: 43, url: 'https://github.com/o/r/pull/43', created: true });
    const create = calls.find((c) => c.includes('gh pr create'))!;
    expect(create).toContain('--title My PR');
    expect(create).toContain('--head feature-x');
    expect(create).toContain('--base main');
  });

  it('under dryRun returns a synthetic PR without calling exec', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '', code: 0 }; };
    const step = makeGithubPrStep(exec);
    const res = await step.run(step.parse({ id: 'p', step: 'github.pr' }), ctx({ with: withInput, dryRun: true }));
    expect(called).toBe(false);
    expect(res.output).toMatchObject({ created: false });
  });
});
