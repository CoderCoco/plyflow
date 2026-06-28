import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);

// Resolve relative to this source file using import.meta (vitest sets this correctly)
// The test lives at packages/meta/src/bin.e2e.test.ts → go up two dirs to packages/meta/
const BIN_PATH = resolve(new URL('.', import.meta.url).pathname, '..', 'bin.js');

describe('plyflow meta bin', () => {
  it('executes the CLI via built dist (not a module-resolution error)', async () => {
    // This test deliberately does NOT pass --conditions=@plyflow/source so that
    // Node resolves @plyflow/cli via its "default" (dist) export condition.
    // Without `exports` in @plyflow/cli/package.json, Node falls back to
    // legacyMainResolve and throws ERR_MODULE_NOT_FOUND — this test catches that.
    const env = { ...process.env };
    // Strip @plyflow/source condition so we use the production (dist) path
    if (env.NODE_OPTIONS) {
      env.NODE_OPTIONS = env.NODE_OPTIONS.replace('--conditions=@plyflow/source', '').trim();
    }

    let stdout: string;
    let stderr: string;
    try {
      const result = await run('node', [BIN_PATH, 'run'], { env });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      stdout = execErr.stdout ?? '';
      stderr = execErr.stderr ?? '';
      const combined = stdout + stderr + (execErr.message ?? '');
      // A module-resolution error is the specific failure we guard against
      expect(combined, 'CLI should not throw a module-resolution error').not.toContain(
        'Cannot find package',
      );
      expect(combined, 'CLI should not throw ERR_MODULE_NOT_FOUND').not.toContain(
        'ERR_MODULE_NOT_FOUND',
      );
      // Non-zero exit for other CLI reasons (e.g. missing args) is acceptable
      return;
    }

    // If it exits zero, output must not be a Node.js resolution error
    const combined = stdout + stderr;
    expect(combined).not.toContain('Cannot find package');
    expect(combined).not.toContain('ERR_MODULE_NOT_FOUND');
  }, 30000);
});
