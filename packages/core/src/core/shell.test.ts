import { describe, it, expect } from 'vitest';
import { defaultShellExec } from './shell.js';

describe('defaultShellExec', () => {
  it('captures stdout and a zero exit code', async () => {
    const r = await defaultShellExec(`node -e "process.stdout.write('hello')"`);
    expect(r.stdout).toBe('hello');
    expect(r.code).toBe(0);
  });

  it('returns (does not throw) a non-zero exit code with stderr', async () => {
    const r = await defaultShellExec(`node -e "process.stderr.write('boom'); process.exit(3)"`);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('boom');
  });

  it('runs in the given cwd and passes env', async () => {
    const r = await defaultShellExec(`node -e "process.stdout.write(process.env.FOO || '')"`, {
      env: { ...process.env, FOO: 'bar' },
    });
    expect(r.stdout).toBe('bar');
  });
});
