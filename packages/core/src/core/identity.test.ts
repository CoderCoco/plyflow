import { describe, it, expect } from 'vitest';
import { runWorkflow, type EngineEvent } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function writeWorkflow(yaml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plyflow-id-'));
  const p = join(dir, 'wf.yaml');
  await writeFile(p, yaml);
  return p;
}

describe('engine event identity', () => {
  it('emits hierarchical instanceId + parentId + kind for foreach children', async () => {
    const wfPath = await writeWorkflow(`
name: idtest
phases:
  - name: Build
    steps:
      - id: build
        foreach: "\${{ ['a', 'b'] }}"
        steps:
          - id: work
            run: "return 1"
`);
    const events: EngineEvent[] = [];
    await runWorkflow(wfPath, {
      provider: new FakeProvider([]),
      isTty: false,
      runDir: join(tmpdir(), 'plyflow-id-runs'),
      onEvent: (e) => events.push(e),
    });

    const starts = events.filter((e) => e.type === 'step-start') as Extract<EngineEvent, { type: 'step-start' }>[];
    const workStarts = starts.filter((s) => s.stepId === 'work');
    expect(workStarts.map((s) => s.instanceId).sort()).toEqual([
      'phase:Build/build/foreach:0/work',
      'phase:Build/build/foreach:1/work',
    ]);
    for (const s of workStarts) {
      expect(s.kind).toBe('run');
      expect(s.parentId).toBe(s.instanceId.slice(0, s.instanceId.lastIndexOf('/')));
    }
  });
});
