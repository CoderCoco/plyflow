/**
 * Central module loader with host-provided library aliasing.
 *
 * Solves the "dual-realm" problem: when jiti transpiles user `.ts` files it
 * normally uses its own module resolution, so `import { z } from 'zod'` inside
 * a user file gets a different zod instance from plyflow's own zod.
 * This means `schema instanceof z.ZodType` returns false — the root cause of
 * the duck-typing workaround in `src/schema/load.ts`.
 *
 * Fix: use jiti's `virtualModules` option (jiti 2.7).  When a module ID
 * matches a key in `virtualModules`, jiti returns the value directly without
 * any filesystem resolution or transformation — guaranteeing that the loaded
 * code and plyflow share the exact same module instance (same realm).
 * `instanceof`, `===` equality, and all other identity checks hold.
 *
 * jiti option used:
 *   `virtualModules: Record<string, unknown>`
 *     - Keys are bare specifiers ('zod', 'react', 'ink').
 *     - Values are the ESM namespace objects from plyflow's own dynamic imports.
 *     - jiti short-circuits filesystem resolution and returns the value as-is.
 *     - Realm identity is guaranteed because plyflow's singleton module objects
 *       are handed directly to the loaded code.
 */

import { createJiti } from 'jiti';
import { resolve as resolvePath, isAbsolute } from 'node:path';

/** Specifiers that plyflow provides to loaded modules by default. */
export const DEFAULT_PROVIDED: string[] = ['zod', 'react', 'ink'];

export interface LoaderOptions {
  /** Absolute path to the directory that user imports resolve from. */
  baseDir: string;
  /**
   * Bare specifiers whose modules should be shared with plyflow's own copies.
   * Defaults to `DEFAULT_PROVIDED`.
   */
  provided?: string[];
  /**
   * Enable JSX/TSX support via jiti's Babel JSX transform.
   * Required when loading `.tsx` / `.jsx` widget components.
   * Defaults to `false`.
   */
  jsx?: boolean;
}

export interface ModuleLoader {
  /**
   * Load a module.  Relative paths are resolved from `baseDir`.
   * Returns the full module namespace object.
   */
  import(path: string): Promise<unknown>;
}

/**
 * Attempt to dynamically import a specifier from plyflow's own module realm.
 * Returns `undefined` if the specifier is not installed (defensive skip).
 */
async function tryImportProvided(specifier: string): Promise<unknown | undefined> {
  try {
    return await import(specifier);
  } catch {
    return undefined;
  }
}

/**
 * Build a `ModuleLoader` that:
 * 1. Loads `.ts`/`.tsx` user code via jiti.
 * 2. Passes plyflow's own module objects as `virtualModules` so that user code
 *    which imports provided specifiers (zod, react, ink) gets the exact same
 *    singleton already loaded by plyflow — sharing the module realm.
 *
 * The jiti instance is created lazily on the first `.import()` call so that
 * `createLoader` itself remains synchronous while the async virtualModules
 * population happens once before the first load.
 */
export function createLoader(opts: LoaderOptions): ModuleLoader {
  const provided = opts.provided ?? DEFAULT_PROVIDED;

  // Lazily-initialised jiti instance. Memoise the PROMISE (not the resolved
  // value) so that concurrent callers — e.g. parallel `foreach`/`parallel`
  // steps loading modules at once — all await the SAME initialisation and
  // share one jiti instance, rather than each racing to build its own.
  let jitiPromise: Promise<(abs: string) => Promise<unknown>> | undefined;

  function ensureJiti(): Promise<(abs: string) => Promise<unknown>> {
    if (jitiPromise) return jitiPromise;
    jitiPromise = (async () => {
      // Build virtualModules: specifier → plyflow's own module namespace object.
      const virtualModules: Record<string, unknown> = {};
      await Promise.all(
        provided.map(async (spec) => {
          const mod = await tryImportProvided(spec);
          if (mod !== undefined) {
            virtualModules[spec] = mod;
          }
        }),
      );

      const jiti = createJiti(import.meta.url, {
        virtualModules,
        // Disable jiti's interopDefault proxy.  When enabled, the proxy wraps
        // the default export in a Function, which breaks `instanceof` checks on
        // class instances (e.g. `schema instanceof z.ZodType`).  Disabling it
        // returns the raw module namespace, so identity checks work correctly.
        interopDefault: false,
        // JSX/TSX support via Babel transform; required for widget components.
        jsx: opts.jsx ?? false,
      });
      return (abs: string) => jiti.import(abs);
    })();
    return jitiPromise;
  }

  return {
    async import(path: string): Promise<unknown> {
      const abs = isAbsolute(path) ? path : resolvePath(opts.baseDir, path);
      const load = await ensureJiti();
      return load(abs);
    },
  };
}
