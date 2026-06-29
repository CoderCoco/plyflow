import { it, expect } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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

it('rejects and marks the run failed when an outputs expression throws', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'ply-out-fail-run-'));
  const dir = mkdtempSync(join(tmpdir(), 'ply-out-fail-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(
    wf,
    [
      'name: w',
      'outputs:',
      '  bad: "${{ steps.missing.output.x.y }}"',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: s',
      '        run: return 1',
    ].join('\n'),
  );
  await expect(
    runWorkflow(wf, { provider: new FakeProvider([]), isTty: false, runDir }),
  ).rejects.toThrow();

  // Verify journal status is 'failed'
  const journalFiles = readdirSync(runDir).filter((f) => f.endsWith('.json'));
  expect(journalFiles.length).toBe(1);
  const journalContent = readFileSync(join(runDir, journalFiles[0]), 'utf-8');
  const journal = JSON.parse(journalContent);
  expect(journal.status).toBe('failed');
});
