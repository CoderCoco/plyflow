import { describe, it, expect } from 'vitest';
import { planWaves } from './dag.js';

describe('planWaves', () => {
  it('returns a single wave for independent nodes', () => {
    const waves = planWaves([
      { id: 'a', needs: [] },
      { id: 'b', needs: [] },
    ]);
    expect(waves).toEqual([['a', 'b']]);
  });

  it('orders dependent nodes into successive waves', () => {
    const waves = planWaves([
      { id: 'a', needs: [] },
      { id: 'b', needs: ['a'] },
    ]);
    expect(waves).toEqual([['a'], ['b']]);
  });

  it('throws /unknown/i on missing dependency', () => {
    expect(() =>
      planWaves([{ id: 'a', needs: ['ghost'] }]),
    ).toThrow(/unknown/i);
  });

  it('throws /cycle/i on a dependency cycle', () => {
    expect(() =>
      planWaves([
        { id: 'a', needs: ['b'] },
        { id: 'b', needs: ['a'] },
      ]),
    ).toThrow(/cycle/i);
  });

  it('cycle error lists only cyclic nodes, not independent ones', () => {
    // 'solo' has no deps and resolves in wave 1.
    // 'x' and 'y' form a cycle and remain unresolved.
    let caughtErr: Error | undefined;
    try {
      planWaves([
        { id: 'solo', needs: [] },
        { id: 'x', needs: ['y'] },
        { id: 'y', needs: ['x'] },
      ]);
    } catch (e) {
      caughtErr = e instanceof Error ? e : new Error(String(e));
    }
    expect(caughtErr).toBeDefined();
    expect(caughtErr!.message).toMatch(/cycle/i);
    // Must list the cyclic node ids
    expect(caughtErr!.message).toContain('x');
    expect(caughtErr!.message).toContain('y');
    // Must NOT list the independent node that resolved cleanly
    expect(caughtErr!.message).not.toContain('solo');
  });
});
