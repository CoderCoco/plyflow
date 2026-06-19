import type { StepDef } from './types.js';
import type { StepRegistry } from '../steps/registry.js';
import type { StepType } from '../steps/types.js';

/**
 * Determine whether a value looks like a StepType: must have a `name` string,
 * a `match` function, and a `run` function.
 */
function isStepType(value: unknown): value is StepType {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['match'] === 'function' &&
    typeof v['parse'] === 'function' &&
    typeof v['run'] === 'function'
  );
}

/**
 * Wrap a StepType so its effective `match` is `(d) => d.step === type.name`,
 * regardless of what the plugin author wrote for `match`.
 *
 * This is approach (b): the loader enforces the invocation convention
 * `step: <name>` so plugin authors only need to supply `name`, `parse`, `run`.
 */
function wrapStepType(type: StepType): StepType {
  return {
    name: type.name,
    match: (def: StepDef) => def.step === type.name,
    parse: type.parse.bind(type),
    run: type.run.bind(type),
  };
}

/**
 * Load and register user plugin modules into the step registry.
 *
 * Two plugin forms are supported:
 *
 * 1. **StepType form** — the default export is an object with `name`, `match`,
 *    and `run`. The loader WRAPS it so its effective match is
 *    `(d) => d.step === type.name` (approach b). Plugin authors only need to
 *    provide `name`, `parse`, and `run`; they don't have to worry about how
 *    the invocation key works.
 *
 * 2. **Register-function form** — the default export is a plain function. The
 *    loader calls `fn(registry)`. The function is responsible for calling
 *    `registry.register(...)` itself, including writing any `match` predicate it
 *    needs. By convention, register-fn plugins should use
 *    `match: (d) => d.step === '<name>'` so steps resolve via `step: <name>`.
 *
 * @param plugins  Paths to plugin modules (passed as-is to `load`).
 * @param registry The step registry to register types into.
 * @param load     Module loader function (injected; in production this is
 *                 the jiti-based `ModuleLoader.import`; in tests it's a fake).
 */
export async function loadPlugins(
  plugins: string[],
  registry: StepRegistry,
  load: (path: string) => Promise<unknown>,
): Promise<void> {
  for (const pluginPath of plugins) {
    const mod = await load(pluginPath);

    // Unwrap ES-module-style namespace objects: { default: ... }
    const def =
      mod != null &&
      typeof mod === 'object' &&
      'default' in (mod as object)
        ? (mod as Record<string, unknown>)['default']
        : mod;

    if (isStepType(def)) {
      // StepType form: wrap to enforce step:<name> match convention
      registry.register(wrapStepType(def));
    } else if (typeof def === 'function') {
      // Register-function form: delegate to the plugin
      (def as (registry: StepRegistry) => void)(registry);
    } else {
      throw new Error(
        `Plugin at "${pluginPath}" has an unrecognized default export. ` +
          `Expected either a StepType object ({ name, match, run }) ` +
          `or a register function (registry) => void. Got: ${typeof def}`,
      );
    }
  }
}
