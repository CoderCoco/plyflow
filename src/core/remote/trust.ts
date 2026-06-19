// src/core/remote/trust.ts
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import type { WorkflowRef } from './ref.js';
import { META_FILE } from './cache.js';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const TRUST_FILE = 'trust.json';

export interface TrustOptions {
  storePath?: string;
}

function defaultStorePath(): string {
  return join(homedir(), '.plyflow', 'trust.json');
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), out);
    } else if (e.isFile()) {
      if (e.name === META_FILE || e.name === TRUST_FILE) continue;
      out.push(join(dir, e.name));
    }
  }
}

export async function hashDir(dir: string): Promise<string> {
  const files: string[] = [];
  await walk(dir, files);
  // Sort by POSIX-normalised relative path for cross-platform stability.
  const rel = (p: string) => relative(dir, p).split(sep).join('/');
  files.sort((a, b) => {
    const ra = rel(a);
    const rb = rel(b);
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
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
