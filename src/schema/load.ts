import { resolve as resolvePath } from 'node:path';
import { createJiti } from 'jiti';
import { z } from 'zod';
import type { JsonSchema } from '../providers/types.js';

const jiti = createJiti(import.meta.url);

export interface LoadedSchema {
  jsonSchema: JsonSchema;
  validate(value: unknown): unknown;
}

interface ZodLike {
  parse(value: unknown): unknown;
  safeParse(value: unknown): unknown;
}

/**
 * Locate the Zod schema in a jiti-loaded module.
 *
 * jiti transpiles user `.ts` files in its own module realm, so a schema it
 * returns is NOT an instance of this process's `z.ZodType` (the dual-package
 * instance problem), and jiti's CJS/ESM interop places the schema at a
 * different property (`mod`, `mod.default`, or `mod.default.default`) depending
 * on the host loader. We therefore duck-type the schema by its `parse`/
 * `safeParse` methods instead of using `instanceof`, and scan the likely
 * locations. `z.toJSONSchema()` and `schema.parse()` operate on the schema's
 * plain internal structure and work across realms for the same Zod version.
 */
function findSchema(mod: unknown): ZodLike | undefined {
  const m = mod as { default?: { default?: unknown } | unknown };
  const candidates: unknown[] = [
    (m?.default as { default?: unknown } | undefined)?.default,
    m?.default,
    mod,
  ];
  for (const c of candidates) {
    if (
      c &&
      (typeof c === 'object' || typeof c === 'function') &&
      typeof (c as ZodLike).parse === 'function' &&
      typeof (c as ZodLike).safeParse === 'function'
    ) {
      return c as ZodLike;
    }
  }
  return undefined;
}

export async function loadSchema(path: string, baseDir: string): Promise<LoadedSchema> {
  const abs = resolvePath(baseDir, path);
  const mod = await jiti.import(abs);
  const schema = findSchema(mod);
  if (!schema) {
    throw new Error(`schema file ${path} must "export default" a Zod schema`);
  }
  return {
    jsonSchema: z.toJSONSchema(schema as never) as JsonSchema,
    validate: (value: unknown) => schema.parse(value),
  };
}
