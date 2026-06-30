import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'ink';
import { createLoader, DEFAULT_PROVIDED } from '@plyflow/core/module-loader';
import type { UiRequest } from '@plyflow/core';

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

/** Reset the widget module cache. Exported for test isolation only. */
export function __clearWidgetCache(): void {
  widgetCache.clear();
}

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
export function WidgetHost({ request, onResolve }: WidgetHostProps): React.ReactElement | null {
  const [component, setComponent] = useState<WidgetComponent | null>(() => {
    // Synchronously use the cache on initial render to avoid a loading flash
    // when the module was already loaded in this process session.
    return widgetCache.get(request.module) ?? null;
  });
  const [error, setError] = useState<Error | null>(null);

  // Stable ref so the effect closure doesn't capture a stale onResolve.
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  useEffect(() => {
    if (widgetCache.has(request.module)) {
      setComponent(widgetCache.get(request.module)!);
      return;
    }
    const loader = createLoader({ baseDir: request.baseDir, provided: request.provided ?? DEFAULT_PROVIDED, jsx: true });
    let cancelled = false;
    loader.import(request.module).then((mod) => {
      if (cancelled) return;
      // Support both ESM default export and CommonJS module.exports patterns.
      const ns = mod as Record<string, unknown>;
      const Comp = ns['default'] ?? mod;
      if (typeof Comp !== 'function') {
        setError(new Error(`widget module "${request.module}" has no usable default export`));
        return;
      }
      widgetCache.set(request.module, Comp as WidgetComponent);
      setComponent(() => Comp as WidgetComponent);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    });
    return () => { cancelled = true; };
  }, [request.module, request.baseDir]);

  if (error) {
    return <Text color="red">widget failed: {error.message}</Text>;
  }

  if (!component) {
    return <Text dimColor>loading…</Text>;
  }

  const Component = component;
  return <Component data={request.props} resolve={onResolveRef.current} />;
}
