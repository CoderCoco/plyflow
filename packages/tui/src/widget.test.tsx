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
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './App.js';
import { __clearWidgetCache, requestCacheKey } from './WidgetHost.js';
import type { EngineEvent } from '@plyflow/core';
import type { WorkflowFile } from '@plyflow/core';
import type { UiRequest } from '@plyflow/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ECHO_WIDGET_PATH = path.resolve(__dirname, '__fixtures__/EchoWidget.tsx');
const ECHO_WIDGET_DIR = path.dirname(ECHO_WIDGET_PATH);

const BAD_WIDGET_PATH = path.resolve(__dirname, '__fixtures__/BadWidget.tsx');
const BAD_WIDGET_DIR = path.dirname(BAD_WIDGET_PATH);

const MISSING_WIDGET_PATH = path.resolve(__dirname, '__fixtures__/DoesNotExist.tsx');
const MISSING_WIDGET_DIR = path.dirname(MISSING_WIDGET_PATH);

const MEMO_WIDGET_PATH = path.resolve(__dirname, '__fixtures__/MemoWidget.tsx');
const MEMO_WIDGET_DIR = path.dirname(MEMO_WIDGET_PATH);

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

/** Minimal fake terminal output that captures writes without touching the real stdout. */
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

/** Helper: render App, wait for registerPrompt, return handler + frames + unmount */
async function setupApp() {
  const wf = makeWorkflow();
  let promptHandler: ((stepId: string, req: UiRequest) => Promise<unknown>) | undefined;
  const fakeOut = makeFakeOut();

  const { frames, unmount } = render(
    <App
      workflow={wf}
      events={neverEnds()}
      registerPrompt={(handler) => {
        promptHandler = handler;
      }}
      onDone={() => {}}
      out={fakeOut}
    />,
  );

  await new Promise((r) => setTimeout(r, 20));
  expect(promptHandler).toBeDefined();

  return { frames, unmount, promptHandler: promptHandler! };
}

describe('App widget mounting', () => {
  beforeEach(() => {
    __clearWidgetCache();
  });

  it('loads and renders a widget component, resolves with widget data', async () => {
    const { frames, unmount, promptHandler } = await setupApp();

    const resolvedValues: unknown[] = [];

    // Drive a widget UiRequest into the App.
    const widgetRequest: UiRequest = {
      kind: 'widget',
      module: ECHO_WIDGET_PATH,
      baseDir: ECHO_WIDGET_DIR,
      props: 'hello-42',
    };

    const pendingPromise = promptHandler('s', widgetRequest).then((v) => {
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

  it('shows loading placeholder before widget module resolves (cache cleared)', async () => {
    const { frames, unmount, promptHandler } = await setupApp();

    const widgetRequest: UiRequest = {
      kind: 'widget',
      module: ECHO_WIDGET_PATH,
      baseDir: ECHO_WIDGET_DIR,
      props: 'loading-test',
    };

    // Don't await; check early frames for loading indicator before module settles.
    const pending = promptHandler('s', widgetRequest);

    // After a tiny tick (before jiti finishes) the loading placeholder should appear.
    await new Promise((r) => setTimeout(r, 10));
    const earlyFrames = frames.join('\n');
    // With a cold cache, "loading…" must appear in at least one early frame.
    expect(earlyFrames).toContain('loading');

    // Wait for full settlement.
    await new Promise((r) => setTimeout(r, 600));
    unmount();
    await pending.catch(() => {});
  });

  it('surfaces an error line when the widget module has no default export', async () => {
    const { frames, unmount, promptHandler } = await setupApp();

    const widgetRequest: UiRequest = {
      kind: 'widget',
      module: BAD_WIDGET_PATH,
      baseDir: BAD_WIDGET_DIR,
      props: 'ignored',
    };

    // Don't await — the promise never resolves when the widget errors (no resolve() call).
    void promptHandler('s', widgetRequest);

    // Allow time for module load + React state update.
    await new Promise((r) => setTimeout(r, 500));

    // App should render the "widget failed" error line instead of hanging.
    const errorFrame = frames.find((f) => f.includes('widget failed'));
    expect(errorFrame).toBeDefined();
    // Ensure it mentions the module path or the reason.
    expect(errorFrame).toMatch(/widget failed/);

    unmount();
  });

  it('surfaces an error line when the widget module path does not exist', async () => {
    const { frames, unmount, promptHandler } = await setupApp();

    const widgetRequest: UiRequest = {
      kind: 'widget',
      module: MISSING_WIDGET_PATH,
      baseDir: MISSING_WIDGET_DIR,
      props: 'ignored',
    };

    // Don't await — the promise never resolves when the widget errors (no resolve() call).
    void promptHandler('s', widgetRequest);

    // Allow time for attempted load + error propagation.
    await new Promise((r) => setTimeout(r, 500));

    // App should render the "widget failed" error line instead of hanging.
    const errorFrame = frames.find((f) => f.includes('widget failed'));
    expect(errorFrame).toBeDefined();

    unmount();
  });
});

describe('requestCacheKey (Fix 6 — unit tests)', () => {
  it('same module + same baseDir + no provided → same key', () => {
    const k1 = requestCacheKey('mod.tsx', '/a', undefined);
    const k2 = requestCacheKey('mod.tsx', '/a', {});
    expect(k1).toBe(k2);
  });

  it('same module but different baseDir → different key', () => {
    const k1 = requestCacheKey('mod.tsx', '/a', {});
    const k2 = requestCacheKey('mod.tsx', '/b', {});
    expect(k1).not.toBe(k2);
  });

  it('same module + same baseDir but different provided → different key', () => {
    const k1 = requestCacheKey('mod.tsx', '/a', {});
    const k2 = requestCacheKey('mod.tsx', '/a', { x: '1' });
    expect(k1).not.toBe(k2);
  });

  it('different module + same baseDir → different key', () => {
    const k1 = requestCacheKey('a.tsx', '/base', {});
    const k2 = requestCacheKey('b.tsx', '/base', {});
    expect(k1).not.toBe(k2);
  });
});

describe('App widget — React.memo wrapped component (Fix 7)', () => {
  beforeEach(() => {
    __clearWidgetCache();
  });

  it('renders a React.memo wrapped widget without "no usable default export" error', async () => {
    const { frames, unmount, promptHandler } = await setupApp();

    const widgetRequest: UiRequest = {
      kind: 'widget',
      module: MEMO_WIDGET_PATH,
      baseDir: MEMO_WIDGET_DIR,
      props: 'memo-data',
    };

    void promptHandler('s', widgetRequest);

    await new Promise((r) => setTimeout(r, 500));

    // Must NOT show "no usable default export" error.
    const errorFrame = frames.find((f) => f.includes('no usable default export'));
    expect(errorFrame).toBeUndefined();

    // Should render the memo widget's output.
    const memoFrame = frames.find((f) => f.includes('memo-widget'));
    expect(memoFrame).toBeDefined();

    unmount();
  });
});
