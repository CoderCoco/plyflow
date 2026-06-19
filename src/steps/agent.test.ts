import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { agentStep } from './agent.js';
import { FakeProvider } from '../providers/fake.js';
import { createLoader } from '../core/module-loader.js';
import type { StepContext } from './types.js';

const baseDir = dirname(fileURLToPath(new URL('./__fixtures__/x', import.meta.url)));
const loader = createLoader({ baseDir });
const ctx = (provider: any, over: Partial<StepContext> = {}): StepContext => ({
  inputs: {}, env: {}, steps: {}, with: {}, provider, baseDir,
  isTty: true,
  emit: () => {}, prompt: async () => undefined,
  loadModule: loader.import.bind(loader), ...over,
});

describe('agentStep', () => {
  it('sends the system prompt and returns validated structured output', async () => {
    const provider = new FakeProvider([{ structured: { title: 'T' } }]);
    const cfg = agentStep.parse({ id: 's', agent: './sum-agent.md', prompt: 'do it', output: './Sum.ts' });
    const res = await agentStep.run(cfg, ctx(provider));
    expect(provider.calls[0]!.system).toBe('You summarize.');
    expect(provider.calls[0]!.outputSchema).toHaveProperty('properties.title');
    expect(res.output).toEqual({ title: 'T' });
  });

  it('returns text when no output schema is set', async () => {
    const provider = new FakeProvider([{ text: 'plain summary' }]);
    const cfg = agentStep.parse({ id: 's', agent: './sum-agent.md', prompt: 'do it' });
    const res = await agentStep.run(cfg, ctx(provider));
    expect(res.output).toBe('plain summary');
  });
});
