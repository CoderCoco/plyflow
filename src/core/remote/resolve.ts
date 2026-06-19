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
