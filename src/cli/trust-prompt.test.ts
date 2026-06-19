import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTrusted } from './trust-prompt.js';
import { hashDir, recordTrust, trustKey } from '../core/remote/trust.js';
import { RemoteFetchError } from '../core/remote/index.js';
import type { ResolvedSource } from '../core/remote/index.js';

let dir: string;
let storeDir: string;
let store: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-tp-'));
  storeDir = await mkdtemp(join(tmpdir(), 'plyflow-tp-store-'));
  store = join(storeDir, 'trust.json');
  await writeFile(join(dir, 'wf.yaml'), 'name: demo\n');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(storeDir, { recursive: true, force: true });
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
