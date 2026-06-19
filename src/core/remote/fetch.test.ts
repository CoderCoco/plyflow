// src/core/remote/fetch.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as tarCreate } from 'tar';
import { ensureRepo } from './fetch.js';
import { RemoteFetchError } from './errors.js';
import type { WorkflowRef } from './ref.js';

const ref = (over: Partial<WorkflowRef> = {}): WorkflowRef => ({
  host: 'github',
  owner: 'o',
  repo: 'r',
  ref: 'main',
  subPath: 'wf.yaml',
  ...over,
});

/** Build a gzipped tarball whose single top-level dir is "r-main/" (like GitHub). */
async function fixtureTarball(work: string): Promise<Buffer> {
  const src = join(work, 'r-main');
  await mkdir(join(src, 'agents'), { recursive: true });
  await writeFile(join(src, 'wf.yaml'), 'name: demo\n');
  await writeFile(join(src, 'agents', 'a.md'), '# agent\n');
  await tarCreate({ gzip: true, cwd: work, file: join(work, 'repo.tgz') }, ['r-main']);
  return readFile(join(work, 'repo.tgz'));
}

function okResponse(body: Buffer): Response {
  return new Response(body, { status: 200 });
}

let root: string;
let work: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plyflow-root-'));
  work = await mkdtemp(join(tmpdir(), 'plyflow-work-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe('ensureRepo', () => {
  it('downloads, strips the top dir, and extracts into the cache', async () => {
    const body = await fixtureTarball(work);
    let calledUrl = '';
    const fetchImpl = (async (url: string | URL) => {
      calledUrl = String(url);
      return okResponse(body);
    }) as unknown as typeof fetch;

    const res = await ensureRepo(ref(), { cacheRoot: root, fetchImpl, now: () => 5 });

    expect(res.fetched).toBe(true);
    expect(calledUrl).toBe('https://api.github.com/repos/o/r/tarball/main');
    expect(await readFile(join(res.dir, 'wf.yaml'), 'utf8')).toBe('name: demo\n');
    expect(await readFile(join(res.dir, 'agents', 'a.md'), 'utf8')).toBe('# agent\n');
  });

  it('omits the ref segment when ref is null', async () => {
    const body = await fixtureTarball(work);
    let calledUrl = '';
    const fetchImpl = (async (url: string | URL) => {
      calledUrl = String(url);
      return okResponse(body);
    }) as unknown as typeof fetch;
    await ensureRepo(ref({ ref: null }), { cacheRoot: root, fetchImpl });
    expect(calledUrl).toBe('https://api.github.com/repos/o/r/tarball');
  });

  it('sends a bearer token when provided', async () => {
    const body = await fixtureTarball(work);
    let auth: string | null = null;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('authorization');
      return okResponse(body);
    }) as unknown as typeof fetch;
    await ensureRepo(ref(), { cacheRoot: root, fetchImpl, token: 'abc' });
    expect(auth).toBe('Bearer abc');
  });

  it('reuses the cache without re-fetching when fresh', async () => {
    const body = await fixtureTarball(work);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return okResponse(body);
    }) as unknown as typeof fetch;
    await ensureRepo(ref(), { cacheRoot: root, fetchImpl, now: () => 1000, ttlMs: 10_000 });
    const second = await ensureRepo(ref(), { cacheRoot: root, fetchImpl, now: () => 1005, ttlMs: 10_000 });
    expect(calls).toBe(1);
    expect(second.fetched).toBe(false);
  });

  it('re-fetches when refresh is set', async () => {
    const body = await fixtureTarball(work);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return okResponse(body);
    }) as unknown as typeof fetch;
    await ensureRepo(ref(), { cacheRoot: root, fetchImpl, now: () => 1000 });
    await ensureRepo(ref(), { cacheRoot: root, fetchImpl, now: () => 1001, refresh: true });
    expect(calls).toBe(2);
  });

  it('maps 404 to a RemoteFetchError naming the ref', async () => {
    const fetchImpl = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    await expect(ensureRepo(ref({ ref: 'nope' }), { cacheRoot: root, fetchImpl })).rejects.toThrow(
      RemoteFetchError,
    );
    await expect(ensureRepo(ref({ ref: 'nope' }), { cacheRoot: root, fetchImpl })).rejects.toThrow(
      /not found/i,
    );
  });

  it('maps 403 to an auth/rate-limit RemoteFetchError', async () => {
    const fetchImpl = (async () =>
      new Response('rate limited', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      })) as unknown as typeof fetch;
    await expect(ensureRepo(ref(), { cacheRoot: root, fetchImpl })).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it('does not leave a cache dir behind on failure', async () => {
    const fetchImpl = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(ensureRepo(ref(), { cacheRoot: root, fetchImpl })).rejects.toThrow();
    // Cache root has no committed entry.
    const entries = await readdir(root).catch(() => []);
    expect(entries.filter((e) => !e.includes('.tmp'))).toEqual([]);
  });

  it('aborts the request after the timeout and reports it', async () => {
    // A fetch that never resolves on its own, but honors the abort signal.
    const fetchImpl = ((_url: string | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as unknown as typeof fetch;
    await expect(
      ensureRepo(ref(), { cacheRoot: root, fetchImpl, timeoutMs: 10 }),
    ).rejects.toThrow(/timed out/i);
  });

  it('passes an AbortSignal to fetch even with no explicit timeout (default bound)', async () => {
    const body = await fixtureTarball(work);
    let sawSignal = false;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return okResponse(body);
    }) as unknown as typeof fetch;
    await ensureRepo(ref(), { cacheRoot: root, fetchImpl });
    expect(sawSignal).toBe(true);
  });
});
