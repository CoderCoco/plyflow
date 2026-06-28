import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadWorkflow, loadAgent } from './loader.js';

const fx = (n: string) => fileURLToPath(new URL(`./__fixtures__/${n}`, import.meta.url));

describe('loadWorkflow', () => {
  it('parses a YAML workflow file', async () => {
    const wf = await loadWorkflow(fx('wf.yaml'));
    expect(wf.name).toBe('demo');
    expect(wf.phases[0]!.steps[0]!.id).toBe('s');
  });
});

describe('loadAgent', () => {
  it('parses frontmatter config and body as system prompt', async () => {
    const a = await loadAgent(fx('agent.md'));
    expect(a.config.model).toBe('claude-opus-4-8');
    expect(a.config.mode).toBe('api');
    expect(a.systemPrompt.trim()).toBe('You are a helpful agent.');
  });
});
