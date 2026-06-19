import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootScope, runSteps } from './exec.js';
import { buildDefaultRegistry } from './engine.js';
import { Journal } from './journal.js';
import { FakeProvider } from '../providers/fake.js';
import type { EngineEvent } from './engine.js';

function expr(e: string): string {
  return '${{' + ' ' + e + ' ' + '}}';
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-exec-if-'));
  return () => rm(dir, { recursive: true, force: true });
});

function makeScope(events: EngineEvent[]) {
  const provider = new FakeProvider([]);
  const registry = buildDefaultRegistry();
  const journal = Journal.create(dir, `test-run-${Math.random().toString(36).slice(2)}`, 'test', {});
  return createRootScope({
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
}

describe('if: conditional', () => {
  it('skips a step when if resolves falsy and downstream step still runs', async () => {
    const events: EngineEvent[] = [];
    const scope = makeScope(events);

    const outputs = await runSteps(
      [
        { id: 'a', if: expr('false'), run: 'return 1;' },
        { id: 'b', needs: ['a'], run: "return 'ran';" },
      ],
      scope,
    );

    expect(outputs['a']).toBeNull();
    expect(outputs['b']).toBe('ran');
    expect(events.some((e) => e.type === 'step-skipped' && e.stepId === 'a')).toBe(true);
    expect(events.some((e) => e.type === 'step-start' && e.stepId === 'b')).toBe(true);
    expect(events.some((e) => e.type === 'step-done' && e.stepId === 'b')).toBe(true);
  });

  it('runs a step normally when if resolves truthy', async () => {
    const events: EngineEvent[] = [];
    const scope = makeScope(events);

    const outputs = await runSteps(
      [
        { id: 'a', if: expr('true'), run: 'return 42;' },
      ],
      scope,
    );

    expect(outputs['a']).toBe(42);
    expect(events.some((e) => e.type === 'step-start' && e.stepId === 'a')).toBe(true);
    expect(events.some((e) => e.type === 'step-done' && e.stepId === 'a')).toBe(true);
    expect(events.some((e) => e.type === 'step-skipped' && e.stepId === 'a')).toBe(false);
  });
});
