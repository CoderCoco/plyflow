import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from './App.js';
import type { EngineEvent } from '../core/engine.js';
import type { WorkflowFile } from '../core/types.js';

describe('App', () => {
  it('calls onDone and renders done glyph when event stream completes', async () => {
    const wf: WorkflowFile = {
      name: 'demo',
      phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }],
    };

    async function* events(): AsyncGenerator<EngineEvent> {
      yield { type: 'phase-start', phase: 'P' };
      yield { type: 'step-start', stepId: 's' };
      yield { type: 'step-done', stepId: 's', output: 1, cached: false };
    }

    const onDone = vi.fn();

    const { lastFrame } = render(
      <App
        workflow={wf}
        events={events()}
        registerPrompt={() => {}}
        onDone={onDone}
      />,
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(onDone).toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('s');
    expect(frame).toMatch(/✓/);
  });
});
