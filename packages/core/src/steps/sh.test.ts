import { describe, it, expect, vi } from 'vitest';
import { makeShStep } from './sh.js';
import type { ShellExec, ShellResult } from '../core/shell.js';
import type { StepContext } from './types.js';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {}, env: {}, steps: {}, with: {}, bindings: {},
    provider: {} as never, baseDir: '/wf', isTty: false, dryRun: false, provided: [],
    resolve: (v) => v, // identity resolver for tests
    emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    ...over,
  } as StepContext;
}

const mkExec = (impl: (cmd: string, opts?: unknown) => ShellResult): ShellExec =>
  vi.fn(async (cmd, opts) => impl(cmd, opts));

describe('makeShStep', () => {
  it('runs the command and returns stdout/stderr/code', async () => {
    const step = makeShStep(mkExec(() => ({ stdout: 'hi', stderr: '', code: 0 })));
    const res = await step.run(step.parse({ id: 's', sh: 'echo hi' }), ctx());
    expect(res.output).toEqual({ stdout: 'hi', stderr: '', code: 0 });
  });

  it('parses JSON stdout when json:true', async () => {
    const step = makeShStep(mkExec(() => ({ stdout: '{"a":1}', stderr: '', code: 0 })));
    const res = await step.run(step.parse({ id: 's', sh: 'x', json: true }), ctx());
    expect((res.output as { json: unknown }).json).toEqual({ a: 1 });
  });

  it('throws on a non-zero exit code (message includes code + stderr)', async () => {
    const step = makeShStep(mkExec(() => ({ stdout: '', stderr: 'nope', code: 2 })));
    await expect(step.run(step.parse({ id: 's', sh: 'x' }), ctx())).rejects.toThrow(/2.*nope|nope.*2/);
  });

  it('passes cwd and env to the exec', async () => {
    const exec = mkExec(() => ({ stdout: '', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    await step.run(step.parse({ id: 's', sh: 'x', cwd: '/work', env: { A: 'b' } }), ctx());
    expect(exec).toHaveBeenCalledWith('x', { cwd: '/work', env: { A: 'b' } });
  });

  it('resolves ${{ }} in command/cwd/env via ctx.resolve', async () => {
    const exec = mkExec(() => ({ stdout: '', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    const resolve = (v: unknown) => (v === '${{ inputs.c }}' ? 'real-cmd' : v);
    await step.run(step.parse({ id: 's', sh: '${{ inputs.c }}' }), ctx({ resolve }));
    expect(exec).toHaveBeenCalledWith('real-cmd', { cwd: undefined, env: undefined });
  });

  it('under dryRun returns the declared result without calling exec', async () => {
    const exec = mkExec(() => ({ stdout: 'SHOULD NOT RUN', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    const res = await step.run(
      step.parse({ id: 's', sh: 'x', dryRun: { stdout: 'mocked', code: 0 } }),
      ctx({ dryRun: true }),
    );
    expect(exec).not.toHaveBeenCalled();
    expect(res.output).toEqual({ stdout: 'mocked', stderr: '', code: 0 });
  });

  it('under dryRun with no declared result no-ops to empty success', async () => {
    const exec = mkExec(() => ({ stdout: 'x', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    const res = await step.run(step.parse({ id: 's', sh: 'x' }), ctx({ dryRun: true }));
    expect(exec).not.toHaveBeenCalled();
    expect(res.output).toEqual({ stdout: '', stderr: '', code: 0 });
  });
});
