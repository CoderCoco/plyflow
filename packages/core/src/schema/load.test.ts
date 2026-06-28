import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { z } from 'zod';
import { createLoader } from '../core/module-loader.js';
import { loadSchema } from './load.js';

const baseDir = dirname(fileURLToPath(new URL('./__fixtures__/x', import.meta.url)));
const loader = createLoader({ baseDir });

describe('loadSchema', () => {
  it('produces a JSON schema and validates conforming data', async () => {
    const s = await loadSchema('./Summary.ts', baseDir, loader.import.bind(loader));
    expect(s.jsonSchema).toHaveProperty('properties.title');
    expect(s.validate({ title: 'T', points: ['a'] })).toEqual({ title: 'T', points: ['a'] });
  });

  it('throws on non-conforming data', async () => {
    const s = await loadSchema('./Summary.ts', baseDir, loader.import.bind(loader));
    expect(() => s.validate({ title: 1 })).toThrow();
  });

  it('loaded schema is instanceof z.ZodType (realm sharing end-to-end)', async () => {
    // Load the schema file via the shared loader and verify that the schema
    // object is a true instance of plyflow's z.ZodType — proving the loader's
    // virtualModules aliasing eliminates the dual-realm problem.
    const mod = await loader.import(baseDir + '/Summary.ts');
    const schema = (mod as { default?: unknown }).default;
    expect(schema).toBeInstanceOf(z.ZodType);
  });
});
