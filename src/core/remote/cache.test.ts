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
  it('builds a deterministic hex key that varies by owner, repo and ref', () => {
    const k = cacheKey(ref());
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey(ref())).toBe(k); // deterministic
    expect(cacheKey(ref({ ref: null }))).not.toBe(k); // ref participates
    expect(cacheKey(ref({ repo: 'other' }))).not.toBe(k); // repo participates
  });

  it('does not alias different repos into one key', () => {
    // A `${owner}-${repo}` join made these collide into "a-b-c@main", which would
    // run the wrong repository's workflow from a shared cache dir.
    expect(cacheKey(ref({ owner: 'a-b', repo: 'c' }))).not.toBe(
      cacheKey(ref({ owner: 'a', repo: 'b-c' })),
    );
  });

  it('places the dir under the cache root using the key', () => {
    expect(cacheDir(root, ref())).toBe(join(root, cacheKey(ref())));
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
