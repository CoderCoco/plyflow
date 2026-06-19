# Remote Workflows from GitHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users run a plyflow workflow directly from a GitHub repo (`plyflow run github:org/repo/path.yaml@ref` or a full GitHub URL) by fetching the repo as a tarball, caching it, and running the existing engine unchanged against the cached copy.

**Architecture:** A new `src/core/remote/` module resolves a remote reference into a **local filesystem path** before the run flow starts. `parseWorkflowRef` recognises the two reference syntaxes; `ensureRepo` downloads + extracts the repo tarball into a global cache; `resolveWorkflowSource` ties them together and returns a local path that feeds the *unchanged* `loadWorkflow`/`runWorkflow`. A trust gate (content-hash, warn-and-confirm on first run) lives at the CLI boundary.

**Tech Stack:** TypeScript (ESM, Node ≥24), vitest, Node built-in `fetch`/`fs`/`crypto`/`readline`, `tar` (new dependency, the only one).

## Global Constraints

- Node `>=24`, `"type": "module"` — all relative imports use the `.js` extension (e.g. `import { x } from './ref.js'`), even from `.ts` source.
- Tests use **vitest** (`describe`/`it`/`expect`), run with `npm test` (`vitest run`). Fixtures live in a sibling `__fixtures__/` directory.
- Inject side effects for testability: every network/clock/cache-root dependency is an **optional function/param** with a real default (`fetchImpl = globalThis.fetch`, `now = () => Date.now()`, `cacheRoot = defaultCacheRoot()`). No real network in unit tests.
- New deps limited to **`tar`** only. Everything else uses Node built-ins.
- CLI keeps its existing **hand-rolled** arg style (no commander/yargs) — see `src/cli/args.ts`.
- All fetch/parse failures throw a typed `RemoteFetchError` so the CLI prints a clean one-line message (it already does `plyflow: ${err.message}` in `src/cli/index.ts:85-88`).
- Lint with `npm run lint` before each commit.

---

### Task 1: Remote reference parsing + typed error

**Files:**
- Create: `src/core/remote/errors.ts`
- Create: `src/core/remote/ref.ts`
- Test: `src/core/remote/ref.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `class RemoteFetchError extends Error` (constructor `(message: string, options?: { cause?: unknown })`; sets `name = 'RemoteFetchError'`).
  - `interface WorkflowRef { host: 'github'; owner: string; repo: string; ref: string | null; subPath: string }`
  - `function parseWorkflowRef(arg: string): WorkflowRef | null` — returns `null` when `arg` is a plain local path; returns a `WorkflowRef` for a valid remote ref; throws `RemoteFetchError` when `arg` clearly *looks* remote (`github:` prefix or a `github.com` URL) but cannot be parsed. `ref: null` means "default branch".

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/remote/ref.test.ts
import { describe, it, expect } from 'vitest';
import { parseWorkflowRef } from './ref.js';
import { RemoteFetchError } from './errors.js';

describe('parseWorkflowRef', () => {
  it('returns null for a plain local path', () => {
    expect(parseWorkflowRef('./examples/summarize.yaml')).toBeNull();
    expect(parseWorkflowRef('/abs/wf.yaml')).toBeNull();
    expect(parseWorkflowRef('wf.yaml')).toBeNull();
  });

  it('parses shorthand without a ref', () => {
    expect(parseWorkflowRef('github:org/repo/examples/mission/mission.yaml')).toEqual({
      host: 'github',
      owner: 'org',
      repo: 'repo',
      ref: null,
      subPath: 'examples/mission/mission.yaml',
    });
  });

  it('parses shorthand with a ref after the last @', () => {
    expect(parseWorkflowRef('github:org/repo/path/wf.yaml@v1.2.0')).toEqual({
      host: 'github',
      owner: 'org',
      repo: 'repo',
      ref: 'v1.2.0',
      subPath: 'path/wf.yaml',
    });
  });

  it('parses a full github.com blob URL', () => {
    expect(
      parseWorkflowRef('https://github.com/org/repo/blob/main/examples/mission/mission.yaml'),
    ).toEqual({
      host: 'github',
      owner: 'org',
      repo: 'repo',
      ref: 'main',
      subPath: 'examples/mission/mission.yaml',
    });
  });

  it('parses a github.com tree URL the same way', () => {
    expect(parseWorkflowRef('https://github.com/o/r/tree/dev/a/b.yaml')?.ref).toBe('dev');
  });

  it('throws RemoteFetchError on a malformed github: ref', () => {
    expect(() => parseWorkflowRef('github:org/repo')).toThrow(RemoteFetchError);
    expect(() => parseWorkflowRef('github:org/repo')).toThrow(/github:owner\/repo\/path/);
  });

  it('throws RemoteFetchError on a github.com URL with no file path', () => {
    expect(() => parseWorkflowRef('https://github.com/org/repo')).toThrow(RemoteFetchError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/remote/ref.test.ts`
Expected: FAIL — `Cannot find module './ref.js'` / `'./errors.js'`.

- [ ] **Step 3: Write the error class**

```typescript
// src/core/remote/errors.ts

/** Thrown for any remote-workflow resolution failure. The CLI prints message only. */
export class RemoteFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RemoteFetchError';
  }
}
```

- [ ] **Step 4: Write the ref parser**

```typescript
// src/core/remote/ref.ts
import { RemoteFetchError } from './errors.js';

export interface WorkflowRef {
  host: 'github';
  owner: string;
  repo: string;
  /** null means the repo default branch. */
  ref: string | null;
  /** Path to the workflow file within the repo, e.g. "examples/mission/mission.yaml". */
  subPath: string;
}

const SHORTHAND = 'github:';

const FORMS =
  'expected "github:owner/repo/path/to/workflow.yaml@ref" ' +
  'or "https://github.com/owner/repo/blob/<ref>/path/to/workflow.yaml"';

export function parseWorkflowRef(arg: string): WorkflowRef | null {
  if (arg.startsWith(SHORTHAND)) return parseShorthand(arg.slice(SHORTHAND.length));
  if (arg.startsWith('https://github.com/') || arg.startsWith('http://github.com/')) {
    return parseUrl(arg);
  }
  return null; // plain local path — preserve current behaviour
}

function parseShorthand(body: string): WorkflowRef {
  // Split the optional "@ref" off the end (last '@' wins).
  let ref: string | null = null;
  const at = body.lastIndexOf('@');
  if (at !== -1) {
    ref = body.slice(at + 1) || null;
    body = body.slice(0, at);
  }
  const parts = body.split('/').filter((p) => p.length > 0);
  if (parts.length < 3) {
    throw new RemoteFetchError(`could not parse remote workflow "${SHORTHAND}${body}"; ${FORMS}`);
  }
  const [owner, repo, ...sub] = parts;
  return { host: 'github', owner: owner!, repo: repo!, ref, subPath: sub.join('/') };
}

function parseUrl(arg: string): WorkflowRef {
  let url: URL;
  try {
    url = new URL(arg);
  } catch {
    throw new RemoteFetchError(`could not parse remote workflow URL "${arg}"; ${FORMS}`);
  }
  // /owner/repo/(blob|tree|raw)/<ref>/<sub...>
  const seg = url.pathname.split('/').filter((p) => p.length > 0);
  const kind = seg[2];
  if (seg.length < 5 || (kind !== 'blob' && kind !== 'tree' && kind !== 'raw')) {
    throw new RemoteFetchError(`could not parse remote workflow URL "${arg}"; ${FORMS}`);
  }
  return {
    host: 'github',
    owner: seg[0]!,
    repo: seg[1]!,
    ref: seg[3]!,
    subPath: seg.slice(4).join('/'),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/remote/ref.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/core/remote/errors.ts src/core/remote/ref.ts src/core/remote/ref.test.ts
git commit -m "feat(remote): parse github workflow references"
```

---

### Task 2: Cache path + freshness policy

**Files:**
- Create: `src/core/remote/cache.ts`
- Test: `src/core/remote/cache.test.ts`

**Interfaces:**
- Consumes: `WorkflowRef` from `./ref.js`.
- Produces:
  - `function defaultCacheRoot(): string` → `<homedir>/.plyflow/cache`.
  - `function cacheKey(ref: WorkflowRef): string` → `` `${owner}-${repo}@${ref.ref ?? 'HEAD'}` ``.
  - `function cacheDir(cacheRoot: string, ref: WorkflowRef): string` → `join(cacheRoot, cacheKey(ref))`.
  - `function isImmutableRef(ref: string | null): boolean` → true only for a 40-char hex SHA.
  - `interface CacheMeta { fetchedAt: number; ref: string | null }`
  - `function writeMeta(dir: string, meta: CacheMeta): Promise<void>` — writes `<dir>/.plyflow-meta.json`.
  - `function isFresh(dir: string, ref: WorkflowRef, opts?: { now?: () => number; ttlMs?: number }): Promise<boolean>` — false if no meta file; true if immutable ref and dir exists; else `now - fetchedAt < ttlMs` (default ttl 3_600_000).
  - `const META_FILE = '.plyflow-meta.json'`

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/remote/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cacheKey,
  cacheDir,
  isImmutableRef,
  isFresh,
  writeMeta,
  defaultCacheRoot,
} from './cache.js';
import type { WorkflowRef } from './ref.js';

const ref = (over: Partial<WorkflowRef> = {}): WorkflowRef => ({
  host: 'github',
  owner: 'o',
  repo: 'r',
  ref: 'main',
  subPath: 'wf.yaml',
  ...over,
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plyflow-cache-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cache key + paths', () => {
  it('builds a key from owner, repo and ref', () => {
    expect(cacheKey(ref())).toBe('o-r@main');
    expect(cacheKey(ref({ ref: null }))).toBe('o-r@HEAD');
  });

  it('places the dir under the cache root', () => {
    expect(cacheDir(root, ref())).toBe(join(root, 'o-r@main'));
  });

  it('defaultCacheRoot ends with .plyflow/cache', () => {
    expect(defaultCacheRoot().replace(/\\/g, '/')).toMatch(/\.plyflow\/cache$/);
  });
});

describe('isImmutableRef', () => {
  it('treats a 40-hex SHA as immutable', () => {
    expect(isImmutableRef('a'.repeat(40))).toBe(true);
  });
  it('treats branches, tags and null as mutable', () => {
    expect(isImmutableRef('main')).toBe(false);
    expect(isImmutableRef('v1.2.0')).toBe(false);
    expect(isImmutableRef(null)).toBe(false);
  });
});

describe('isFresh', () => {
  it('is false when no meta file exists', async () => {
    const dir = cacheDir(root, ref());
    await mkdir(dir, { recursive: true });
    expect(await isFresh(dir, ref())).toBe(false);
  });

  it('is true for an immutable ref once extracted', async () => {
    const r = ref({ ref: 'b'.repeat(40) });
    const dir = cacheDir(root, r);
    await mkdir(dir, { recursive: true });
    await writeMeta(dir, { fetchedAt: 0, ref: r.ref });
    expect(await isFresh(dir, r, { now: () => 999_999_999 })).toBe(true);
  });

  it('honours the TTL for mutable refs', async () => {
    const dir = cacheDir(root, ref());
    await mkdir(dir, { recursive: true });
    await writeMeta(dir, { fetchedAt: 1000, ref: 'main' });
    expect(await isFresh(dir, ref(), { now: () => 1000 + 500, ttlMs: 1000 })).toBe(true);
    expect(await isFresh(dir, ref(), { now: () => 1000 + 2000, ttlMs: 1000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/remote/cache.test.ts`
Expected: FAIL — `Cannot find module './cache.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/remote/cache.ts
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowRef } from './ref.js';

export const META_FILE = '.plyflow-meta.json';
const DEFAULT_TTL_MS = 3_600_000; // 1 hour

export interface CacheMeta {
  fetchedAt: number;
  ref: string | null;
}

export function defaultCacheRoot(): string {
  return join(homedir(), '.plyflow', 'cache');
}

export function cacheKey(ref: WorkflowRef): string {
  return `${ref.owner}-${ref.repo}@${ref.ref ?? 'HEAD'}`;
}

export function cacheDir(cacheRoot: string, ref: WorkflowRef): string {
  return join(cacheRoot, cacheKey(ref));
}

export function isImmutableRef(ref: string | null): boolean {
  return ref !== null && /^[0-9a-f]{40}$/i.test(ref);
}

export async function writeMeta(dir: string, meta: CacheMeta): Promise<void> {
  await writeFile(join(dir, META_FILE), JSON.stringify(meta), 'utf8');
}

export async function isFresh(
  dir: string,
  ref: WorkflowRef,
  opts: { now?: () => number; ttlMs?: number } = {},
): Promise<boolean> {
  const now = opts.now ?? (() => Date.now());
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  let meta: CacheMeta;
  try {
    meta = JSON.parse(await readFile(join(dir, META_FILE), 'utf8')) as CacheMeta;
  } catch {
    return false; // not extracted (or partial) — treat as stale
  }
  if (isImmutableRef(ref.ref)) return true;
  return now() - meta.fetchedAt < ttlMs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/remote/cache.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/core/remote/cache.ts src/core/remote/cache.test.ts
git commit -m "feat(remote): cache paths and freshness policy"
```

---

### Task 3: Tarball fetch + atomic extraction

**Files:**
- Create: `src/core/remote/fetch.ts`
- Test: `src/core/remote/fetch.test.ts`
- Modify: `package.json` (add `tar` dependency)

**Interfaces:**
- Consumes: `WorkflowRef` (`./ref.js`); `cacheDir`, `isFresh`, `writeMeta`, `defaultCacheRoot` (`./cache.js`); `RemoteFetchError` (`./errors.js`).
- Produces:
  - `interface EnsureRepoOptions { cacheRoot?: string; token?: string; refresh?: boolean; ttlMs?: number; now?: () => number; fetchImpl?: typeof fetch }`
  - `interface EnsureRepoResult { dir: string; cacheKey: string; fetched: boolean }`
  - `function ensureRepo(ref: WorkflowRef, opts?: EnsureRepoOptions): Promise<EnsureRepoResult>` — returns the cache dir (extracted repo root), downloading + extracting only when the cache is stale or `refresh` is set. Uses `https://api.github.com/repos/{owner}/{repo}/tarball[/{ref}]` (302-redirects to a pre-signed codeload URL; works for private repos when `token` is set). Maps non-2xx responses to `RemoteFetchError`.

- [ ] **Step 1: Add the `tar` dependency**

```bash
npm install tar@^7
```

Expected: `package.json` `dependencies` now includes `"tar": "^7..."`. (`tar` v7 ships its own types — no `@types/tar`.)

- [ ] **Step 2: Write the failing test**

```typescript
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/remote/fetch.test.ts`
Expected: FAIL — `Cannot find module './fetch.js'`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/core/remote/fetch.ts
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { x as tarExtract } from 'tar';
import { RemoteFetchError } from './errors.js';
import type { WorkflowRef } from './ref.js';
import { cacheDir, cacheKey, defaultCacheRoot, isFresh, writeMeta } from './cache.js';

export interface EnsureRepoOptions {
  cacheRoot?: string;
  token?: string;
  refresh?: boolean;
  ttlMs?: number;
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

  const buf = await download(ref, fetchImpl, opts.token);
  await extractToCache(buf, dir, ref, now);
  return { dir, cacheKey: key, fetched: true };
}

async function download(
  ref: WorkflowRef,
  fetchImpl: typeof fetch,
  token: string | undefined,
): Promise<Buffer> {
  const headers: Record<string, string> = {
    'User-Agent': 'plyflow',
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetchImpl(tarballUrl(ref), { headers });
  } catch (cause) {
    throw new RemoteFetchError(
      `network error fetching ${ref.owner}/${ref.repo}: ${(cause as Error).message}`,
      { cause },
    );
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/remote/fetch.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add package.json package-lock.json src/core/remote/fetch.ts src/core/remote/fetch.test.ts
git commit -m "feat(remote): fetch and extract repo tarball into cache"
```

---

### Task 4: Trust store (content hash + trust-on-first-use record)

**Files:**
- Create: `src/core/remote/trust.ts`
- Test: `src/core/remote/trust.test.ts`

**Interfaces:**
- Consumes: `WorkflowRef` (`./ref.js`).
- Produces:
  - `function hashDir(dir: string): Promise<string>` — deterministic sha256 over the sorted relative file paths and their contents, **skipping** `node_modules/`, `.git/`, and the `.plyflow-meta.json` marker.
  - `function trustKey(ref: WorkflowRef): string` → `` `${owner}/${repo}:${subPath}` ``.
  - `interface TrustOptions { storePath?: string }` (default store `<homedir>/.plyflow/trust.json`).
  - `function isTrusted(key: string, hash: string, opts?: TrustOptions): Promise<boolean>` — true iff the store maps `key` to exactly `hash`.
  - `function recordTrust(key: string, hash: string, opts?: TrustOptions): Promise<void>` — upserts `key → hash` in the JSON store (creating it if absent).

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/remote/trust.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashDir, trustKey, isTrusted, recordTrust } from './trust.js';
import type { WorkflowRef } from './ref.js';

let dir: string;
let store: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-trust-'));
  store = join(dir, 'trust.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('hashDir', () => {
  it('is stable across calls and ignores the meta marker', async () => {
    const wf = join(dir, 'wf');
    await mkdir(wf, { recursive: true });
    await writeFile(join(wf, 'wf.yaml'), 'name: demo\n');
    const h1 = await hashDir(wf);
    await writeFile(join(wf, '.plyflow-meta.json'), '{"fetchedAt":1,"ref":"main"}');
    const h2 = await hashDir(wf);
    expect(h1).toBe(h2);
  });

  it('changes when content changes', async () => {
    const wf = join(dir, 'wf');
    await mkdir(wf, { recursive: true });
    await writeFile(join(wf, 'wf.yaml'), 'name: a\n');
    const h1 = await hashDir(wf);
    await writeFile(join(wf, 'wf.yaml'), 'name: b\n');
    const h2 = await hashDir(wf);
    expect(h1).not.toBe(h2);
  });
});

describe('trustKey', () => {
  it('combines owner/repo and subPath', () => {
    const ref: WorkflowRef = { host: 'github', owner: 'o', repo: 'r', ref: 'main', subPath: 'a/wf.yaml' };
    expect(trustKey(ref)).toBe('o/r:a/wf.yaml');
  });
});

describe('trust store', () => {
  it('is not trusted before recording', async () => {
    expect(await isTrusted('o/r:wf', 'h1', { storePath: store })).toBe(false);
  });

  it('is trusted only for the exact recorded hash', async () => {
    await recordTrust('o/r:wf', 'h1', { storePath: store });
    expect(await isTrusted('o/r:wf', 'h1', { storePath: store })).toBe(true);
    expect(await isTrusted('o/r:wf', 'h2', { storePath: store })).toBe(false);
  });

  it('upserts without dropping other keys', async () => {
    await recordTrust('a', '1', { storePath: store });
    await recordTrust('b', '2', { storePath: store });
    expect(await isTrusted('a', '1', { storePath: store })).toBe(true);
    expect(await isTrusted('b', '2', { storePath: store })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/remote/trust.test.ts`
Expected: FAIL — `Cannot find module './trust.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/remote/trust.ts
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import type { WorkflowRef } from './ref.js';
import { META_FILE } from './cache.js';

const SKIP_DIRS = new Set(['node_modules', '.git']);

export interface TrustOptions {
  storePath?: string;
}

function defaultStorePath(): string {
  return join(homedir(), '.plyflow', 'trust.json');
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), base, out);
    } else if (e.isFile()) {
      if (e.name === META_FILE) continue;
      out.push(join(dir, e.name));
    }
  }
}

export async function hashDir(dir: string): Promise<string> {
  const files: string[] = [];
  await walk(dir, dir, files);
  // Sort by POSIX-normalised relative path for cross-platform stability.
  const rel = (p: string) => relative(dir, p).split(sep).join('/');
  files.sort((a, b) => rel(a).localeCompare(rel(b)));
  const h = createHash('sha256');
  for (const f of files) {
    h.update(rel(f));
    h.update('\0');
    h.update(await readFile(f));
    h.update('\0');
  }
  return h.digest('hex');
}

export function trustKey(ref: WorkflowRef): string {
  return `${ref.owner}/${ref.repo}:${ref.subPath}`;
}

async function readStore(storePath: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(storePath, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function isTrusted(key: string, hash: string, opts: TrustOptions = {}): Promise<boolean> {
  const store = await readStore(opts.storePath ?? defaultStorePath());
  return store[key] === hash;
}

export async function recordTrust(key: string, hash: string, opts: TrustOptions = {}): Promise<void> {
  const storePath = opts.storePath ?? defaultStorePath();
  const store = await readStore(storePath);
  store[key] = hash;
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/remote/trust.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/core/remote/trust.ts src/core/remote/trust.test.ts
git commit -m "feat(remote): content-hash trust store"
```

---

### Task 5: Resolver orchestrator

**Files:**
- Create: `src/core/remote/resolve.ts`
- Create: `src/core/remote/index.ts` (barrel re-export for the module's public surface)
- Test: `src/core/remote/resolve.test.ts`

**Interfaces:**
- Consumes: `parseWorkflowRef`, `WorkflowRef` (`./ref.js`); `ensureRepo` (`./fetch.js`); `RemoteFetchError` (`./errors.js`).
- Produces:
  - `interface ResolveOptions { cacheRoot?: string; token?: string; refresh?: boolean; ttlMs?: number; now?: () => number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv }`
  - `interface ResolvedSource { localPath: string; remote: WorkflowRef | null; repoDir?: string }`
  - `function resolveWorkflowSource(arg: string, opts?: ResolveOptions): Promise<ResolvedSource>` — for a local path returns `{ localPath: arg, remote: null }`; for a remote ref fetches the repo, verifies the subPath exists in the extracted tree (throws `RemoteFetchError` if not), and returns the absolute `localPath` plus `repoDir`. Token defaults to `opts.token ?? env.GITHUB_TOKEN ?? env.GH_TOKEN`.
- `index.ts` re-exports: `parseWorkflowRef`, `resolveWorkflowSource`, `RemoteFetchError`, and the `WorkflowRef`/`ResolvedSource` types.

- [ ] **Step 1: Write the failing test**

```typescript
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
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const r = await resolveWorkflowSource('github:o/r/examples/wf.yaml@main', {
      cacheRoot: root,
      fetchImpl,
      env: {},
    });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/remote/resolve.test.ts`
Expected: FAIL — `Cannot find module './resolve.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/remote/resolve.ts
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseWorkflowRef, type WorkflowRef } from './ref.js';
import { ensureRepo } from './fetch.js';
import { RemoteFetchError } from './errors.js';

export interface ResolveOptions {
  cacheRoot?: string;
  token?: string;
  refresh?: boolean;
  ttlMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedSource {
  /** Absolute (remote) or as-given (local) path to the workflow YAML on disk. */
  localPath: string;
  remote: WorkflowRef | null;
  /** Cache dir root, present only for remote sources. */
  repoDir?: string;
}

export async function resolveWorkflowSource(
  arg: string,
  opts: ResolveOptions = {},
): Promise<ResolvedSource> {
  const ref = parseWorkflowRef(arg);
  if (ref === null) return { localPath: arg, remote: null };

  const env = opts.env ?? process.env;
  const token = opts.token ?? env.GITHUB_TOKEN ?? env.GH_TOKEN;

  const { dir } = await ensureRepo(ref, {
    cacheRoot: opts.cacheRoot,
    token,
    refresh: opts.refresh,
    ttlMs: opts.ttlMs,
    now: opts.now,
    fetchImpl: opts.fetchImpl,
  });

  const localPath = join(dir, ref.subPath);
  try {
    await access(localPath);
  } catch {
    throw new RemoteFetchError(
      `workflow file "${ref.subPath}" not found in ${ref.owner}/${ref.repo}@${ref.ref ?? 'HEAD'}`,
    );
  }
  return { localPath, remote: ref, repoDir: dir };
}
```

```typescript
// src/core/remote/index.ts
export { parseWorkflowRef } from './ref.js';
export type { WorkflowRef } from './ref.js';
export { resolveWorkflowSource } from './resolve.js';
export type { ResolveOptions, ResolvedSource } from './resolve.js';
export { RemoteFetchError } from './errors.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/remote/resolve.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole remote module suite**

Run: `npx vitest run src/core/remote`
Expected: PASS (all of Tasks 1–5).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/core/remote/resolve.ts src/core/remote/index.ts src/core/remote/resolve.test.ts
git commit -m "feat(remote): resolveWorkflowSource orchestrator"
```

---

### Task 6: CLI flags (`--refresh`, `--yes`)

**Files:**
- Modify: `src/cli/args.ts`
- Test: `src/cli/args.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ParsedArgs` gains `refresh: boolean` and `yes: boolean`. `--yes` has alias `-y`. Both default to `false`. Existing fields (`workflow`, `inputs`, `resume`) are unchanged.

- [ ] **Step 1: Add failing tests**

Append to `src/cli/args.test.ts`:

```typescript
  it('defaults refresh and yes to false', () => {
    const a = parseArgs(['run', './wf.yaml']);
    expect(a.refresh).toBe(false);
    expect(a.yes).toBe(false);
  });

  it('parses --refresh, --yes and -y', () => {
    const a = parseArgs(['run', 'github:o/r/wf.yaml@main', '--refresh', '--yes']);
    expect(a.workflow).toBe('github:o/r/wf.yaml@main');
    expect(a.refresh).toBe(true);
    expect(a.yes).toBe(true);
    expect(parseArgs(['run', './wf.yaml', '-y']).yes).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/args.test.ts`
Expected: FAIL — `a.refresh` is `undefined` (property absent).

- [ ] **Step 3: Implement the flags**

Replace the body of `src/cli/args.ts` with:

```typescript
export interface ParsedArgs {
  workflow: string;
  inputs: Record<string, string>;
  resume?: string;
  refresh: boolean;
  yes: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] !== 'run') throw new Error(`unknown command "${argv[0] ?? ''}"; expected: run`);
  const rest = argv.slice(1);
  const inputs: Record<string, string> = {};
  let workflow: string | undefined;
  let resume: string | undefined;
  let refresh = false;
  let yes = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--input') {
      const pair = rest[++i] ?? '';
      const eq = pair.indexOf('=');
      if (eq === -1) throw new Error(`--input expects key=value, got "${pair}"`);
      inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === '--resume') {
      resume = rest[++i];
    } else if (arg === '--refresh') {
      refresh = true;
    } else if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (!arg.startsWith('-')) {
      workflow = arg;
    }
  }

  if (!workflow) throw new Error('no workflow file given; usage: plyflow run <file.yaml>');
  return { workflow, inputs, resume, refresh, yes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/args.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/cli/args.ts src/cli/args.test.ts
git commit -m "feat(cli): add --refresh and --yes flags"
```

---

### Task 7: CLI trust prompt + resolver wiring

**Files:**
- Create: `src/cli/trust-prompt.ts`
- Test: `src/cli/trust-prompt.test.ts`
- Modify: `src/cli/index.ts`

**Interfaces:**
- Consumes: `ResolvedSource` (`../core/remote/index.js`); `hashDir`, `trustKey`, `isTrusted`, `recordTrust` (`../core/remote/trust.js`); `parseArgs`/`ParsedArgs`.
- Produces:
  - `interface ConfirmTrustDeps { isTty: boolean; yes: boolean; confirm: (message: string) => Promise<boolean>; log: (line: string) => void }`
  - `function ensureTrusted(resolved: ResolvedSource, deps: ConfirmTrustDeps): Promise<void>` — no-op for local sources or already-trusted content; in non-TTY or `--yes` mode records trust with a printed notice (no prompt); otherwise shows the source + a "runs code" warning, calls `deps.confirm`, and either records trust or throws `RemoteFetchError('aborted: remote workflow not trusted')`.
  - `function readlineConfirm(message: string): Promise<boolean>` — default y/N prompt via `node:readline/promises` (used by `index.ts`, not by unit tests).

- [ ] **Step 1: Write the failing test**

```typescript
// src/cli/trust-prompt.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTrusted } from './trust-prompt.js';
import { hashDir, recordTrust, trustKey } from '../core/remote/trust.js';
import { RemoteFetchError } from '../core/remote/index.js';
import type { ResolvedSource } from '../core/remote/index.js';

let dir: string; // serves as repoDir AND holds the trust store
let store: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-tp-'));
  store = join(dir, 'trust.json');
  await writeFile(join(dir, 'wf.yaml'), 'name: demo\n');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const resolved = (): ResolvedSource => ({
  localPath: join(dir, 'wf.yaml'),
  remote: { host: 'github', owner: 'o', repo: 'r', ref: 'main', subPath: 'wf.yaml' },
  repoDir: dir,
});

function deps(over: Partial<Parameters<typeof ensureTrusted>[1]> = {}) {
  return {
    isTty: true,
    yes: false,
    confirm: vi.fn(async () => true),
    log: vi.fn(),
    storePath: store,
    ...over,
  };
}

describe('ensureTrusted', () => {
  it('does nothing for local sources', async () => {
    const d = deps();
    await ensureTrusted({ localPath: './wf.yaml', remote: null }, d);
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('prompts on first run and records trust on yes', async () => {
    const d = deps();
    await ensureTrusted(resolved(), d);
    expect(d.confirm).toHaveBeenCalledOnce();
    // Second run: already trusted, no prompt.
    const d2 = deps();
    await ensureTrusted(resolved(), d2);
    expect(d2.confirm).not.toHaveBeenCalled();
  });

  it('throws when the user declines', async () => {
    const d = deps({ confirm: vi.fn(async () => false) });
    await expect(ensureTrusted(resolved(), d)).rejects.toThrow(RemoteFetchError);
  });

  it('skips the prompt under --yes but still records trust', async () => {
    const d = deps({ yes: true });
    await ensureTrusted(resolved(), d);
    expect(d.confirm).not.toHaveBeenCalled();
    const d2 = deps();
    await ensureTrusted(resolved(), d2);
    expect(d2.confirm).not.toHaveBeenCalled(); // trusted now
  });

  it('skips the prompt in non-TTY mode', async () => {
    const d = deps({ isTty: false });
    await ensureTrusted(resolved(), d);
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('re-prompts when content changes after trust', async () => {
    const key = trustKey(resolved().remote!);
    await recordTrust(key, await hashDir(dir), { storePath: store });
    await writeFile(join(dir, 'wf.yaml'), 'name: changed\n');
    const d = deps();
    await ensureTrusted(resolved(), d);
    expect(d.confirm).toHaveBeenCalledOnce();
  });
});
```

Note: the test passes `storePath` through `deps`; add `storePath?: string` to `ConfirmTrustDeps` (defaulting to the real store inside `ensureTrusted`) so tests can isolate the store.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/trust-prompt.test.ts`
Expected: FAIL — `Cannot find module './trust-prompt.js'`.

- [ ] **Step 3: Implement the trust prompt**

```typescript
// src/cli/trust-prompt.ts
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { ResolvedSource } from '../core/remote/index.js';
import { RemoteFetchError } from '../core/remote/index.js';
import { hashDir, isTrusted, recordTrust, trustKey } from '../core/remote/trust.js';

export interface ConfirmTrustDeps {
  isTty: boolean;
  yes: boolean;
  confirm: (message: string) => Promise<boolean>;
  log: (line: string) => void;
  /** Override the trust store location (tests). */
  storePath?: string;
}

export async function ensureTrusted(resolved: ResolvedSource, deps: ConfirmTrustDeps): Promise<void> {
  if (!resolved.remote) return; // local path — nothing to vet

  const ref = resolved.remote;
  const at = `${ref.owner}/${ref.repo}@${ref.ref ?? 'HEAD'}`;
  // Hash only the directory containing the workflow file — the bundle that runs.
  const hash = await hashDir(dirname(resolved.localPath));
  const key = trustKey(ref);
  const opts = { storePath: deps.storePath };

  if (await isTrusted(key, hash, opts)) return;

  if (deps.yes || !deps.isTty) {
    deps.log(`plyflow: trusting remote workflow ${at} (${ref.subPath}) without prompt`);
    await recordTrust(key, hash, opts);
    return;
  }

  deps.log(`This workflow comes from ${at} (${ref.subPath}).`);
  deps.log('Remote workflows can execute arbitrary code (run/uses/plugin steps).');
  const ok = await deps.confirm(`Run this workflow from ${at}?`);
  if (!ok) throw new RemoteFetchError('aborted: remote workflow not trusted');
  await recordTrust(key, hash, opts);
}

/** Default y/N confirm used by the CLI (not unit-tested). */
export async function readlineConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/trust-prompt.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the resolver + trust gate into `main`**

In `src/cli/index.ts`, add imports near the top:

```typescript
import { resolveWorkflowSource } from '../core/remote/index.js';
import { ensureTrusted, readlineConfirm } from './trust-prompt.js';
```

Then, inside `main`, replace these two lines:

```typescript
  const args = parseArgs(argv);
  const wf = await loadWorkflow(args.workflow);
```

with:

```typescript
  const args = parseArgs(argv);
  const resolved = await resolveWorkflowSource(args.workflow, { refresh: args.refresh });
  await ensureTrusted(resolved, {
    isTty: Boolean(process.stdout.isTTY),
    yes: args.yes,
    confirm: readlineConfirm,
    log: (line) => process.stderr.write(line + '\n'),
  });
  const wfPath = resolved.localPath;
  const wf = await loadWorkflow(wfPath);
```

Finally, replace **both** remaining uses of `args.workflow` (the two `runWorkflow(args.workflow, {` calls at lines ~32 and ~72) with `runWorkflow(wfPath, {`.

- [ ] **Step 6: Verify the full suite + types still pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — no test or type regressions. (`tsc --noEmit` catches any missed `args.workflow → wfPath` swap.)

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/cli/trust-prompt.ts src/cli/trust-prompt.test.ts src/cli/index.ts
git commit -m "feat(cli): trust gate and remote workflow resolution"
```

---

### Task 8: End-to-end integration test + docs

**Files:**
- Create: `src/core/remote/remote.e2e.test.ts`
- Modify: `README.md` (document the feature)

**Interfaces:**
- Consumes: `resolveWorkflowSource` (`./resolve.js`); `runWorkflow` (`../engine.js`).
- Produces: an end-to-end test proving a remote workflow resolves to the cache and runs through the *unchanged* engine.

- [ ] **Step 1: Write the integration test**

```typescript
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
```

Note: if `runWorkflow`'s `RunOptions`/`provider` shape differs from the stub above, open `src/core/engine.ts` and match the real `RunOptions` type and a minimal provider (the `run` step here never calls the provider, so any object satisfying the type is fine). Adjust the `outputs` access if outputs are keyed differently (check an existing engine test such as `src/core/engine.test.ts`).

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run src/core/remote/remote.e2e.test.ts`
Expected: PASS — `outputs.double === 42`, proving resolve → cache → unchanged engine.

- [ ] **Step 3: Document the feature in the README**

Add a section to `README.md` (after the existing "run a workflow" usage). Match the README's existing heading style:

````markdown
## Running a workflow from GitHub

Run a workflow straight from a GitHub repository — plyflow fetches the repo,
caches it under `~/.plyflow/cache/`, and runs it locally:

```bash
# Shorthand (ref optional — defaults to the repo's default branch)
plyflow run github:org/repo/examples/mission/mission.yaml@v1.0.0

# …or paste a GitHub URL
plyflow run https://github.com/org/repo/blob/main/examples/mission/mission.yaml
```

Sibling files the workflow references (agents, schemas, plugins) are fetched
with it. The first run of a given remote workflow asks for confirmation, since
remote workflows can execute code; pass `--yes` to skip the prompt (also skipped
in non-interactive/CI environments). Use `--refresh` to bypass the cache and
re-fetch.

**Private repos:** set `GITHUB_TOKEN` (or `GH_TOKEN`) and plyflow authenticates
the download.
````

- [ ] **Step 4: Run the entire suite + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — all tests green, no type errors.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/core/remote/remote.e2e.test.ts README.md
git commit -m "test(remote): end-to-end remote workflow run; docs"
```

---

## Self-Review

**Spec coverage:**
- Run-direct from URL → Tasks 5, 7, 8. ✓
- Two reference syntaxes (shorthand + full URL) → Task 1. ✓
- Fetch the whole directory (whole repo) tarball → Task 3 (`tar`, `strip:1`). ✓
- Resolver-in-front-of-loader integration, engine unchanged → Tasks 5, 7, 8. ✓
- Global cache + reuse + `--refresh` + TTL/immutable policy → Tasks 2, 3, 6. ✓
- Warn + confirm trust gate, trust-on-first-use, `--yes`/non-TTY bypass, re-prompt on change → Tasks 4, 6, 7. ✓
- Private repos via `GITHUB_TOKEN`/`GH_TOKEN` → Tasks 3, 5. ✓
- Typed `RemoteFetchError` with actionable messages (404 / 401-403 / network / missing subpath) → Tasks 1, 3, 5. ✓
- Atomic cache writes (temp → rename) → Task 3. ✓
- Only new dep is `tar` → Task 3. ✓

**Refinements vs. the spec (intent preserved):**
- Endpoint is `api.github.com/repos/{o}/{r}/tarball[/{ref}]` rather than codeload directly — it 302-redirects to a pre-signed codeload URL, which (a) resolves the default branch when no ref is given and (b) authenticates private-repo downloads even though `fetch` drops the `Authorization` header on the cross-origin redirect (the redirect URL is itself signed). Still "download a tarball", per the spec's chosen mechanism.
- Trust prompt is a plain `readline` confirm at the CLI boundary, not the Ink TUI prompt path — it must run before the Ink app renders. The spec's "plain-stdout fallback" intent is preserved and the gate's behaviour is unchanged.
- Only a 40-hex SHA is treated as immutable for caching; branches and tags both use the TTL (we can't tell a tag from a branch by name). Conservative and correct.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step shows complete code. ✓

**Type consistency:** `WorkflowRef`, `ResolvedSource`, `EnsureRepoOptions`/`EnsureRepoResult`, `ConfirmTrustDeps`, `RemoteFetchError`, `ParsedArgs`, `META_FILE`, `trustKey`/`hashDir`/`isTrusted`/`recordTrust`, `ensureRepo`, `resolveWorkflowSource` names/signatures match across all tasks. ✓
