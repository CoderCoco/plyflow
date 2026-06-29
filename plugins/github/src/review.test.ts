import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubReviewStep } from './review.js';
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

describe('github.review', () => {
  it('posts a comment', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh pr comment': { stdout: '' } });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubReviewStep(traced);
    const res = await step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, comment: 'looks good' } }));
    expect(res.output).toEqual({ action: 'comment', body: 'looks good' });
    expect(calls[0]).toBe("gh pr comment 5 --body 'looks good'");
  });

  it('re-requests reviewers', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh pr edit': { stdout: '' } });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubReviewStep(traced);
    const res = await step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, reRequest: ['alice', 'bob'] } }));
    expect(res.output).toEqual({ action: 'reRequest', reviewers: ['alice', 'bob'] });
    expect(calls[0]).toContain('--add-reviewer alice');
    expect(calls[0]).toContain('--add-reviewer bob');
  });

  it('resolves a review thread via graphql', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh api graphql': { stdout: '' } });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubReviewStep(traced);
    const res = await step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, resolveThread: 'PRT_123' } }));
    expect(res.output).toEqual({ action: 'resolveThread', resolved: true });
    expect(calls[0]).toContain('resolveReviewThread');
    expect(calls[0]).toContain('PRT_123');
  });

  it('throws when no action is given', async () => {
    const step = makeGithubReviewStep(mockExec({}));
    await expect(step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5 } }))).rejects.toThrow(/exactly one/);
  });

  it('throws when more than one action is given', async () => {
    const step = makeGithubReviewStep(mockExec({}));
    await expect(
      step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, comment: 'x', resolveThread: 'y' } })),
    ).rejects.toThrow(/exactly one/);
  });
});
