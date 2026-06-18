import { resolve as resolvePath } from 'node:path';
import { createJiti } from 'jiti';
import { z } from 'zod';
import type { JsonSchema } from '../providers/types.js';

const jiti = createJiti(import.meta.url);

export interface LoadedSchema {
  jsonSchema: JsonSchema;
  validate(value: unknown): unknown;
}

export async function loadSchema(path: string, baseDir: string): Promise<LoadedSchema> {
  const abs = resolvePath(baseDir, path);
  const mod = (await jiti.import(abs)) as { default?: unknown } & unknown;
  const descriptor = Object.getOwnPropertyDescriptor(mod, 'default');
  const schema = (descriptor && 'value' in descriptor ? descriptor.value : mod.default) ?? mod;
  if (!(schema instanceof z.ZodType)) {
    throw new Error(`schema file ${path} must "export default" a Zod schema`);
  }
  return {
    jsonSchema: z.toJSONSchema(schema) as JsonSchema,
    validate: (value: unknown) => schema.parse(value),
  };
}
