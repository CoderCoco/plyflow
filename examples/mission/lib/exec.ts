import { execFile as _execFile } from 'node:child_process';

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultExec: Exec = (cmd, args, opts) =>
  new Promise((resolve) => {
    _execFile(cmd, args, { cwd: opts?.cwd }, (err, stdout, stderr) => {
      const code = err?.code != null ? (err.code as number) : (err ? 1 : 0);
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code });
    });
  });
