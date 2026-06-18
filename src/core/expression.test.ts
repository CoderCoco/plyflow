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
