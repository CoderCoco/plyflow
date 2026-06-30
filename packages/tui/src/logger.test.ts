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

  it('renders agent-stream chunks as instance-prefixed lines', () => {
    const lines: string[] = [];
    const logger = new LineLogger((l) => lines.push(l));
    logger.handle({ type: 'agent-stream', stepId: 'implement', instanceId: 'phase:Build/build/foreach:a/implement', chunk: { t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' } });
    logger.handle({ type: 'agent-stream', stepId: 'implement', instanceId: 'phase:Build/build/foreach:a/implement', chunk: { t: 'result', tokens: 1240 } });
    expect(lines).toEqual([
      '  Build/build/foreach:a/implement › Edit scheduler.ts',
      '  Build/build/foreach:a/implement ✓ done (1240 tok)',
    ]);
  });
});
