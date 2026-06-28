import { describe, it, expect } from 'vitest';
import { LineLogger } from './logger.js';

describe('LineLogger', () => {
  it('writes a line per engine event', () => {
    const lines: string[] = [];
    const log = new LineLogger((s) => lines.push(s));
    log.handle({ type: 'phase-start', phase: 'Compute' });
    log.handle({ type: 'step-done', stepId: 'double', output: 1, cached: false });
    expect(lines[0]).toContain('Compute');
    expect(lines[1]).toContain('double');
    expect(lines[1]).toMatch(/done|✓/i);
  });
});
