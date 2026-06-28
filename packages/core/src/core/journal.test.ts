import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal, hashStep } from './journal.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-'));
  return () => rm(dir, { recursive: true, force: true });
});

describe('hashStep', () => {
  it('is stable for equal configs and differs for different configs', () => {
    expect(hashStep({ a: 1 })).toBe(hashStep({ a: 1 }));
    expect(hashStep({ a: 1 })).not.toBe(hashStep({ a: 2 }));
  });

  it('produces different hashes when sh: command changes (regression: sh fields must be included)', () => {
    const base = { id: 'cmd', type: 'sh', inputs: {}, with: {}, sh: 'echo hello' };
    const changed = { ...base, sh: 'echo world' };
    expect(hashStep(base)).not.toBe(hashStep(changed));
  });

  it('produces different hashes when cwd changes', () => {
    const base = { id: 'cmd', type: 'sh', inputs: {}, with: {}, sh: 'ls', cwd: '/tmp' };
    const changed = { ...base, cwd: '/var' };
    expect(hashStep(base)).not.toBe(hashStep(changed));
  });

  it('produces different hashes when env changes', () => {
    const base = { id: 'cmd', type: 'sh', inputs: {}, with: {}, sh: 'ls', env: { NODE_ENV: 'test' } };
    const changed = { ...base, env: { NODE_ENV: 'production' } };
    expect(hashStep(base)).not.toBe(hashStep(changed));
  });

  it('produces different hashes when json flag changes', () => {
    const base = { id: 'cmd', type: 'sh', inputs: {}, with: {}, sh: 'echo {}', json: false };
    const changed = { ...base, json: true };
    expect(hashStep(base)).not.toBe(hashStep(changed));
  });
});

describe('Journal', () => {
  it('records an entry and reloads it from disk', async () => {
    const j = Journal.create(dir, 'run1', 'demo', { x: 1 });
    await j.record({ stepId: 's', hash: 'h', output: 42, status: 'completed', startedAt: 0, endedAt: 1 });
    const reloaded = await Journal.load(dir, 'run1');
    expect(reloaded.get('s')?.output).toBe(42);
  });
});
