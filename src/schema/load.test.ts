import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadSchema } from './load.js';

const baseDir = dirname(fileURLToPath(new URL('./__fixtures__/x', import.meta.url)));

describe('loadSchema', () => {
  it('produces a JSON schema and validates conforming data', async () => {
    const s = await loadSchema('./Summary.ts', baseDir);
    expect(s.jsonSchema).toHaveProperty('properties.title');
    expect(s.validate({ title: 'T', points: ['a'] })).toEqual({ title: 'T', points: ['a'] });
  });

  it('throws on non-conforming data', async () => {
    const s = await loadSchema('./Summary.ts', baseDir);
    expect(() => s.validate({ title: 1 })).toThrow();
  });
});
