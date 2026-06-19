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
