import { describe, it, expect } from 'vitest';
import { runWorkflow } from '../core/engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('sh step e2e', () => {
  it('runs a sh step end-to-end and exposes its output to later steps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ply-sh-'));
    const wf = join(dir, 'w.yaml');
    writeFileSync(
      wf,
      [
        'name: w',
        'phases:',
        '  - name: p',
        '    steps:',
        `      - id: greet`,
        `        sh: node -e "process.stdout.write('hello')"`,
        `      - id: use`,
        `        needs: [greet]`,
        `        run: return ctx.steps.greet.output.stdout + '!'`,
      ].join('\n'),
    );

    const { outputs } = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false });
    expect((outputs.greet as { stdout: string }).stdout).toBe('hello');
    expect(outputs.use).toBe('hello!');
  });

  it('dry-run returns the declared mock and never executes the command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ply-shdry-'));
    const wf = join(dir, 'w.yaml');
    writeFileSync(
      wf,
      [
        'name: w',
        'phases:',
        '  - name: p',
        '    steps:',
        `      - id: danger`,
        `        sh: node -e "process.exit(1)"`,
        `        dryRun: { stdout: "safe", code: 0 }`,
      ].join('\n'),
    );
    const { outputs } = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false, dryRun: true });
    expect((outputs.danger as { stdout: string }).stdout).toBe('safe');
  });
});
