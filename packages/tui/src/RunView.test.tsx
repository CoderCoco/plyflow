import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { RunView } from './RunView.js';
import { createRunModel, applyEvent } from './run-model.js';
import type { EngineEvent } from '@plyflow/core';

function build(events: EngineEvent[]) {
  return events.reduce(applyEvent, createRunModel());
}

describe('RunView', () => {
  const model = build([
    { type: 'phase-start', phase: 'Build' },
    { type: 'step-start', stepId: 'task', instanceId: 'phase:Build/task', parentId: 'phase:Build', kind: 'agent' },
    { type: 'agent-stream', stepId: 'task', instanceId: 'phase:Build/task', chunk: { t: 'tool_use', name: 'Edit', summary: 'a.ts' } },
  ]);

  it('lists steps in the selector with the phase header and a cursor marker', () => {
    const { lastFrame } = render(
      <RunView model={model} cursorId="phase:Build/task" focus="selector" scrollOffset={0} width={100} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Build');
    // depth=1 means indent='  ' (2 spaces), so row is '›   ◐ task' — assert on substrings
    expect(frame).toContain('◐ task');
    expect(frame).toContain('›');
  });

  it('streams the focused instance buffer in the detail pane', () => {
    const { lastFrame } = render(
      <RunView model={model} cursorId="phase:Build/task" focus="detail" scrollOffset={0} width={100} />,
    );
    expect(lastFrame()).toContain('> Edit a.ts');
  });

  it('shows string output in detail pane when agent never streamed any chunks', () => {
    const agentNoStream = build([
      { type: 'phase-start', phase: 'Summarise' },
      { type: 'step-start', stepId: 'summary', instanceId: 'phase:Summarise/summary', parentId: 'phase:Summarise', kind: 'agent' },
      { type: 'step-done', stepId: 'summary', instanceId: 'phase:Summarise/summary', output: 'final summary' },
    ]);
    const { lastFrame } = render(
      <RunView model={agentNoStream} cursorId="phase:Summarise/summary" focus="detail" scrollOffset={0} width={100} />,
    );
    expect(lastFrame()).toContain('final summary');
  });
});
