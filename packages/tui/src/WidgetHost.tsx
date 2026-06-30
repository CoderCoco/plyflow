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

/**
 * Compute a cache key that covers the full request identity: the module specifier,
 * the base directory used for resolution, and the `provided` package overrides.
 * Two requests that share the same module string but differ in baseDir or provided
 * would resolve to different implementations and must not share a cached component.
 */
export function requestCacheKey(
  module: string,
  baseDir: string,
  provided: Record<string, string> | undefined,
): string {
  return `${module}\0${baseDir}\0${JSON.stringify(provided ?? {})}`;
}

/** Cache of already-loaded widget modules, keyed by full request identity (see requestCacheKey). */
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
  const key = requestCacheKey(request.module, request.baseDir, request.provided);

  const [component, setComponent] = useState<WidgetComponent | null>(() => {
    // Synchronously use the cache on initial render to avoid a loading flash
    // when the module was already loaded in this process session.
    return widgetCache.get(key) ?? null;
  });
  const [error, setError] = useState<Error | null>(null);

  // Stable ref so the effect closure doesn't capture a stale onResolve.
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  // When the full request identity changes, sync component/error state from the cache
  // (or clear them so the loader effect below will re-fetch).
  useEffect(() => {
    setComponent(widgetCache.get(key) ?? null);
    setError(null);
  }, [key]);

  useEffect(() => {
    if (widgetCache.has(key)) {
      setComponent(widgetCache.get(key)!);
      return;
    }
    const loader = createLoader({ baseDir: request.baseDir, provided: request.provided ?? DEFAULT_PROVIDED, jsx: true });
    let cancelled = false;
    loader.import(request.module).then((mod) => {
      if (cancelled) return;
      // Support both ESM default export and CommonJS module.exports patterns.
      const ns = mod as Record<string, unknown>;
      const Comp = ns['default'] ?? mod;
      // Accept plain functions and React wrapped components (React.memo, React.forwardRef, etc.)
      // which are plain objects with a `$$typeof` symbol property.
      const isRenderable =
        typeof Comp === 'function' ||
        (typeof Comp === 'object' && Comp !== null && typeof (Comp as Record<string | symbol, unknown>)['$$typeof'] === 'symbol');
      if (!isRenderable) {
        setError(new Error(`widget module "${request.module}" has no usable default export`));
        return;
      }
      widgetCache.set(key, Comp as WidgetComponent);
      setComponent(() => Comp as WidgetComponent);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    });
    return () => { cancelled = true; };
  }, [key, request.module, request.baseDir, request.provided]);

  if (error) {
    return <Text color="red">widget failed: {error.message}</Text>;
  }

  if (!component) {
    return <Text dimColor>loading…</Text>;
  }

  const Component = component;
  return <Component data={request.props} resolve={onResolveRef.current} />;
}
