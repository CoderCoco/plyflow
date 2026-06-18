import { describe, it, expect } from 'vitest';
import { StepRegistry } from './registry.js';
import type { StepType } from './types.js';

const fake = (name: string, key: string): StepType => ({
  name,
  match: (def) => (def as any)[key] !== undefined,
  parse: (def) => def,
  run: async () => ({ output: null }),
});

describe('StepRegistry', () => {
  it('selects the step type whose match() returns true', () => {
    const r = new StepRegistry();
    r.register(fake('run', 'run'));
    r.register(fake('agent', 'agent'));
    expect(r.select({ id: 's', agent: './a.md' }).name).toBe('agent');
  });

  it('throws when no step type matches', () => {
    const r = new StepRegistry();
    expect(() => r.select({ id: 's' } as any)).toThrow(/no step type/i);
  });
});
