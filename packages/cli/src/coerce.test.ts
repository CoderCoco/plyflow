import { describe, it, expect } from 'vitest';
import { coerceInputs } from './coerce.js';

const defs = (d: Record<string, string>) =>
  Object.fromEntries(Object.entries(d).map(([k, t]) => [k, { type: t }]));

describe('coerceInputs', () => {
  it('coerces number and boolean (unchanged behaviour)', () => {
    const out = coerceInputs({ n: '3', b: 'true', s: 'hi' }, defs({ n: 'number', b: 'boolean', s: 'string' }));
    expect(out).toEqual({ n: 3, b: true, s: 'hi' });
  });

  it('parses json/object/array from a JSON string', () => {
    const out = coerceInputs(
      { j: '{"a":1}', o: '{"x":true}', a: '[1,2,3]' },
      defs({ j: 'json', o: 'object', a: 'array' }),
    );
    expect(out).toEqual({ j: { a: 1 }, o: { x: true }, a: [1, 2, 3] });
  });

  it('asserts object is a non-array object and array is an array', () => {
    expect(() => coerceInputs({ o: '[1]' }, defs({ o: 'object' }))).toThrow(/object/i);
    expect(() => coerceInputs({ a: '{}' }, defs({ a: 'array' }))).toThrow(/array/i);
  });

  it('reads @file.json via the injected readFile', () => {
    const readFile = (p: string) => (p === '/cfg.json' ? '{"k":42}' : (() => { throw new Error('no'); })());
    const out = coerceInputs({ c: '@/cfg.json' }, defs({ c: 'object' }), readFile);
    expect(out).toEqual({ c: { k: 42 } });
  });

  it('throws a clear error on invalid JSON', () => {
    expect(() => coerceInputs({ j: 'not json' }, defs({ j: 'json' }))).toThrow(/json/i);
  });

  it('leaves unknown/declared-less keys as raw strings', () => {
    expect(coerceInputs({ x: 'v' }, undefined)).toEqual({ x: 'v' });
  });
});
