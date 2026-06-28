import { describe, it, expect } from 'vitest';
import { runWorkflow, buildDefaultRegistry } from '../core/engine.js';
import { StepRegistry } from './registry.js';
import type { StepType } from './types.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function probeRegistry(seen: { dryRun?: boolean }): StepRegistry {
  const reg = buildDefaultRegistry();
  const probe: StepType = {
    name: 'probe',
    match: (d) => d.step === 'probe',
    parse: () => ({}),
    run: async (_cfg, ctx) => {
      seen.dryRun = ctx.dryRun;
      return { output: ctx.dryRun };
    },
  };
  reg.register(probe);
  return reg;
}

it('exposes dryRun on the step context (default false; true when requested)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        step: probe\n');

  const seenA: { dryRun?: boolean } = {};
  await runWorkflow(wf, { provider: new FakeProvider([]), registry: probeRegistry(seenA), isTty: false });
  expect(seenA.dryRun).toBe(false);

  const seenB: { dryRun?: boolean } = {};
  await runWorkflow(wf, { provider: new FakeProvider([]), registry: probeRegistry(seenB), isTty: false, dryRun: true });
  expect(seenB.dryRun).toBe(true);
});
