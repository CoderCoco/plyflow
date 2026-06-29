import { it, expect } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('evaluates the outputs block and returns declaredOutputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-out-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(
    wf,
    [
      'name: w',
      'outputs:',
      '  doubled: ${{ steps.n.output }}',
      '  label: "v-${{ inputs.tag }}"',
      'inputs: { tag: { type: string } }',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: n',
      '        run: return 21 * 2',
    ].join('\n'),
  );
  const res = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false, inputs: { tag: 'x' } });
  expect(res.declaredOutputs).toEqual({ doubled: 42, label: 'v-x' });
});

it('declaredOutputs is {} when no outputs block is declared', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-noout-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        run: return 1\n');
  const res = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false });
  expect(res.declaredOutputs).toEqual({});
});
