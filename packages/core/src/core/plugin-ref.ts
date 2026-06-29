import { isAbsolute, resolve as resolvePath } from 'node:path';

/**
 * Resolve a plugin reference for loading. Relative refs (`./`, `../`) are made
 * absolute against the workflow dir; absolute refs pass through; extension-bearing
 * bare filenames (`echo-plugin.ts`, `p.js`) are treated as local files and resolved
 * relative to `dir` for back-compat with `package.json` `plyflow.plugins` configs
 * that omit the leading `./`; a bare package specifier (`pkg`, `@scope/pkg`,
 * `@scope/pkg/sub`) passes through unchanged so the module loader can resolve it
 * from the workflow's node_modules.
 */
export function resolvePluginRef(dir: string, ref: string): string {
  if (isAbsolute(ref)) return ref;
  if (
    ref.startsWith('./') ||
    ref.startsWith('../') ||
    ref.endsWith('.ts') ||
    ref.endsWith('.js') ||
    ref.endsWith('.tsx') ||
    ref.endsWith('.jsx')
  ) {
    return resolvePath(dir, ref);
  }
  return ref; // bare package specifier
}
