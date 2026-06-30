import { describe, it, expect } from 'vitest';
import { runWorkflow, buildDefaultRegistry, type EngineEvent } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('agent-stream translation', () => {
  it('turns ctx.emit output chunks into agent-stream engine events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plyflow-as-'));
    const wfPath = join(dir, 'wf.yaml');
    // Inline JS run step that emits two output chunks via ctx.emit
    await writeFile(
      wfPath,
      [
        'name: as',
        'phases:',
        '  - name: P',
        '    steps:',
        '      - id: e',
        "        run: |",
        "          ctx.emit({ type: 'output', chunk: { t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' } });",
        "          ctx.emit({ type: 'output', chunk: { t: 'result', tokens: 42 } });",
        "          return 'ok';",
      ].join('\n'),
    );
    const reg = buildDefaultRegistry();

    const events: EngineEvent[] = [];
    await runWorkflow(wfPath, {
      provider: new FakeProvider([]),
      registry: reg,
      isTty: false,
      runDir: join(dir, 'runs'),
      onEvent: (e) => events.push(e),
    });

    const streams = events.filter((e) => e.type === 'agent-stream') as Extract<
      EngineEvent,
      { type: 'agent-stream' }
    >[];
    expect(streams).toHaveLength(2);
    expect(streams[0].instanceId).toBe('phase:P/e');
    expect(streams[0].chunk).toEqual({ t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' });
    expect(streams[1].chunk).toEqual({ t: 'result', tokens: 42 });
  });
});
