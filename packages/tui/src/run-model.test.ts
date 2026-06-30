import { describe, it, expect } from 'vitest';
import { createRunModel, applyEvent, deriveLabel, MAX_BUFFER } from './run-model.js';
import type { EngineEvent } from '@plyflow/core';

function apply(events: EngineEvent[]) {
  return events.reduce(applyEvent, createRunModel());
}

describe('deriveLabel', () => {
  it('uses the stepId alone when there is no foreach/loop key', () => {
    expect(deriveLabel('phase:Build/build', 'build')).toBe('build');
  });
  it('appends the nearest foreach key in brackets', () => {
    expect(deriveLabel('phase:Build/build/foreach:task_2/implement', 'implement')).toBe('implement[task_2]');
  });
  it('appends the nearest loop iteration', () => {
    expect(deriveLabel('phase:Build/x/loop:1/verify', 'verify')).toBe('verify[1]');
  });
});

describe('applyEvent', () => {
  it('inserts a running instance on step-start with derived label, kind, depth', () => {
    const m = apply([
      { type: 'phase-start', phase: 'Build' },
      { type: 'step-start', stepId: 'implement', instanceId: 'phase:Build/build/foreach:task_2/implement', parentId: 'phase:Build/build/foreach:task_2', kind: 'agent' },
    ]);
    const inst = m.byId.get('phase:Build/build/foreach:task_2/implement')!;
    expect(inst.status).toBe('running');
    expect(inst.kind).toBe('agent');
    expect(inst.label).toBe('implement[task_2]');
    expect(inst.depth).toBe(3); // segments after the phase root
    expect(m.phases).toEqual(['Build']);
    expect(m.order).toContain(inst.instanceId);
  });

  it('appends agent-stream chunks to the matching instance buffer', () => {
    const id = 'phase:P/a';
    const m = apply([
      { type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'agent' },
      { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'tool_use', name: 'Edit', summary: 'x.ts' } },
      { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'assistant', text: 'done' } },
    ]);
    expect(m.byId.get(id)!.buffer).toEqual([
      { t: 'tool_use', name: 'Edit', summary: 'x.ts' },
      { t: 'assistant', text: 'done' },
    ]);
  });

  it('retains the buffer and sets terminal status + tokens on step-done', () => {
    const id = 'phase:P/a';
    const m = apply([
      { type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'agent' },
      { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'result', tokens: 99 } },
      { type: 'step-done', stepId: 'a', instanceId: id, output: 'r', cached: false },
    ]);
    const inst = m.byId.get(id)!;
    expect(inst.status).toBe('done');
    expect(inst.output).toBe('r');
    expect(inst.tokens).toBe(99);
    expect(inst.buffer).toHaveLength(1); // retained, not cleared
  });

  it('marks error status on step-error', () => {
    const id = 'phase:P/a';
    const m = apply([
      { type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'sh' },
      { type: 'step-error', stepId: 'a', instanceId: id, error: 'boom' },
    ]);
    expect(m.byId.get(id)!.status).toBe('error');
  });

  it('ring-caps the buffer at MAX_BUFFER and sets trimmed', () => {
    const id = 'phase:P/a';
    let m = apply([{ type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'agent' }]);
    for (let i = 0; i < MAX_BUFFER + 10; i++) {
      m = applyEvent(m, { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'raw', text: `line ${i}` } });
    }
    const inst = m.byId.get(id)!;
    expect(inst.buffer).toHaveLength(MAX_BUFFER);
    expect(inst.trimmed).toBe(true);
    expect((inst.buffer[inst.buffer.length - 1] as { text: string }).text).toBe(`line ${MAX_BUFFER + 9}`);
  });

  it('orders foreach children immediately after their parent step', () => {
    const m = apply([
      { type: 'phase-start', phase: 'P' },
      { type: 'step-start', stepId: 'build', instanceId: 'phase:P/build', parentId: 'phase:P', kind: 'foreach' },
      { type: 'step-start', stepId: 'after', instanceId: 'phase:P/after', parentId: 'phase:P', kind: 'run' },
      { type: 'step-start', stepId: 'work', instanceId: 'phase:P/build/foreach:a/work', parentId: 'phase:P/build/foreach:a', kind: 'agent' },
    ]);
    // 'work' (descendant of build) must sort before 'after', not at the end.
    expect(m.order).toEqual(['phase:P/build', 'phase:P/build/foreach:a/work', 'phase:P/after']);
  });
});
