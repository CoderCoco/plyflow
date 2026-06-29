import { describe, it, expect } from 'vitest';
import { resolve, EXPRESSION_HELPERS, type ExprContext } from './expression.js';

const ctx: ExprContext = {
  inputs: { repo: '/tmp/x', count: 3 },
  steps: { read: { output: { text: 'hello' } } },
  env: { HOME: '/home/chris' },
};

describe('resolve', () => {
  it('returns the typed value when the whole string is one expression', () => {
    expect(resolve('${{ inputs.count }}', ctx)).toBe(3);
  });

  it('interpolates within a larger string', () => {
    expect(resolve('repo=${{ inputs.repo }}!', ctx)).toBe('repo=/tmp/x!');
  });

  it('reads nested step output', () => {
    expect(resolve('${{ steps.read.output.text }}', ctx)).toBe('hello');
  });

  it('recurses into objects and arrays', () => {
    expect(resolve({ a: ['${{ inputs.count }}'] }, ctx)).toEqual({ a: [3] });
  });

  it('leaves non-expression strings untouched', () => {
    expect(resolve('plain', ctx)).toBe('plain');
  });
});

const ctx2 = (over: Partial<Parameters<typeof resolve>[1]> = {}) => ({
  inputs: {}, steps: {}, env: {}, bindings: {}, ...over,
});

describe('expression stdlib', () => {
  it('exposes a frozen helper namespace', () => {
    expect(Object.isFrozen(EXPRESSION_HELPERS)).toBe(true);
    expect(typeof EXPRESSION_HELPERS.map).toBe('function');
  });

  it('map/filter/flatMap as bare identifiers', () => {
    expect(resolve('${{ map([1,2,3], x => x * 2) }}', ctx2())).toEqual([2, 4, 6]);
    expect(resolve('${{ filter([1,2,3,4], x => x % 2 === 0) }}', ctx2())).toEqual([2, 4]);
    expect(resolve('${{ flatMap([[1],[2,3]], x => x) }}', ctx2())).toEqual([1, 2, 3]);
  });

  it('unique/groupBy/len/flat/sort', () => {
    expect(resolve('${{ unique([1,1,2,3,3]) }}', ctx2())).toEqual([1, 2, 3]);
    expect(resolve('${{ groupBy([1,2,3,4], x => x % 2 === 0 ? "even" : "odd") }}', ctx2())).toEqual({
      odd: [1, 3], even: [2, 4],
    });
    expect(resolve('${{ len([1,2,3]) }}', ctx2())).toBe(3);
    expect(resolve('${{ flat([[1],[2,[3]]]) }}', ctx2())).toEqual([1, 2, [3]]);
    expect(resolve('${{ sort([3,1,2]) }}', ctx2())).toEqual([1, 2, 3]);
  });

  it('keys/values/entries over an object', () => {
    expect(resolve('${{ keys({a:1,b:2}) }}', ctx2())).toEqual(['a', 'b']);
    expect(resolve('${{ values({a:1,b:2}) }}', ctx2())).toEqual([1, 2]);
    expect(resolve('${{ entries({a:1}) }}', ctx2())).toEqual([['a', 1]]);
  });

  it('helpers compose with inputs/steps', () => {
    const c = ctx2({ steps: { f: { output: { items: [{ n: 1 }, { n: 2 }] } } } });
    expect(resolve('${{ map(steps.f.output.items, i => i.n) }}', c)).toEqual([1, 2]);
  });

  it('a workflow binding takes precedence over a same-named helper', () => {
    // `map` is also a helper; a binding named `map` must win (no double-const crash).
    const c = ctx2({ bindings: { map: 'I am a binding' } });
    expect(resolve('${{ map }}', c)).toBe('I am a binding');
  });
});

describe('resolve with bindings', () => {
  it('resolves a binding named "item"', () => {
    const c: ExprContext = {
      inputs: {},
      steps: {},
      env: {},
      bindings: { item: { n: 5 } },
    };
    expect(resolve('${{ item.n }}', c)).toBe(5);
  });

  it('does not throw when a binding key collides with a named param ("env")', () => {
    // A binding named "env" previously caused SyntaxError: Duplicate parameter name
    // under strict mode (when binding keys were spread as individual function params).
    // With the __b object approach, colliding keys are simply skipped from const-decls
    // so no SyntaxError is thrown and other bindings still resolve correctly.
    const c: ExprContext = {
      inputs: {},
      steps: {},
      env: { X: 'outer' },
      bindings: { env: { X: 'inner' }, item: 42 },
    };
    // Must not throw even though a binding key is named "env"
    expect(() => resolve('${{ item }}', c)).not.toThrow();
    // Non-colliding binding resolves correctly
    expect(resolve('${{ item }}', c)).toBe(42);
    // "env" binding key is skipped; the expression sees the real env param value
    expect(resolve('${{ env.X }}', c)).toBe('outer');
  });
});
