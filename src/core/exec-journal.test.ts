/**
 * Task 3: Composite journal keys for nested execution.
 *
 * These tests cover two failure modes that flat (non-composite) journal keys cause:
 *
 * 1. CROSS-PATH BLEED: Two runChildren calls with different subPaths (e.g. loop:0 /
 *    loop:1) but the same step id and identical `with`/inputs share a journal entry
 *    under a flat key.  With composite keys each path gets its own entry.
 *
 * 2. RESUME / CACHE HIT: A second runWorkflow call (same runId) must still replay
 *    cached composite-keyed entries when neither the step config nor inputs changed.
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
  dir = await mkdtemp(join(tmpdir(), 'plyflow-journal-'));
  return () => rm(dir, { recursive: true, force: true });
});

/** Build a root ExecScope wired to a real (disk-backed) journal. */
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
    loadModule: async (_path: string) => ({}),
    emit: (e) => events.push(e),
    prompt: () => Promise.reject(new Error('no prompt')),
  });
}

// ── 1. Cross-path collision test ────────────────────────────────────────────

describe('composite journal keys — cross-path isolation', () => {
  it('gives independent journal entries to the same step id under different subPaths', async () => {
    /**
     * Simulate two loop iterations running the same step ("tick") with the same
     * input config.  Under flat keys both iterations would share one journal entry
     * (the second one would incorrectly see a cache hit after the first write).
     * Under composite keys each iteration has its own entry.
     *
     * We do this with a SINGLE journal across both `runChildren` calls (same runId)
     * so the collision would definitely occur if keys were flat.
     */
    const runId = 'run-journal-test';
    const journal = Journal.create(dir, runId, 'test', {});
    const dirty = new Set<string>();
    const events: EngineEvent[] = [];

    const scope = makeScope(journal, 'phase:Test', dirty, events);

    // Iteration 0 — step "tick" with identical config as iteration 1
    const out0 = await scope.runChildren(
      [{ id: 'tick', run: 'return 0;' }],
      { iteration: 0 },
      'loop:0',
    );

    // Iteration 1 — same step id, same run code, same inputs
    const out1 = await scope.runChildren(
      [{ id: 'tick', run: 'return 0;' }],
      { iteration: 1 },
      'loop:1',
    );

    // Both outputs must be present and correct
    expect(out0['tick']).toBe(0);
    expect(out1['tick']).toBe(0);

    // Neither call should have replayed from cache (both are first writes)
    const cachedEvents = events.filter((e) => e.type === 'step-done' && (e as { cached?: boolean }).cached);
    expect(cachedEvents).toHaveLength(0);

    // The journal must contain TWO entries, not one
    const loadedJournal = await Journal.load(dir, runId);
    const key0 = loadedJournal.get('phase:Test/loop:0/tick');
    const key1 = loadedJournal.get('phase:Test/loop:1/tick');

    expect(key0).toBeDefined();
    expect(key1).toBeDefined();

    // Flat key must NOT exist (composite keys replaced it)
    const flatKey = loadedJournal.get('tick');
    expect(flatKey).toBeUndefined();
  });
});

// ── 2. Resume / cache-hit test ───────────────────────────────────────────────

describe('composite journal keys — resume replays cached nested steps', () => {
  it('second run with same runId replays cached entries for unchanged sub-steps', async () => {
    const runId = 'run-resume-test';

    // ── First run ───────────────────────────────────────────────────────────
    const journal1 = Journal.create(dir, runId, 'test', {});
    const dirty1 = new Set<string>();
    const events1: EngineEvent[] = [];
    const scope1 = makeScope(journal1, 'phase:Main', dirty1, events1);

    await scope1.runChildren(
      [{ id: 'work', run: 'return 42;' }],
      {},
      'loop:0',
    );

    await journal1.setStatus('completed');

    // Confirm first run was NOT from cache
    const firstDoneEvents = events1.filter(
      (e) => e.type === 'step-done' && (e as { cached?: boolean }).cached,
    );
    expect(firstDoneEvents).toHaveLength(0);

    // ── Second run — same runId, load existing journal ──────────────────────
    const journal2 = await Journal.load(dir, runId);
    const dirty2 = new Set<string>();
    const events2: EngineEvent[] = [];
    const scope2 = makeScope(journal2, 'phase:Main', dirty2, events2);

    const out2 = await scope2.runChildren(
      [{ id: 'work', run: 'return 42;' }],
      {},
      'loop:0',
    );

    expect(out2['work']).toBe(42);

    // The step must have been replayed from cache (cached: true)
    const cachedEvents = events2.filter(
      (e) => e.type === 'step-done' && (e as { cached?: boolean }).cached,
    );
    expect(cachedEvents).toHaveLength(1);
  });

  it('changing the subPath on resume forces a fresh execution (different composite key)', async () => {
    const runId = 'run-resume-path-change';

    // ── First run under loop:0 ────────────────────────────────────────────
    const journal1 = Journal.create(dir, runId, 'test', {});
    const dirty1 = new Set<string>();
    const scope1 = makeScope(journal1, 'phase:Main', dirty1, []);

    await scope1.runChildren([{ id: 'work', run: 'return 99;' }], {}, 'loop:0');
    await journal1.setStatus('completed');

    // ── Second run under loop:1 (different path — should NOT get cache hit) ─
    const journal2 = await Journal.load(dir, runId);
    const dirty2 = new Set<string>();
    const events2: EngineEvent[] = [];
    const scope2 = makeScope(journal2, 'phase:Main', dirty2, events2);

    await scope2.runChildren([{ id: 'work', run: 'return 99;' }], {}, 'loop:1');

    const cachedEvents = events2.filter(
      (e) => e.type === 'step-done' && (e as { cached?: boolean }).cached,
    );
    // loop:1/work did not exist in journal — should NOT be replayed from cache
    expect(cachedEvents).toHaveLength(0);
  });
});

// ── 3. Dirty-cascade within composite scope ──────────────────────────────────

describe('composite journal keys — dirty cascade within scope', () => {
  it('a dirty upstream in the same subPath cascades to its dependent within the scope', async () => {
    /**
     * Within a single runChildren call, if "a" is dirty (i.e. ran fresh), then "b"
     * (which needs "a") must also re-run even if "b" has a cached journal entry.
     *
     * The composite key changes don't affect dirty-cascade logic — this test
     * confirms the mechanism still works after the refactor.
     */
    const runId = 'run-cascade-test';

    // ── First run: both a and b execute ────────────────────────────────────
    const journal1 = Journal.create(dir, runId, 'test', {});
    const dirty1 = new Set<string>();
    const events1: EngineEvent[] = [];
    const scope1 = makeScope(journal1, 'phase:Main', dirty1, events1);

    await scope1.runChildren(
      [
        { id: 'a', run: 'return 1;' },
        { id: 'b', needs: ['a'], run: 'return 2;' },
      ],
      {},
      'loop:0',
    );
    await journal1.setStatus('completed');

    // ── Second run: "a" gets a changed run body (different hash) → dirty ──
    // "b" is unchanged but must re-run because "a" is dirty.
    const journal2 = await Journal.load(dir, runId);
    const dirty2 = new Set<string>();
    const events2: EngineEvent[] = [];
    const scope2 = makeScope(journal2, 'phase:Main', dirty2, events2);

    await scope2.runChildren(
      [
        { id: 'a', run: 'return 100;' },  // different body → hash miss → dirty
        { id: 'b', needs: ['a'], run: 'return 2;' }, // same hash, but upstream dirty
      ],
      {},
      'loop:0',
    );

    const doneEvents = events2.filter((e) => e.type === 'step-done') as Array<{
      type: 'step-done';
      stepId: string;
      cached: boolean;
    }>;

    const aEvent = doneEvents.find((e) => e.stepId === 'a');
    const bEvent = doneEvents.find((e) => e.stepId === 'b');

    expect(aEvent?.cached).toBe(false); // a ran fresh (hash mismatch)
    expect(bEvent?.cached).toBe(false); // b must NOT be cached (upstream dirty)
  });
});

// ── Fix A: dirty Set keyed by composite journal key ──────────────────────────

describe('Fix A — dirty Set uses composite journal key', () => {
  it('iteration-0 dirtiness does NOT force iteration-1 dependent to re-run when its own hash matches', async () => {
    /**
     * Two sibling runChildren under subPaths x/loop:0 and x/loop:1.
     * Iteration 0 runs step "gen" fresh (makes it dirty).
     * Iteration 1 has step "dep" that `needs: ['gen']`.
     * But iteration 1's "gen" has a warm cache entry from a prior run at loop:1/gen.
     * With composite dirty keys, loop:0's gen dirty entry (`phase:X/x/loop:0/gen`)
     * must NOT cascade into loop:1's dep (`phase:X/x/loop:1/dep`).
     */
    const runId = 'run-fix-a-dirty';

    // ── Prime journal with loop:1 entries (gen + dep both cached) ────────────
    const journal1 = Journal.create(dir, runId, 'test', {});
    const dirty1 = new Set<string>();
    const scope1 = makeScope(journal1, 'phase:X', dirty1, []);

    // Simulate the loop:0 child scope running both steps to cache them
    await scope1.runChildren(
      [
        { id: 'gen', run: 'return 7;' },
        { id: 'dep', needs: ['gen'], run: 'return 8;' },
      ],
      {},
      'x/loop:1',
    );
    await journal1.setStatus('completed');

    // ── Second run: loop:0 runs gen fresh (different body → dirty) ─────────
    const journal2 = await Journal.load(dir, runId);
    const dirty2 = new Set<string>();
    const events2: EngineEvent[] = [];
    const scope2 = makeScope(journal2, 'phase:X', dirty2, events2);

    // loop:0: run gen with a different body so it's dirty
    await scope2.runChildren(
      [{ id: 'gen', run: 'return 999;' }],
      {},
      'x/loop:0',
    );

    // loop:1: dep needs gen — but loop:1/gen IS cached and so is loop:1/dep
    await scope2.runChildren(
      [
        { id: 'gen', run: 'return 7;' },
        { id: 'dep', needs: ['gen'], run: 'return 8;' },
      ],
      {},
      'x/loop:1',
    );

    const doneEvents = events2.filter((e) => e.type === 'step-done') as Array<{
      type: 'step-done';
      stepId: string;
      cached: boolean;
    }>;

    // loop:1's gen and dep must both be served from cache (no cross-iteration bleed)
    const loop1GenEvent = doneEvents.filter((e) => e.stepId === 'gen')[1]; // second gen event (loop:1)
    const loop1DepEvent = doneEvents.find((e) => e.stepId === 'dep');

    expect(loop1GenEvent?.cached).toBe(true);
    expect(loop1DepEvent?.cached).toBe(true);
  });
});

// ── 4. Root phase composite key is deterministic across runs ─────────────────

describe('composite journal keys — root phase key stability', () => {
  it('root phase steps use deterministic composite key across two runs', async () => {
    /**
     * After the composite key change, engine.ts sets journalPath = 'phase:<name>'
     * and exec.ts keys entries as '<journalPath>/<step.id>'.
     * The key for a root step becomes e.g. 'phase:Compute/double'.
     * This test confirms that the key is stable (same key both runs → v0.1 resume
     * semantics preserved).
     */
    const runId = 'run-root-stable';

    // ── First run ────────────────────────────────────────────────────────────
    const journal1 = Journal.create(dir, runId, 'test', {});
    const dirty1 = new Set<string>();
    const scope1 = makeScope(journal1, 'phase:Compute', dirty1, []);

    await runSteps([{ id: 'double', run: 'return 2;' }], scope1);
    await journal1.setStatus('completed');

    // The composite key should exist
    const loadedAfterFirst = await Journal.load(dir, runId);
    expect(loadedAfterFirst.get('phase:Compute/double')).toBeDefined();

    // ── Second run — same scope path → should be cached ──────────────────────
    const journal2 = await Journal.load(dir, runId);
    const dirty2 = new Set<string>();
    const events2: EngineEvent[] = [];
    const scope2 = makeScope(journal2, 'phase:Compute', dirty2, events2);

    await runSteps([{ id: 'double', run: 'return 2;' }], scope2);

    const cachedEvents = events2.filter(
      (e) => e.type === 'step-done' && (e as { cached?: boolean }).cached,
    );
    expect(cachedEvents).toHaveLength(1);
  });
});
