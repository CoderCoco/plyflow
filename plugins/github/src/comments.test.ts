import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubCommentsStep } from './comments.js';
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

describe('github.comments', () => {
  it('returns comments, merged, and ci.passing from statusCheckRollup', async () => {
    const payload = {
      merged: false,
      statusCheckRollup: [{ state: 'SUCCESS' }, { state: 'SUCCESS' }],
      comments: [{ body: 'hi', createdAt: '2026-06-01T00:00:00Z' }],
    };
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify(payload) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({ with: { pr: 5 } }));
    // toMatchObject (not toEqual): the passthrough output also carries raw fields like statusCheckRollup.
    expect(res.output).toMatchObject({
      comments: [{ body: 'hi', createdAt: '2026-06-01T00:00:00Z' }],
      ci: { passing: true },
      merged: false,
    });
  });

  it('marks ci.passing false when any check is not SUCCESS', async () => {
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify({ statusCheckRollup: [{ state: 'FAILURE' }], comments: [] }) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({ with: { pr: 5 } }));
    expect(res.output).toMatchObject({ ci: { passing: false } });
  });

  it('passes through raw pinned fields like headRefName', async () => {
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify({ statusCheckRollup: [], comments: [], headRefName: 'feature-x', url: 'u' }) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({ with: { pr: 5 } }));
    expect(res.output).toMatchObject({ headRefName: 'feature-x', url: 'u' });
  });

  it('filters comments by since', async () => {
    const payload = {
      statusCheckRollup: [],
      comments: [
        { body: 'old', createdAt: '2026-06-01T00:00:00Z' },
        { body: 'new', createdAt: '2026-06-10T00:00:00Z' },
      ],
    };
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify(payload) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({
      with: { pr: 5, since: '2026-06-05T00:00:00Z' },
    }));
    expect((res.output as { comments: unknown[] }).comments).toEqual([{ body: 'new', createdAt: '2026-06-10T00:00:00Z' }]);
  });
});
