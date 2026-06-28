import { spawn } from 'node:child_process';

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ShellExec {
  (
    command: string,
    opts?: { cwd?: string; env?: Record<string, string | undefined> },
  ): Promise<ShellResult>;
}

/**
 * Run a command line through the system shell, capturing stdout/stderr and the
 * exit code. Never rejects on a non-zero exit — the caller (the `sh` step)
 * decides whether a non-zero code is an error, so retry/continueOnError stay
 * uniform with other steps. Rejects only if the process cannot be spawned.
 */
export const defaultShellExec: ShellExec = (command, opts = {}) =>
  new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ stdout, stderr, code: code ?? (signal ? 1 : 0) });
    });
  });
