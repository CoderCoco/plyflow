import { describe, it, expect } from 'vitest';
import { StepRegistry } from './registry.js';
import type { StepType } from './types.js';

const fake = (name: string, key: string): StepType => ({
  name,
  match: (def) => (def as any)[key] !== undefined,
  parse: (def) => def,
  run: async () => ({ output: null }),
});

// Custom step type matching via step: <name> (as plugin loader wraps them)
const fakeCustom = (name: string): StepType => ({
  name,
  match: (def) => def.step === name,
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

  it('FIX5: unknown step: ghost lists registered custom steps (echo) but not built-ins, derived dynamically', () => {
    const r = new StepRegistry();
    // Register built-in types using their own match predicates (not via step:)
    r.register(fake('run', 'run'));
    r.register(fake('agent', 'agent'));
    // Register a custom 'echo' plugin step (wrapped by loader: match via step: echo)
    r.register(fakeCustom('echo'));

    // Attempt to select an unknown step: ghost
    expect(() => r.select({ id: 'g', step: 'ghost' })).toThrow(/echo/);
    // Built-in names should NOT appear in the hint
    expect(() => r.select({ id: 'g', step: 'ghost' })).not.toThrow(/\brun\b/);
  });

  it('FIX5: clone() produces an independent copy that can be extended without affecting the original', () => {
    const r = new StepRegistry();
    r.register(fakeCustom('echo'));
    const copy = r.clone();
    copy.register(fakeCustom('double'));

    // Original should only have echo
    expect((r as any).types.length).toBe(1);
    // Copy has both
    expect((copy as any).types.length).toBe(2);
  });
});
