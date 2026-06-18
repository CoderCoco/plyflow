import { describe, it, expect } from 'vitest';
import { parseWorkflow, parseAgentConfig } from './format-schema.js';

describe('parseWorkflow', () => {
  it('accepts a minimal valid workflow', () => {
    const wf = parseWorkflow({ name: 'demo', phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }] });
    expect(wf.name).toBe('demo');
  });

  it('rejects a workflow missing phases', () => {
    expect(() => parseWorkflow({ name: 'demo' })).toThrow();
  });

  it('rejects a step with no type key', () => {
    expect(() => parseWorkflow({ name: 'd', phases: [{ name: 'P', steps: [{ id: 's' }] }] })).toThrow();
  });
});

describe('parseAgentConfig', () => {
  it('defaults provider and mode', () => {
    const cfg = parseAgentConfig({ model: 'claude-opus-4-8' });
    expect(cfg.provider).toBe('claude');
    expect(cfg.mode).toBe('api');
  });
});
