import { it, expect, vi } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import type { ShellExec } from './shell.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('runWorkflow routes sh steps through an injected shellExec', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-shinj-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        sh: echo SHOULD-NOT-RUN\n');
  const fake: ShellExec = vi.fn(async () => ({ stdout: 'mocked', stderr: '', code: 0 }));
  const res = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false, shellExec: fake });
  expect(fake).toHaveBeenCalledWith('echo SHOULD-NOT-RUN', expect.anything());
  expect((res.outputs.s as { stdout: string }).stdout).toBe('mocked');
});
