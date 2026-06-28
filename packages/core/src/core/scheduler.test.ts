import { describe, it, expect } from 'vitest';
import { planPhase } from './scheduler.js';
import type { Phase } from './types.js';

describe('planPhase', () => {
  it('groups independent steps into one wave', () => {
    const phase: Phase = { name: 'P', steps: [{ id: 'a', run: 'x' }, { id: 'b', run: 'y' }] };
    const waves = planPhase(phase);
    expect(waves.map((w) => w.map((s) => s.id))).toEqual([['a', 'b']]);
  });

  it('orders dependent steps into successive waves', () => {
    const phase: Phase = {
      name: 'P',
      steps: [{ id: 'a', run: 'x' }, { id: 'b', needs: ['a'], run: 'y' }],
    };
    const waves = planPhase(phase);
    expect(waves.map((w) => w.map((s) => s.id))).toEqual([['a'], ['b']]);
  });

  it('throws on an unknown needs target', () => {
    const phase: Phase = { name: 'P', steps: [{ id: 'a', needs: ['ghost'], run: 'x' }] };
    expect(() => planPhase(phase)).toThrow(/unknown/i);
  });

  it('throws on a dependency cycle', () => {
    const phase: Phase = {
      name: 'P',
      steps: [{ id: 'a', needs: ['b'], run: 'x' }, { id: 'b', needs: ['a'], run: 'y' }],
    };
    expect(() => planPhase(phase)).toThrow(/cycle/i);
  });
});
