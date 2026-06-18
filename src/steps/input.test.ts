import { describe, it, expect } from 'vitest';
import { inputStep } from './input.js';
import type { StepContext, PromptRequest } from './types.js';

describe('inputStep', () => {
  it('forwards the prompt request and returns the answer', async () => {
    let seen: PromptRequest | undefined;
    const ctx = {
      inputs: {}, env: {}, steps: {}, with: {}, provider: {} as any, baseDir: '.',
      emit: () => {}, prompt: async (r: PromptRequest) => { seen = r; return true; },
    } as StepContext;
    const cfg = inputStep.parse({ id: 's', input: { type: 'confirm', message: 'ok?' } });
    const res = await inputStep.run(cfg, ctx);
    expect(seen?.message).toBe('ok?');
    expect(res.output).toBe(true);
  });
});
