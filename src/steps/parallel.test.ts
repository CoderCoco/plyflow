import { describe, it, expect } from 'vitest';
import { makeParallelStep } from './parallel.js';
import { StepRegistry } from './registry.js';
import { runStep } from './run.js';
import type { StepContext } from './types.js';

const ctx = (): StepContext => ({
  inputs: {}, env: {}, steps: {}, with: {}, provider: {} as any, baseDir: '.',
  emit: () => {}, prompt: async () => undefined,
});

describe('parallel step', () => {
  it('runs child steps and keys outputs by child id', async () => {
    const reg = new StepRegistry();
    reg.register(runStep);
    const parallel = makeParallelStep(reg);
    const cfg = parallel.parse({
      id: 'p',
      parallel: [
        { id: 'a', run: 'return 1;' },
        { id: 'b', run: 'return 2;' },
      ],
    });
    const res = await parallel.run(cfg, ctx());
    expect(res.output).toEqual({ a: 1, b: 2 });
  });
});
