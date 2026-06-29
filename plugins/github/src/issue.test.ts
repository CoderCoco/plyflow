import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubIssueStep } from './issue.js';
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

describe('github.issue', () => {
  it('views the issue with pinned --json fields and parses the result', async () => {
    const calls: string[] = [];
    const exec = mockExec({
      'gh issue view': { stdout: JSON.stringify({ number: 12, title: 'A bug', body: 'details' }) },
    });
    const traced = async (cmd: string | string[]) => { calls.push(Array.isArray(cmd) ? cmd.join(' ') : cmd); return exec(cmd); };
    const step = makeGithubIssueStep(traced);
    const res = await step.run(step.parse({ id: 'i', step: 'github.issue' }), ctx({ with: { number: 12 } }));
    expect(res.output).toEqual({ number: 12, title: 'A bug', body: 'details' });
    expect(calls[0]).toBe('gh issue view 12 --json number,title,body');
  });

  it('appends --repo when given', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh issue view': { stdout: JSON.stringify({ number: 1, title: 't', body: 'b' }) } });
    const traced = async (cmd: string | string[]) => { calls.push(Array.isArray(cmd) ? cmd.join(' ') : cmd); return exec(cmd); };
    const step = makeGithubIssueStep(traced);
    await step.run(step.parse({ id: 'i', step: 'github.issue' }), ctx({ with: { number: 1, repo: 'owner/repo' } }));
    expect(calls[0]).toContain('--repo owner/repo');
  });

  it('under dryRun returns synthetic output without calling exec', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '', code: 0 }; };
    const step = makeGithubIssueStep(exec);
    const res = await step.run(step.parse({ id: 'i', step: 'github.issue' }), ctx({ with: { number: 7 }, dryRun: true }));
    expect(called).toBe(false);
    expect(res.output).toMatchObject({ number: 7 });
  });
});
