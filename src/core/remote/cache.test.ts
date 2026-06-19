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
