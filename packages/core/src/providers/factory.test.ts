import { describe, it, expect } from 'vitest';
import { makeProvider } from './factory.js';

describe('makeProvider', () => {
  it('builds a claude provider', () => {
    expect(makeProvider('claude', 'api').name).toBe('claude');
  });

  it('throws on an unknown provider', () => {
    expect(() => makeProvider('mystery', 'api')).toThrow(/unknown provider/i);
  });
});
