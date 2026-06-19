import { describe, it, expect, vi } from 'vitest';
import { inputStep } from './input.js';
import type { StepContext, UiRequest } from './types.js';

function makeCtx(overrides: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {},
    env: {},
    steps: {},
    with: {},
    provider: {} as any,
    baseDir: '.',
    isTty: true,
    provided: ['zod', 'react', 'ink'],
    emit: () => {},
    prompt: async (_r: UiRequest) => true,
    loadModule: async (_path: string) => ({}),
    ...overrides,
  } as StepContext;
}

describe('inputStep', () => {
  it('forwards the prompt request and returns the answer (TTY)', async () => {
    let seen: UiRequest | undefined;
    const ctx = makeCtx({
      isTty: true,
      prompt: async (r: UiRequest) => { seen = r; return true; },
    });
    const cfg = inputStep.parse({ id: 's', input: { type: 'confirm', message: 'ok?' } });
    const res = await inputStep.run(cfg, ctx);
    expect(seen).toMatchObject({ kind: 'prompt', type: 'confirm', message: 'ok?' });
    expect(res.output).toBe(true);
  });

  it('returns default when non-TTY and default is provided', async () => {
    const promptSpy = vi.fn();
    const ctx = makeCtx({
      isTty: false,
      prompt: promptSpy,
    });
    const cfg = inputStep.parse({
      id: 's',
      input: { type: 'text', message: 'name?' },
      default: 'alice',
    });
    const res = await inputStep.run(cfg, ctx);
    expect(res.output).toBe('alice');
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('throws when non-TTY and no default is provided', async () => {
    const ctx = makeCtx({ isTty: false });
    const cfg = inputStep.parse({ id: 'myInput', input: { type: 'text', message: 'name?' } });
    await expect(inputStep.run(cfg, ctx)).rejects.toThrow(/TTY|default/);
  });

  it('calls ctx.prompt with kind:prompt when TTY', async () => {
    const promptSpy = vi.fn().mockResolvedValue('bob');
    const ctx = makeCtx({
      isTty: true,
      prompt: promptSpy,
    });
    const cfg = inputStep.parse({
      id: 's',
      input: { type: 'text', message: 'name?', choices: undefined },
    });
    const res = await inputStep.run(cfg, ctx);
    expect(promptSpy).toHaveBeenCalledWith({
      kind: 'prompt',
      type: 'text',
      message: 'name?',
      choices: undefined,
    });
    expect(res.output).toBe('bob');
  });
});
