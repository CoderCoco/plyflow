import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow, buildDefaultRegistry } from './engine.js';
import { FakeProvider } from '../providers/fake.js';

const wf = fileURLToPath(new URL('./__fixtures__/e2e.yaml', import.meta.url));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-e2e-'));
  return () => rm(dir, { recursive: true, force: true });
});

describe('runWorkflow', () => {
  it('runs phases and resolves cross-step expressions', async () => {
    const events: string[] = [];
    const res = await runWorkflow(wf, {
      inputs: { n: 5 },
      runDir: dir,
      provider: new FakeProvider([]),
      onEvent: (e) => events.push(e.type),
    });
    expect(res.outputs.label).toBe('value=10');
    expect(events).toContain('phase-start');
  });

  it('replays cached steps on resume with the same runId', async () => {
    const first = await runWorkflow(wf, { inputs: { n: 5 }, runDir: dir, provider: new FakeProvider([]) });
    const cachedIds: string[] = [];
    await runWorkflow(wf, {
      inputs: { n: 5 },
      runId: first.runId,
      runDir: dir,
      provider: new FakeProvider([]),
      onEvent: (e) => { if (e.type === 'step-done' && e.cached) cachedIds.push(e.stepId); },
    });
    expect(cachedIds.sort()).toEqual(['double', 'label']);
  });

  it('registers the four built-in step types', () => {
    const reg = buildDefaultRegistry();
    expect(reg.select({ id: 's', run: 'x' }).name).toBe('run');
    expect(reg.select({ id: 's', agent: 'a.md' }).name).toBe('agent');
    expect(reg.select({ id: 's', input: { type: 'confirm', message: 'm' } }).name).toBe('input');
    expect(reg.select({ id: 's', parallel: [] }).name).toBe('parallel');
  });
});
