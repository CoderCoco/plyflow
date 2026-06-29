import { it, expect } from 'vitest';
import { runWorkflow, buildDefaultRegistry } from '../core/engine.js';
import type { StepType } from './types.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function probeRegistry(seen: { chain?: string[] }) {
  const reg = buildDefaultRegistry();
  const probe: StepType = {
    name: 'probe',
    match: (d) => d.step === 'probe',
    parse: () => ({}),
    run: async (_c, ctx) => {
      seen.chain = ctx.useChain;
      return { output: ctx.useChain ?? [] };
    },
  };
  reg.register(probe);
  return reg;
}

it('exposes useChain on the step context (default empty; set when provided)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-uc-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        step: probe\n');

  const a: { chain?: string[] } = {};
  await runWorkflow(wf, { provider: new FakeProvider([]), registry: probeRegistry(a), isTty: false });
  expect(a.chain ?? []).toEqual([]);

  const b: { chain?: string[] } = {};
  await runWorkflow(wf, { provider: new FakeProvider([]), registry: probeRegistry(b), isTty: false, useChain: ['/p/a.yaml'] });
  expect(b.chain).toEqual(['/p/a.yaml']);
});
