import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { ProgressTree, type PhaseView, type StepView } from './ProgressTree.js';
import { Prompt } from './prompts.js';
import { createLoader } from '../core/module-loader.js';
import type { EngineEvent } from '../core/engine.js';
import type { UiRequest, PromptRequest } from '../steps/types.js';
import type { WorkflowFile } from '../core/types.js';

interface PendingUi {
  stepId: string;
  request: UiRequest;
  resolve: (value: unknown) => void;
}

export interface AppProps {
  workflow: WorkflowFile;
  events: AsyncIterable<EngineEvent>;
  registerPrompt: (handler: (stepId: string, req: UiRequest) => Promise<unknown>) => void;
  onDone: () => void;
}

/**
 * Widget component contract:
 *   props `{ data: unknown, resolve: (value: unknown) => void }`
 *
 * The App passes these to every custom widget component it mounts:
 *   - `data`    — the `props` field from the `widget` UiRequest (workflow step output)
 *   - `resolve` — call this to complete the pending UI request and return a value
 *                 to the workflow engine (mirrors the prompt's `onResolve` callback)
 */
type WidgetComponent = React.ComponentType<{ data: unknown; resolve: (value: unknown) => void }>;

/** Cache of already-loaded widget modules, keyed by absolute module path. */
const widgetCache = new Map<string, WidgetComponent>();

interface WidgetHostProps {
  request: Extract<UiRequest, { kind: 'widget' }>;
  onResolve: (value: unknown) => void;
}

/**
 * WidgetHost loads a custom widget component from the given module path using
 * the central module loader (so the widget's react/ink resolve to plyflow's
 * own copies — required for Ink context to work correctly).
 *
 * Rendering lifecycle:
 *   1. First render: `component` state is null → renders a "loading…" Text.
 *   2. useEffect fires: if the module is already in the cache, uses it directly;
 *      otherwise builds a loader and imports the module, then sets state.
 *   3. Re-render: `component` is set → renders `<Component data={...} resolve={...} />`.
 *
 * The cache (`widgetCache`) prevents reloading the same module if the component
 * re-renders (e.g. due to parent state changes) before the widget resolves.
 */
function WidgetHost({ request, onResolve }: WidgetHostProps): React.ReactElement | null {
  const [component, setComponent] = useState<WidgetComponent | null>(() => {
    // Synchronously use the cache on initial render to avoid a loading flash
    // when the module was already loaded in this process session.
    return widgetCache.get(request.module) ?? null;
  });

  // Stable ref so the effect closure doesn't capture a stale onResolve.
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  useEffect(() => {
    if (widgetCache.has(request.module)) {
      setComponent(widgetCache.get(request.module)!);
      return;
    }
    const loader = createLoader({ baseDir: request.baseDir, jsx: true });
    let cancelled = false;
    loader.import(request.module).then((mod) => {
      if (cancelled) return;
      // Support both ESM default export and CommonJS module.exports patterns.
      const ns = mod as Record<string, unknown>;
      const Comp = (ns['default'] ?? mod) as WidgetComponent;
      widgetCache.set(request.module, Comp);
      setComponent(() => Comp);
    });
    return () => { cancelled = true; };
  }, [request.module, request.baseDir]);

  if (!component) {
    return <Text dimColor>loading…</Text>;
  }

  const Component = component;
  return <Component data={request.props} resolve={onResolveRef.current} />;
}

function initialPhases(wf: WorkflowFile): PhaseView[] {
  return wf.phases.map((p) => ({
    name: p.name,
    steps: p.steps.map<StepView>((s) => ({ id: s.id, status: 'pending' })),
  }));
}

export function App({ workflow, events, registerPrompt, onDone }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [phases, setPhases] = useState<PhaseView[]>(() => initialPhases(workflow));
  const [pending, setPending] = useState<PendingUi | null>(null);

  const setStatus = (id: string, patch: Partial<StepView>) =>
    setPhases((prev) =>
      prev.map((ph) => ({ ...ph, steps: ph.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    );

  useEffect(() => {
    registerPrompt(
      (stepId, request) =>
        new Promise((resolve) => setPending({ stepId, request, resolve: (v) => { setPending(null); resolve(v); } })),
    );
    (async () => {
      for await (const e of events) {
        if (e.type === 'step-start') setStatus(e.stepId, { status: 'running' });
        else if (e.type === 'step-done') setStatus(e.stepId, { status: 'done', cached: e.cached });
        else if (e.type === 'step-error') setStatus(e.stepId, { status: 'error' });
      }
      onDone();
      exit();
    })();
  }, []);

  function renderPending(p: PendingUi): React.ReactElement | null {
    if (p.request.kind === 'prompt') {
      // Cast is safe: PromptRequest is exactly the prompt-kind of UiRequest.
      return <Prompt request={p.request as PromptRequest} onResolve={p.resolve} />;
    }
    // widget kind: delegate to WidgetHost which loads the component asynchronously.
    return <WidgetHost request={p.request} onResolve={p.resolve} />;
  }

  return (
    <Box flexDirection="column">
      <ProgressTree phases={phases} />
      {pending && renderPending(pending)}
    </Box>
  );
}
