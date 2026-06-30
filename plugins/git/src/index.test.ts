import { describe, it, expect } from 'vitest';
import { StepRegistry } from '@plyflow/core';
import { mockExec } from '@plyflow/testing';
import register, { registerWith } from './index.js';

describe('@plyflow/git register', () => {
  it('default export registers all four git.* steps', () => {
    const registry = new StepRegistry();
    register(registry);
    for (const name of ['git.worktree', 'git.commit', 'git.push', 'git.diff']) {
      // StepRegistry.select(def) returns the matching StepType or throws if none.
      expect(registry.select({ id: 's', step: name }).name).toBe(name);
    }
  });

  it('registerWith injects a mock exec so a registered step runs end-to-end', async () => {
    const registry = new StepRegistry();
    registerWith(registry, mockExec({
      'git status --porcelain': { stdout: ' M a.ts\n' },
      'git add -A': { stdout: '' },
      'git commit -m': { stdout: '' },
      'git rev-parse HEAD': { stdout: 'cafe1234\n' },
    }));
    const step = registry.select({ id: 'c', step: 'git.commit' });
    const res = await step.run(step.parse({ id: 'c', step: 'git.commit' }), {
      inputs: {}, env: {}, steps: {}, with: { path: '/wt', message: 'feat: x' }, bindings: {},
      provider: {} as never, registry, baseDir: '/wf', runDir: '/run',
      isTty: false, dryRun: false, provided: [],
      resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    } as never);
    expect(res.output).toEqual({ committed: true, sha: 'cafe1234' });
  });
});
