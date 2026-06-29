import { isAbsolute, resolve as resolvePath } from 'node:path';

/**
 * Resolve a plugin reference for loading. Relative refs (`./`, `../`) are made
 * absolute against the workflow dir; absolute refs pass through; a bare package
 * specifier (`pkg`, `@scope/pkg`, `@scope/pkg/sub`) passes through unchanged so
 * the module loader can resolve it from the workflow's node_modules.
 */
export function resolvePluginRef(dir: string, ref: string): string {
  if (isAbsolute(ref)) return ref;
  if (ref.startsWith('./') || ref.startsWith('../')) return resolvePath(dir, ref);
  return ref;
}
