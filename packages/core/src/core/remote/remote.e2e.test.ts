// src/core/remote/remote.e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as tarCreate } from 'tar';
import { resolveWorkflowSource } from './resolve.js';
import { runWorkflow } from '../engine.js';

/** A repo tarball whose top dir is "r-main/" containing a runnable workflow. */
async function fixtureTarball(work: string): Promise<Buffer> {
  const src = join(work, 'r-main');
  await mkdir(src, { recursive: true });
  await writeFile(
    join(src, 'wf.yaml'),
    [
      'name: remote-demo',
      'inputs:',
      '  n: { type: number, required: true }',
      'phases:',
      '  - name: Compute',
      '    steps:',
      '      - id: double',
      '        run: "return ctx.inputs.n * 2;"',
    ].join('\n'),
  );
  await tarCreate({ gzip: true, cwd: work, file: join(work, 'repo.tgz') }, ['r-main']);
  return readFile(join(work, 'repo.tgz'));
}

let root: string;
let work: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plyflow-e2e-'));
  work = await mkdtemp(join(tmpdir(), 'plyflow-e2e-work-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe('remote workflow end to end', () => {
  it('resolves from a tarball and runs through the unchanged engine', async () => {
    const body = await fixtureTarball(work);
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

    const resolved = await resolveWorkflowSource('github:o/r/wf.yaml@main', {
      cacheRoot: root,
      fetchImpl,
      env: {},
    });

    const events: string[] = [];
    const { outputs } = await runWorkflow(resolved.localPath, {
      inputs: { n: 21 },
      provider: { name: 'noop', complete: async () => ({ text: '' }) } as never,
      onEvent: (e) => events.push(e.type),
      prompt: async () => {
        throw new Error('no prompt expected');
      },
    });

    expect(outputs.double).toBe(42);
    expect(events).toContain('phase-start');
  }, 30000);
});
