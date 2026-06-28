import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from './App.js';
import type { EngineEvent } from '@plyflow/core';
import type { WorkflowFile } from '@plyflow/core';

describe('App', () => {
  it('calls onDone and renders done glyph when event stream completes', async () => {
    const wf: WorkflowFile = {
      name: 'demo',
      phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }],
    };

    async function* events(): AsyncGenerator<EngineEvent> {
      yield { type: 'phase-start', phase: 'P' };
      await new Promise((r) => setTimeout(r, 5));
      yield { type: 'step-start', stepId: 's' };
      await new Promise((r) => setTimeout(r, 5));
      yield { type: 'step-done', stepId: 's', output: 1, cached: false };
      await new Promise((r) => setTimeout(r, 5));
    }

    const onDone = vi.fn();

    const { frames } = render(
      <App
        workflow={wf}
        events={events()}
        registerPrompt={() => {}}
        onDone={onDone}
      />,
    );

    await new Promise((r) => setTimeout(r, 100));

    expect(onDone).toHaveBeenCalled();
    // Ink 7 appends a final "\n" frame on exit(); find the last meaningful frame.
    const frame = [...frames].reverse().find((f) => f.trim().length > 0) ?? '';
    expect(frame).toContain('s');
    expect(frame).toMatch(/✓/);
  });
});
