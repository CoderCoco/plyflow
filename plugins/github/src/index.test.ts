import { describe, it, expect } from 'vitest';
import { StepRegistry } from '@plyflow/core';
import { mockExec } from '@plyflow/testing';
import register, { registerWith } from './index.js';

describe('@plyflow/github register', () => {
  it('default export registers all four github.* steps', () => {
    const registry = new StepRegistry();
    register(registry);
    for (const name of ['github.issue', 'github.pr', 'github.comments', 'github.review']) {
      // StepRegistry.select(def) returns the matching StepType or throws if none.
      expect(registry.select({ id: 's', step: name }).name).toBe(name);
    }
  });

  it('registerWith injects a mock exec so a registered step runs end-to-end', async () => {
    const registry = new StepRegistry();
    registerWith(registry, mockExec({ 'gh issue view': { stdout: JSON.stringify({ number: 9, title: 't', body: 'b' }) } }));
    const step = registry.select({ id: 'i', step: 'github.issue' });
    const res = await step.run(step.parse({ id: 'i', step: 'github.issue' }), {
      inputs: {}, env: {}, steps: {}, with: { number: 9 }, bindings: {},
      provider: {} as never, registry, baseDir: '/wf', runDir: '/run',
      isTty: false, dryRun: false, provided: [],
      resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    } as never);
    expect(res.output).toEqual({ number: 9, title: 't', body: 'b' });
  });
});
