/**
 * Fix 1 (core): cache-hit branch must emit step-start BEFORE step-done.
 *
 * When a step is served from the journal cache (second run with same runId),
 * the TUI needs a step-start event to open a row in the live view before
 * a step-done event closes it. Without step-start the TUI never sees the step.
 */

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
  dir = await mkdtemp(join(tmpdir(), 'plyflow-cache-events-'));
  return () => rm(dir, { recursive: true, force: true });
});

function makeScope(
  journal: Journal,
  journalPath: string,
  dirty: Set<string>,
  events: EngineEvent[],
) {
  return createRootScope({
    inputs: {},
    env: process.env,
    baseDir: dir,
    provider: new FakeProvider([]),
    registry: buildDefaultRegistry(),
    journal,
    journalPath,
    dirty,
    isTty: false,
    loadModule: async (_path: string) => ({}),
    emit: (e) => events.push(e),
    prompt: () => Promise.reject(new Error('no prompt')),
  });
}

describe('cache-hit events — step-start emitted before step-done', () => {
  it('emits step-start then step-done (cached:true) on a cache hit', async () => {
    const runId = 'run-cache-events-test';

    // ── First run: populate the journal ────────────────────────────────────
    const journal1 = Journal.create(dir, runId, 'test', {});
    const dirty1 = new Set<string>();
    const events1: EngineEvent[] = [];
    const scope1 = makeScope(journal1, 'phase:Main', dirty1, events1);

    await runSteps([{ id: 'compute', run: 'return 7;' }], scope1);
    await journal1.setStatus('completed');

    // First run must NOT be cached
    const firstCached = events1.filter(
      (e) => e.type === 'step-done' && (e as { cached?: boolean }).cached,
    );
    expect(firstCached).toHaveLength(0);

    // ── Second run: same runId → cache hit ─────────────────────────────────
    const journal2 = await Journal.load(dir, runId);
    const dirty2 = new Set<string>();
    const events2: EngineEvent[] = [];
    const scope2 = makeScope(journal2, 'phase:Main', dirty2, events2);

    await runSteps([{ id: 'compute', run: 'return 7;' }], scope2);

    // There should be a step-done with cached:true
    const cachedDone = events2.filter(
      (e) => e.type === 'step-done' && (e as { cached?: boolean }).cached,
    );
    expect(cachedDone).toHaveLength(1);

    // There MUST also be a step-start for the cached step
    const starts = events2.filter((e) => e.type === 'step-start');
    expect(starts).toHaveLength(1);

    // step-start must come BEFORE step-done
    const startIdx = events2.findIndex((e) => e.type === 'step-start');
    const doneIdx = events2.findIndex((e) => e.type === 'step-done');
    expect(startIdx).toBeLessThan(doneIdx);

    // step-start must carry the right shape
    const startEvent = events2[startIdx] as {
      type: 'step-start';
      stepId: string;
      instanceId: string;
      parentId: string | null;
      kind: string;
    };
    expect(startEvent.stepId).toBe('compute');
    expect(startEvent.instanceId).toBe('phase:Main/compute');
    expect(startEvent.parentId).toBe('phase:Main');
    expect(startEvent.kind).toBe('run');
  });
});
