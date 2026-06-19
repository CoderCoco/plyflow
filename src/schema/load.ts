import { resolve as resolvePath } from 'node:path';
import { z } from 'zod';
import type { JsonSchema } from '../providers/types.js';

export interface LoadedSchema {
  jsonSchema: JsonSchema;
  validate(value: unknown): unknown;
}

/**
 * Load a Zod schema from a user `.ts` file via the run's shared module loader.
 *
 * The loader (from `createLoader`) aliases plyflow's own zod to loaded modules,
 * so `schema instanceof z.ZodType` is guaranteed to hold — the dual-realm
 * duck-typing workaround is no longer needed.
 *
 * @param path - Path to the schema file (absolute or relative to baseDir).
 * @param baseDir - Workflow directory (used to resolve relative paths).
 * @param loadModule - The `ctx.loadModule` function from `StepContext`, which
 *   routes through the central module loader with provided-module aliasing.
 */
export async function loadSchema(
  path: string,
  baseDir: string,
  loadModule: (path: string) => Promise<unknown>,
): Promise<LoadedSchema> {
  // Resolve to absolute so the loader always gets an unambiguous path.
  const abs = resolvePath(baseDir, path);

  const mod = await loadModule(abs);
  const schema = (mod as { default?: unknown } | undefined)?.default;

  if (!(schema instanceof z.ZodType)) {
    throw new Error(`schema file ${path} must "export default" a Zod schema`);
  }

  return {
    jsonSchema: z.toJSONSchema(schema) as JsonSchema,
    validate: (value: unknown) => schema.parse(value),
  };
}
