import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { ResolvedSource } from '@plyflow/core/remote';
import { RemoteFetchError } from '@plyflow/core/remote';
import { hashDir, isTrusted, recordTrust, trustKey } from '@plyflow/core/remote/trust';

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
  // Scope assumption: any files the workflow references (agents, schemas, plugins)
  // are expected to live within that same directory subtree, which matches how the
  // bundled examples are authored.  A workflow that references files OUTSIDE this
  // subtree (e.g. `uses: ../shared/foo.ts` or an absolute path) would execute code
  // not covered by the hash, so a silent change to such a sibling file would not
  // re-trigger the trust prompt.
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
