import { describe, it, expect } from 'vitest';
import { resolve, type ExprContext } from './expression.js';

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
