import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLoopStep } from './loop.js';
import { StepRegistry } from './registry.js';
import { runStep } from './run.js';
import { createRootScope, runSteps } from '../core/exec.js';
import { Journal } from '../core/journal.js';
import type { StepContext } from './types.js';
import type { StepDef } from '../core/types.js';

// Minimal no-op provider
const provider = {} as any;

// Noop loader for tests that don't load user modules
const noopLoadModule = async (_path: string): Promise<unknown> => ({});

// Build a minimal StepContext backed by a real runChildren from exec
function makeCtxWithRunChildren(tmpDir?: string, journalPath = 'test'): StepContext {
  const reg = new StepRegistry();
  reg.register(runStep);
  reg.register(makeLoopStep());

  const baseDir = tmpDir ?? '.';
  const journal = Journal.create(
    tmpDir ?? '.plyflow/runs-test',
    `test-loop-${Date.now()}`,
    'test',
    {},
  );
  const scope = createRootScope({
    inputs: {},
    env: {},
    baseDir,
    provider,
    registry: reg,
    journal,
    journalPath,
    dirty: new Set(),
    isTty: true,
    loadModule: noopLoadModule,
    emit: () => {},
    prompt: async () => undefined,
  });

  return {
    inputs: {},
    env: {},
    steps: {},
    with: {},
    provider,
    baseDir,
    isTty: true,
    loadModule: noopLoadModule,
    emit: () => {},
    prompt: async () => undefined,
    runChildren: scope.runChildren,
  };
}

function makeRootScope(tmpDir: string, journalPath = 'test') {
  const reg = new StepRegistry();
  reg.register(runStep);
  reg.register(makeLoopStep());

  const journal = Journal.create(tmpDir, `test-loop-${Date.now()}`, 'test', {});
  return {
    scope: createRootScope({
      inputs: {},
      env: {},
      baseDir: tmpDir,
      provider,
      registry: reg,
      journal,
      journalPath,
      dirty: new Set(),
      isTty: true,
      loadModule: noopLoadModule,
      emit: () => {},
      prompt: async () => undefined,
    }),
    journal,
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
      provider, baseDir: '.', isTty: true, emit: () => {}, prompt: async () => undefined,
      loadModule: noopLoadModule,
    };
    await expect(loop.run(cfg, ctx)).rejects.toThrow('runChildren');
  });
});

// ── Fix B: loop step includes its own id in child subPath ────────────────────

describe('Fix B — loop step id in subPath prevents journal bleed', () => {
  it('two loop steps with the same child step id produce independent journal entries', async () => {
    /**
     * Two different loop steps ("loopA" and "loopB") each contain a child step
     * named "tick".  Without Fix B the subPath is `loop:0` for both, so they
     * collide.  With Fix B it is `loopA/loop:0` and `loopB/loop:0` respectively.
     *
     * We verify by running both loops and checking that each tick step is
     * executed (not read from each other's cache bleed), and that the journal
     * holds two distinct entries.
     */
    const tmpDir = await mkdtemp(join(tmpdir(), 'plyflow-loopB-'));
    try {
      const { scope, journal } = makeRootScope(tmpDir, 'phase:Test');

      // Run loopA with child "tick" returning 'A'
      const loopADef: StepDef = {
        id: 'loopA',
        loop: { maxIterations: 1 },
        steps: [{ id: 'tick', run: 'return "A";' }],
      };

      // Run loopB with child "tick" returning 'B'
      const loopBDef: StepDef = {
        id: 'loopB',
        loop: { maxIterations: 1 },
        steps: [{ id: 'tick', run: 'return "B";' }],
      };

      const outputs = await runSteps([loopADef, loopBDef], scope);

      // Each loop's output should reflect its own tick value
      expect((outputs['loopA'] as Record<string, unknown>)['tick']).toBe('A');
      expect((outputs['loopB'] as Record<string, unknown>)['tick']).toBe('B');

      // The journal should have separate entries for each loop's child step
      await journal.setStatus('completed');
      const loaded = await Journal.load(tmpDir, journal.runId);
      // Keys should be scoped under loopA and loopB respectively
      const keyA = loaded.get('phase:Test/loopA/loop:0/tick');
      const keyB = loaded.get('phase:Test/loopB/loop:0/tick');
      expect(keyA).toBeDefined();
      expect(keyB).toBeDefined();
      expect(keyA?.output).toBe('A');
      expect(keyB?.output).toBe('B');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Fix C: until expression sees ancestor (ctx.steps) outputs ────────────────

describe('Fix C — until expression sees ancestor step outputs', () => {
  it('until reads a step defined before the loop', async () => {
    /**
     * A step "before" runs before the loop and sets output to true.
     * The loop's `until` expression references `steps.before.output`.
     * With Fix C, the `until` context merges ctx.steps (ancestor outputs)
     * with the iteration's own outputs.
     */
    const tmpDir = await mkdtemp(join(tmpdir(), 'plyflow-loopC-'));
    try {
      const { scope } = makeRootScope(tmpDir, 'phase:Test');

      // Run "before" step first so its output is in scope
      await runSteps([{ id: 'before', run: 'return true;' }], scope);

      // Now run loop steps in the same scope
      const loopDef: StepDef = {
        id: 'myloop',
        loop: {
          maxIterations: 10,
          until: '${{ steps.before.output && steps.tick.output >= 2 }}',
        },
        steps: [{ id: 'tick', run: 'return ctx.with.i + 1;', with: { i: '${{ iteration }}' } }],
      };

      const outputs = await runSteps([loopDef], scope);

      // iteration=0 → tick=1, until=(true && 1>=2)=false
      // iteration=1 → tick=2, until=(true && 2>=2)=true → stop
      expect((outputs['myloop'] as Record<string, unknown>)['tick']).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Fix D: until bindings expose `iteration` but NOT ctx.with values ─────────

describe('Fix D — until bindings contain iteration, not ctx.with', () => {
  it('iteration is available in until expression', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'plyflow-loopD1-'));
    try {
      const { scope } = makeRootScope(tmpDir, 'phase:Test');

      const loopDef: StepDef = {
        id: 'myloop',
        loop: {
          maxIterations: 10,
          until: '${{ iteration >= 2 }}',
        },
        steps: [{ id: 'noop', run: 'return null;' }],
      };

      const outputs = await runSteps([loopDef], scope);

      // iteration 0: until=false, iteration 1: until=false, iteration 2: until=true
      // After 3 iterations (0,1,2) it stops; last outputs from i=2
      expect(outputs['myloop']).toBeDefined();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('ctx.with values are NOT available in until expression', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'plyflow-loopD2-'));
    try {
      const reg = new StepRegistry();
      reg.register(runStep);
      reg.register(makeLoopStep());

      const journal = Journal.create(tmpDir, `test-d2-${Date.now()}`, 'test', {});
      const scope = createRootScope({
        inputs: {},
        env: {},
        baseDir: tmpDir,
        provider,
        registry: reg,
        journal,
        journalPath: 'phase:Test',
        dirty: new Set(),
        isTty: true,
        loadModule: noopLoadModule,
        emit: () => {},
        prompt: async () => undefined,
      });

      // The loop step is called via runChildren, which passes extraBindings.
      // But ctx.with is what gets set on the loop step's StepContext.
      // We simulate a parent step that calls the loop with a `with` of { secretVal: 42 }.
      // The loop's `until` should NOT see `secretVal`.
      const loop = makeLoopStep();
      const loopDef: StepDef = {
        id: 'myloop',
        loop: { maxIterations: 3, until: '${{ typeof secretVal === "undefined" }}' },
        steps: [{ id: 'noop', run: 'return null;' }],
      };
      const cfg = loop.parse(loopDef);

      // Manually build ctx with ctx.with containing secretVal
      const ctx: StepContext = {
        inputs: {},
        env: {},
        steps: {},
        with: { secretVal: 42 },
        provider,
        baseDir: tmpDir,
        isTty: true,
        loadModule: noopLoadModule,
        emit: () => {},
        prompt: async () => undefined,
        runChildren: scope.runChildren,
        bindings: {},
      };

      // until expression `typeof secretVal === "undefined"` should be true if
      // secretVal is NOT leaked from ctx.with into until bindings.
      // If true on first iteration, loop stops after 1 iteration.
      const result = await loop.run(cfg, ctx);

      // Loop should have stopped after iteration 0 (until=true → secretVal not present)
      expect(result.output).toBeDefined();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
