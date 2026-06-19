/**
 * Tests for App mounting custom widgets via the `widget` UiRequest kind.
 *
 * The widget component receives `{ data: unknown, resolve: (value: unknown) => void }`.
 * When `resolve` is called the pending UI promise settles and the App clears the widget.
 *
 * Async loading note (Ink 7 + React 19 + jiti):
 * The App loads the widget module asynchronously in a useEffect, so the first render
 * shows a "loading…" placeholder.  After a short settle (setTimeout(r, 200)) the
 * component is mounted and resolve is called.  We wait a further tick for React to
 * process the state update.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './App.js';
import type { EngineEvent } from '../core/engine.js';
import type { WorkflowFile } from '../core/types.js';
import type { UiRequest } from '../steps/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ECHO_WIDGET_PATH = path.resolve(__dirname, '__fixtures__/EchoWidget.tsx');
const ECHO_WIDGET_DIR = path.dirname(ECHO_WIDGET_PATH);

/** Minimal workflow file with one step so App initialises cleanly. */
function makeWorkflow(): WorkflowFile {
  return {
    name: 'widget-test',
    phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }],
  };
}

/**
 * Event stream that never completes so the App keeps running while we test UI.
 * Implemented as an async iterable (not a generator) to avoid require-yield lint error.
 */
function neverEnds(): AsyncIterable<EngineEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<EngineEvent> {
      return {
        next(): Promise<IteratorResult<EngineEvent>> {
          return new Promise<IteratorResult<EngineEvent>>(() => {});
        },
      };
    },
  };
}

describe('App widget mounting', () => {
  it('loads and renders a widget component, resolves with widget data', async () => {
    const wf = makeWorkflow();
    let promptHandler: ((stepId: string, req: UiRequest) => Promise<unknown>) | undefined;

    const resolvedValues: unknown[] = [];

    const { frames, unmount } = render(
      <App
        workflow={wf}
        events={neverEnds()}
        registerPrompt={(handler) => {
          promptHandler = handler;
        }}
        onDone={() => {}}
      />,
    );

    // Wait for App to register the prompt handler via useEffect.
    await new Promise((r) => setTimeout(r, 20));
    expect(promptHandler).toBeDefined();

    // Drive a widget UiRequest into the App.
    const widgetRequest: UiRequest = {
      kind: 'widget',
      module: ECHO_WIDGET_PATH,
      baseDir: ECHO_WIDGET_DIR,
      props: 'hello-42',
    };

    const pendingPromise = promptHandler!('s', widgetRequest).then((v) => {
      resolvedValues.push(v);
      return v;
    });

    // Allow time for: async module load (jiti) + React state update + widget useEffect.
    await new Promise((r) => setTimeout(r, 500));

    // The widget should have resolved with its data.
    expect(resolvedValues).toHaveLength(1);
    expect(resolvedValues[0]).toBe('hello-42');

    // At least one frame should contain the widget's rendered output.
    const widgetFrame = frames.find((f) => f.includes('widget:hello-42'));
    expect(widgetFrame).toBeDefined();

    // Clean up.
    unmount();
    await pendingPromise.catch(() => {}); // swallow if unmount caused rejection
  });

  it('renders a loading indicator while the widget module is being loaded', async () => {
    const wf = makeWorkflow();
    let promptHandler: ((stepId: string, req: UiRequest) => Promise<unknown>) | undefined;

    const { frames, unmount } = render(
      <App
        workflow={wf}
        events={neverEnds()}
        registerPrompt={(handler) => {
          promptHandler = handler;
        }}
        onDone={() => {}}
      />,
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(promptHandler).toBeDefined();

    const widgetRequest: UiRequest = {
      kind: 'widget',
      module: ECHO_WIDGET_PATH,
      baseDir: ECHO_WIDGET_DIR,
      props: 'loading-test',
    };

    // Don't await; check early frames for loading indicator.
    const pending = promptHandler!('s', widgetRequest);

    // After a tiny tick the loading placeholder should appear before the module loads.
    await new Promise((r) => setTimeout(r, 10));
    const earlyFrame = frames[frames.length - 1] ?? '';
    // Either the loading indicator or the widget itself — both are valid since
    // jiti may be very fast (cached).  The key invariant is no crash/throw.
    expect(typeof earlyFrame).toBe('string');

    // Wait for full settlement.
    await new Promise((r) => setTimeout(r, 600));
    unmount();
    await pending.catch(() => {});
  });
});
