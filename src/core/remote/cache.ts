// src/core/remote/cache.ts
import { createHash } from 'node:crypto';
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
  const stable = JSON.stringify([ref.host, ref.owner, ref.repo, ref.ref ?? 'HEAD']);
  return createHash('sha256').update(stable).digest('hex');
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
