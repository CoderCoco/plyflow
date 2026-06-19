// src/core/remote/fetch.ts
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { x as tarExtract } from 'tar';
import { RemoteFetchError } from './errors.js';
import type { WorkflowRef } from './ref.js';
import { cacheDir, cacheKey, defaultCacheRoot, isFresh, writeMeta } from './cache.js';

/** Default per-request timeout so a stalled socket can never hang the CLI forever. */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface EnsureRepoOptions {
  cacheRoot?: string;
  token?: string;
  refresh?: boolean;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface EnsureRepoResult {
  dir: string;
  cacheKey: string;
  fetched: boolean;
}

function tarballUrl(ref: WorkflowRef): string {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}/tarball`;
  return ref.ref ? `${base}/${ref.ref}` : base;
}

export async function ensureRepo(
  ref: WorkflowRef,
  opts: EnsureRepoOptions = {},
): Promise<EnsureRepoResult> {
  const root = opts.cacheRoot ?? defaultCacheRoot();
  const now = opts.now ?? (() => Date.now());
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const dir = cacheDir(root, ref);
  const key = cacheKey(ref);

  if (!opts.refresh && (await isFresh(dir, ref, { now, ttlMs: opts.ttlMs }))) {
    return { dir, cacheKey: key, fetched: false };
  }

  const buf = await download(ref, fetchImpl, opts.token, opts.timeoutMs);
  await extractToCache(buf, dir, ref, now);
  return { dir, cacheKey: key, fetched: true };
}

async function download(
  ref: WorkflowRef,
  fetchImpl: typeof fetch,
  token: string | undefined,
  timeoutMs?: number,
): Promise<Buffer> {
  const headers: Record<string, string> = {
    'User-Agent': 'plyflow',
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const ms = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.(); // don't keep the event loop alive on the timer's account

  let res: Response;
  try {
    res = await fetchImpl(tarballUrl(ref), { headers, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new RemoteFetchError(
        `timed out fetching ${ref.owner}/${ref.repo} after ${ms}ms`,
        { cause },
      );
    }
    throw new RemoteFetchError(
      `network error fetching ${ref.owner}/${ref.repo}: ${(cause as Error).message}`,
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw httpError(ref, res);
  return Buffer.from(await res.arrayBuffer());
}

function httpError(ref: WorkflowRef, res: Response): RemoteFetchError {
  const at = `${ref.owner}/${ref.repo}@${ref.ref ?? 'HEAD'}`;
  if (res.status === 404) {
    return new RemoteFetchError(
      `${at} not found — check the repo, the ref, and (for private repos) that GITHUB_TOKEN is set`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    const rate = res.headers.get('x-ratelimit-remaining');
    const why = rate === '0' ? 'rate limited' : 'authentication failed';
    return new RemoteFetchError(`${why} fetching ${at} — set GITHUB_TOKEN to authenticate`);
  }
  return new RemoteFetchError(`failed to fetch ${at}: HTTP ${res.status}`);
}

/** Extract the gzipped tarball into the cache dir atomically (extract to a sibling, then rename). */
async function extractToCache(
  buf: Buffer,
  dir: string,
  ref: WorkflowRef,
  now: () => number,
): Promise<void> {
  await mkdir(dirname(dir), { recursive: true });
  // Sibling temp dir → same filesystem as the cache, so rename is atomic.
  const tmpExtract = await mkdtemp(`${dir}.tmp-`);
  // Tarball itself can live in the OS temp dir (only read by tar).
  const tarWork = await mkdtemp(join(tmpdir(), 'plyflow-tar-'));
  const tarPath = join(tarWork, 'repo.tgz');
  try {
    await writeFile(tarPath, buf);
    await tarExtract({ file: tarPath, cwd: tmpExtract, strip: 1 });
    await writeMeta(tmpExtract, { fetchedAt: now(), ref: ref.ref });
    await rm(dir, { recursive: true, force: true });
    await rename(tmpExtract, dir);
  } catch (cause) {
    await rm(tmpExtract, { recursive: true, force: true });
    if (cause instanceof RemoteFetchError) throw cause;
    throw new RemoteFetchError(
      `failed to extract ${ref.owner}/${ref.repo}: ${(cause as Error).message}`,
      { cause },
    );
  } finally {
    await rm(tarWork, { recursive: true, force: true });
  }
}
