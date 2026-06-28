import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

describe('plyflow CLI (non-TTY)', () => {
  it('runs a workflow end to end and logs step completion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plyflow-cli-'));
    const wfPath = join(dir, 'wf.yaml');
    await writeFile(
      wfPath,
      [
        'name: cli-demo',
        'inputs:',
        '  n: { type: number, required: true }',
        'phases:',
        '  - name: Compute',
        '    steps:',
        '      - id: double',
        '        run: "return ctx.inputs.n * 2;"',
      ].join('\n'),
    );
    // Run via tsx so we execute the TS source without a build step.
    const { stdout } = await run('npx', ['tsx', 'src/index.ts', 'run', wfPath, '--input', 'n=5'], {
      cwd: process.cwd(),
      env: { ...process.env },
    });
    expect(stdout).toContain('Compute');
    expect(stdout).toContain('double');
    await rm(dir, { recursive: true, force: true });
  }, 30000);
});
