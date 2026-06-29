import { spawn } from 'node:child_process';

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ShellExec {
  (
    command: string | string[],
    opts?: { cwd?: string; env?: Record<string, string | undefined> },
  ): Promise<ShellResult>;
}

/**
 * Run a command, capturing stdout/stderr and the exit code.
 *
 * Accepts two command forms:
 *   - a **string** — run through the system shell (`shell: true`); use this for
 *     arbitrary shell command lines (the `sh` step's pipes, redirects, etc.).
 *   - an **argv array** `[cmd, ...args]` — spawned directly with NO shell, so
 *     arguments need no quoting and cannot be reinterpreted by the shell. Use
 *     this for fixed commands with user-supplied arguments (e.g. the git/github
 *     plugin packs), which is both safer and portable across platforms.
 *
 * Never rejects on a non-zero exit — the caller decides whether a non-zero code
 * is an error, so retry/continueOnError stay uniform across steps. Rejects only
 * if the process cannot be spawned.
 */
export const defaultShellExec: ShellExec = (command, opts = {}) => {
  const [cmd, args, useShell] = Array.isArray(command)
    ? [command[0]!, command.slice(1), false]
    : [command, [] as string[], true];
  return new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: useShell,
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
};
