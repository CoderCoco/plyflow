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
  // Only treat extension-bearing strings as local files when there is no path
  // separator — a slash means it's a package subpath like `yaml/dist/index.js`
  // or `@scope/pkg/plugin.js` that must resolve from node_modules.
  const bare = !ref.includes('/');
  if (
    ref.startsWith('./') ||
    ref.startsWith('../') ||
    (bare && (ref.endsWith('.ts') || ref.endsWith('.js') || ref.endsWith('.tsx') || ref.endsWith('.jsx')))
  ) {
    return resolvePath(dir, ref);
  }
  return ref; // bare package specifier
}
