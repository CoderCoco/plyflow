import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootScope, runSteps } from './exec.js';
import { buildDefaultRegistry } from './engine.js';
import { Journal } from './journal.js';
import { FakeProvider } from '../providers/fake.js';
import type { EngineEvent } from './engine.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-exec-'));
  return () => rm(dir, { recursive: true, force: true });
});

describe('runSteps', () => {
  it('runs a 2-step pipeline and returns outputs', async () => {
    const provider = new FakeProvider([]);
    const registry = buildDefaultRegistry();
    const journal = Journal.create(dir, 'test-run-1', 'test', {});
    const events: EngineEvent[] = [];

    const scope = createRootScope({
      inputs: {},
      env: process.env,
      baseDir: dir,
      provider,
      registry,
      journal,
      journalPath: 'phase:Test',
      dirty: new Set(),
      emit: (e) => events.push(e),
      prompt: () => Promise.reject(new Error('no prompt')),
    });

    const outputs = await runSteps(
      [
        { id: 'a', run: 'return 1;' },
        { id: 'b', needs: ['a'], run: 'return ctx.steps.a.output + 1;' },
      ],
      scope,
    );

    expect(outputs).toEqual({ a: 1, b: 2 });
    expect(events.some((e) => e.type === 'step-start' && e.stepId === 'a')).toBe(true);
    expect(events.some((e) => e.type === 'step-done' && e.stepId === 'a')).toBe(true);
    expect(events.some((e) => e.type === 'step-start' && e.stepId === 'b')).toBe(true);
    expect(events.some((e) => e.type === 'step-done' && e.stepId === 'b')).toBe(true);
  });
});
