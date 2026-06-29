import { it, expect } from 'vitest';
import { runWorkflow } from '../core/engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('two workflows share one setup sub-workflow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-share-'));
  writeFileSync(
    join(dir, 'setup.yaml'),
    [
      'name: setup',
      'inputs: { issue: { type: string, required: true } }',
      'outputs: { branch: "${{ steps.b.output }}" }',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: b',
      '        run: return "issue-" + ctx.inputs.issue',
    ].join('\n'),
  );
  const mk = (name: string) =>
    writeFileSync(
      join(dir, `${name}.yaml`),
      [
        `name: ${name}`,
        'inputs: { issue: { type: string, required: true } }',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: setup',
        '        use: ./setup.yaml',
        '        with: { issue: "${{ inputs.issue }}" }',
        '      - id: use',
        '        needs: [setup]',
        '        run: return ctx.steps.setup.output.branch',
      ].join('\n'),
    );
  mk('mission');
  mk('comms');
  for (const name of ['mission', 'comms']) {
    const res = await runWorkflow(join(dir, `${name}.yaml`), { provider: new FakeProvider([]), isTty: false, inputs: { issue: '7' } });
    expect(res.outputs.use).toBe('issue-7');
  }
});
