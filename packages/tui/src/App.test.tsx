import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from './App.js';
import type { EngineEvent, WorkflowFile, UiRequest } from '@plyflow/core';

/** Fake terminal output that captures writes without touching the real stdout. */
function makeFakeOut() {
  return {
    writes: [] as string[],
    rows: 24,
    columns: 80,
    write(s: string) { this.writes.push(s); },
    on(_ev: 'resize', _cb: () => void) {},
    off(_ev: 'resize', _cb: () => void) {},
  };
}

describe('App', () => {
  it('calls onDone and renders done glyph when event stream completes', async () => {
    const wf: WorkflowFile = {
      name: 'demo',
      phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }],
    };

    async function* events(): AsyncGenerator<EngineEvent> {
      yield { type: 'phase-start', phase: 'P' };
      yield { type: 'step-start', stepId: 's', instanceId: 'phase:P/s', parentId: 'phase:P', kind: 'run' };
      await new Promise((r) => setTimeout(r, 5));
      yield { type: 'step-done', stepId: 's', instanceId: 'phase:P/s', output: 1, cached: false };
    }

    const onDone = vi.fn();
    const fakeOut = makeFakeOut();

    const { frames } = render(
      <App
        workflow={wf}
        events={events()}
        registerPrompt={() => {}}
        onDone={onDone}
        out={fakeOut}
      />,
    );

    await new Promise((r) => setTimeout(r, 100));

    expect(onDone).toHaveBeenCalled();
    // Ink 7 appends a final "\n" frame on exit(); find the last meaningful frame.
    const frame = [...frames].reverse().find((f) => f.trim().length > 0) ?? '';
    expect(frame).toContain('s');
    expect(frame).toMatch(/✓/);
  });

  it('shows streaming agents in the split-pane and a modal when a question is pending', async () => {
    const wf: WorkflowFile = { name: 'demo', phases: [{ name: 'Build', steps: [{ id: 'astro', agent: 'a.md' }] }] };

    // Long-lived stream: emit the build events, then stay open so App does not
    // exit() before we assert (the generator ending triggers onDone()+exit()).
    async function* events(): AsyncGenerator<EngineEvent> {
      yield { type: 'phase-start', phase: 'Build' };
      yield { type: 'step-start', stepId: 'astro', instanceId: 'phase:Build/astro', parentId: 'phase:Build', kind: 'agent' };
      yield { type: 'agent-stream', stepId: 'astro', instanceId: 'phase:Build/astro', chunk: { t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' } };
      await new Promise((r) => setTimeout(r, 300));
    }

    // Capture the handler App registers so we can trigger a question on demand.
    let handler: ((stepId: string, req: UiRequest) => Promise<unknown>) | null = null;
    const fakeOut = makeFakeOut();
    const { lastFrame } = render(
      <App workflow={wf} events={events()} registerPrompt={(h) => { handler = h; }} onDone={() => {}} out={fakeOut} />,
    );

    await new Promise((r) => setTimeout(r, 30)); // let events fold in + handler register
    let resolved = false;
    handler!('ready', { kind: 'prompt', type: 'confirm', message: 'Proceed to liftoff?' }).then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 30));

    const frame = lastFrame()!;
    expect(frame).toContain('astro');               // selector lists the streaming agent
    expect(frame).toContain('Proceed to liftoff?'); // modal overlaid while it streams
    expect(resolved).toBe(false);                    // still waiting on the user
  });
});
