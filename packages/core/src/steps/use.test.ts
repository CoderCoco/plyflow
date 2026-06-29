import { describe, it, expect } from 'vitest';
import { runWorkflow } from '../core/engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmp() { return mkdtempSync(join(tmpdir(), 'ply-use-')); }

describe('use step (sub-workflows)', () => {
  it('runs a child workflow and exposes only its declared outputs', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'child.yaml'),
      [
        'name: child',
        'inputs: { n: { type: number } }',
        'outputs: { total: "${{ steps.calc.output }}" }',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: calc',
        '        run: return ctx.inputs.n + 1',
        '      - id: secret',
        '        run: return "hidden"',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'parent.yaml'),
      [
        'name: parent',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: sub',
        '        use: ./child.yaml',
        '        with: { n: 41 }',
        '      - id: read',
        '        needs: [sub]',
        '        run: return ctx.steps.sub.output',
      ].join('\n'),
    );
    const res = await runWorkflow(join(dir, 'parent.yaml'), { provider: new FakeProvider([]), isTty: false });
    // Only declared outputs cross the boundary — `secret` is not present.
    expect(res.outputs.sub).toEqual({ total: 42 });
    expect(res.outputs.read).toEqual({ total: 42 });
  });

  it('detects a direct self-reference cycle', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'loop.yaml'),
      [
        'name: loop',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: again',
        '        use: ./loop.yaml',
      ].join('\n'),
    );
    await expect(
      runWorkflow(join(dir, 'loop.yaml'), { provider: new FakeProvider([]), isTty: false }),
    ).rejects.toThrow(/cycle/i);
  });

  it('propagates dry-run into the child', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'child.yaml'),
      [
        'name: child',
        'outputs: { out: "${{ steps.s.output.stdout }}" }',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: s',
        `        sh: node -e "process.exit(1)"`,
        `        dryRun: { stdout: "safe", code: 0 }`,
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'parent.yaml'),
      'name: parent\nphases:\n  - name: p\n    steps:\n      - id: sub\n        use: ./child.yaml\n',
    );
    const res = await runWorkflow(join(dir, 'parent.yaml'), { provider: new FakeProvider([]), isTty: false, dryRun: true });
    expect(res.outputs.sub).toEqual({ out: 'safe' });
  });
});
