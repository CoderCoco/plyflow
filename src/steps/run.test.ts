import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runStep } from './run.js';
import type { StepContext } from './types.js';

const baseDir = dirname(fileURLToPath(new URL('./__fixtures__/x', import.meta.url)));
const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  inputs: {}, env: {}, steps: {}, with: {}, provider: {} as any, baseDir,
  emit: () => {}, prompt: async () => undefined, ...over,
});

describe('runStep', () => {
  it('runs inline code returning an output', async () => {
    const cfg = runStep.parse({ id: 's', run: 'return { v: 1 + 1 };' });
    const res = await runStep.run(cfg, ctx());
    expect(res.output).toEqual({ v: 2 });
  });

  it('loads and runs an external module via jiti', async () => {
    const cfg = runStep.parse({ id: 's', uses: './double.ts' });
    const res = await runStep.run(cfg, ctx({ with: { n: 21 } }));
    expect(res.output).toEqual({ doubled: 42 });
  });
});
