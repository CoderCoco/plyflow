import { it, expect } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('an object input flows through a stdlib helper to a step output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-a2-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(
    wf,
    [
      'name: w',
      'inputs:',
      '  roles: { type: object }',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: names',
      '        run: return ctx.with.v',
      '        with: { v: "${{ keys(inputs.roles) }}" }',
    ].join('\n'),
  );
  const { outputs } = await runWorkflow(wf, {
    provider: new FakeProvider([]),
    isTty: false,
    inputs: { roles: { planner: 'opus', worker: 'sonnet' } },
  });
  expect(outputs.names).toEqual(['planner', 'worker']);
});
