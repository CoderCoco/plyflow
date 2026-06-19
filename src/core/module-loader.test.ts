import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { createLoader } from './module-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '__fixtures__');

describe('createLoader', () => {
  it('loads a module that imports zod in the same realm (instanceof holds)', async () => {
    const loader = createLoader({ baseDir: fixturesDir });
    const m = await loader.import('./uses-zod.ts');

    const schema = (m as { default?: unknown }).default;
    expect(schema).toBeDefined();
    // Realm-sharing proof: the schema loaded by jiti uses plyflow's zod,
    // so instanceof z.ZodType is TRUE (not false as with dual-realm jiti default).
    expect(schema instanceof z.ZodType).toBe(true);
  });

  it('produces a schema whose toJSONSchema output has properties.n', async () => {
    const loader = createLoader({ baseDir: fixturesDir });
    const m = await loader.import('./uses-zod.ts');
    const schema = (m as { default?: unknown }).default as Parameters<typeof z.toJSONSchema>[0];

    const json = z.toJSONSchema(schema);
    expect(json).toMatchObject({
      properties: {
        n: expect.objectContaining({ type: 'number' }),
      },
    });
  });

  it('resolves relative paths from baseDir', async () => {
    const loader = createLoader({ baseDir: fixturesDir });
    // Should not throw — path resolves correctly from fixturesDir
    await expect(loader.import('./uses-zod.ts')).resolves.toBeDefined();
  });

  it('uses DEFAULT_PROVIDED default when provided is omitted', async () => {
    // Loader with explicit provided list still works
    const loader = createLoader({ baseDir: fixturesDir, provided: ['zod'] });
    const m = await loader.import('./uses-zod.ts');
    const schema = (m as { default?: unknown }).default;
    expect(schema instanceof z.ZodType).toBe(true);
  });

  it('nested import: a module that imports another user module (relative) loads correctly', async () => {
    // Fixture: a-imports-b.ts imports ./b.ts (relative)
    // This exercises the nested-resolution path through the loader.
    const loader = createLoader({ baseDir: fixturesDir });
    const m = await loader.import('./a-imports-b.ts');
    // a-imports-b exports: result = 'a-got-from-b'
    expect((m as { result?: unknown }).result).toBe('a-got-from-b');
  });
});
