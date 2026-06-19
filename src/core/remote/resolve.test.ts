// src/core/remote/resolve.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as tarCreate } from 'tar';
import { resolveWorkflowSource } from './resolve.js';
import { RemoteFetchError } from './errors.js';

async function fixtureTarball(work: string): Promise<Buffer> {
  const src = join(work, 'r-main', 'examples');
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'wf.yaml'), 'name: demo\n');
  await tarCreate({ gzip: true, cwd: work, file: join(work, 'repo.tgz') }, ['r-main']);
  return readFile(join(work, 'repo.tgz'));
}

let root: string;
let work: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plyflow-resolve-'));
  work = await mkdtemp(join(tmpdir(), 'plyflow-work-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe('resolveWorkflowSource', () => {
  it('passes a local path straight through', async () => {
    const r = await resolveWorkflowSource('./examples/summarize.yaml');
    expect(r).toEqual({ localPath: './examples/summarize.yaml', remote: null });
  });

  it('fetches a remote ref and returns the local path to the workflow', async () => {
    const body = await fixtureTarball(work);
    let capturedUrl: string | undefined;
    const fetchImpl = (async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await resolveWorkflowSource('github:o/r/examples/wf.yaml@main', {
      cacheRoot: root,
      fetchImpl,
      env: {},
    });
    expect(capturedUrl).toBe('https://api.github.com/repos/o/r/tarball/main');
    expect(r.remote?.owner).toBe('o');
    expect(r.repoDir).toBe(join(root, 'o-r@main'));
    expect(await readFile(r.localPath, 'utf8')).toBe('name: demo\n');
  });

  it('throws when the subPath is absent from the repo', async () => {
    const body = await fixtureTarball(work);
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveWorkflowSource('github:o/r/examples/missing.yaml@main', {
        cacheRoot: root,
        fetchImpl,
        env: {},
      }),
    ).rejects.toThrow(RemoteFetchError);
  });

  it('reads the token from env when not passed explicitly', async () => {
    const body = await fixtureTarball(work);
    let auth: string | null = null;
    const fetchImpl = (async (_u: string | URL, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('authorization');
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    await resolveWorkflowSource('github:o/r/examples/wf.yaml@main', {
      cacheRoot: root,
      fetchImpl,
      env: { GH_TOKEN: 'from-env' },
    });
    expect(auth).toBe('Bearer from-env');
  });
});
