import { describe, it, expect } from 'vitest';
import { makeLoopStep } from './loop.js';
import { StepRegistry } from './registry.js';
import { runStep } from './run.js';
import { createRootScope } from '../core/exec.js';
import { Journal } from '../core/journal.js';
import type { StepContext } from './types.js';
import type { StepDef } from '../core/types.js';

// Minimal no-op provider
const provider = {} as any;

// Build a minimal StepContext backed by a real runChildren from exec
function makeCtxWithRunChildren(): StepContext {
  const reg = new StepRegistry();
  reg.register(runStep);
  reg.register(makeLoopStep());

  const journal = Journal.create('.plyflow/runs-test', `test-loop-${Date.now()}`, 'test', {});
  const scope = createRootScope({
    inputs: {},
    env: {},
    baseDir: '.',
    provider,
    registry: reg,
    journal,
    journalPath: 'test',
    dirty: new Set(),
    emit: () => {},
    prompt: async () => undefined,
  });

  return {
    inputs: {},
    env: {},
    steps: {},
    with: {},
    provider,
    baseDir: '.',
    emit: () => {},
    prompt: async () => undefined,
    runChildren: scope.runChildren,
  };
}

describe('loop step', () => {
  it('stops early when until expression becomes truthy', async () => {
    const loop = makeLoopStep();

    // tick step: receives iteration index via ctx.with.i and returns i + 1
    const loopDef: StepDef = {
      id: 'outer',
      loop: { maxIterations: 5, until: '${{ steps.tick.output >= 3 }}' },
      steps: [
        {
          id: 'tick',
          run: 'return ctx.with.i + 1;',
          with: { i: '${{ iteration }}' },
        },
      ],
    };

    const cfg = loop.parse(loopDef);
    const ctx = makeCtxWithRunChildren();

    const result = await loop.run(cfg, ctx);

    // iteration=0 → tick=1, until=false
    // iteration=1 → tick=2, until=false
    // iteration=2 → tick=3, until=true → stop
    // So tick output should be 3
    expect((result.output as Record<string, unknown>)['tick']).toBe(3);
  });

  it('runs exactly maxIterations when until never becomes truthy', async () => {
    const loop = makeLoopStep();

    // counter increments each iteration, but until is never set
    const loopDef: StepDef = {
      id: 'outer',
      loop: { maxIterations: 4 },
      steps: [
        {
          id: 'counter',
          run: 'return ctx.with.i + 1;',
          with: { i: '${{ iteration }}' },
        },
      ],
    };

    const cfg = loop.parse(loopDef);
    const ctx = makeCtxWithRunChildren();

    const result = await loop.run(cfg, ctx);

    // After 4 iterations (i=0,1,2,3), last output = 3 + 1 = 4
    expect((result.output as Record<string, unknown>)['counter']).toBe(4);
  });

  it('match returns true only for defs with loop field', () => {
    const loop = makeLoopStep();
    expect(loop.match({ id: 'x', loop: { maxIterations: 3 }, steps: [] })).toBe(true);
    expect(loop.match({ id: 'x', run: 'return 1;' })).toBe(false);
  });

  it('throws if runChildren is not available on ctx', async () => {
    const loop = makeLoopStep();
    const loopDef: StepDef = {
      id: 'outer',
      loop: { maxIterations: 2 },
      steps: [{ id: 'a', run: 'return 1;' }],
    };
    const cfg = loop.parse(loopDef);
    const ctx: StepContext = {
      inputs: {}, env: {}, steps: {}, with: {},
      provider, baseDir: '.', emit: () => {}, prompt: async () => undefined,
    };
    await expect(loop.run(cfg, ctx)).rejects.toThrow('runChildren');
  });
});
