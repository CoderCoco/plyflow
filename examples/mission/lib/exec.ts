import { execFile as _execFile } from 'node:child_process';

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number }>;

const _realExec: Exec = (cmd, args, opts) =>
  new Promise((resolve) => {
    _execFile(cmd, args, { cwd: opts?.cwd }, (err, stdout, stderr) => {
      const code = err?.code != null ? (err.code as number) : (err ? 1 : 0);
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code });
    });
  });

/**
 * The default exec implementation.
 *
 * When `MISSION_DRYRUN=1` is set in the environment, every shell invocation
 * is skipped and a canned successful result is returned.  This lets the full
 * mission.yaml workflow run in CI without any real git/gh calls.  The real
 * behaviour is unchanged when the variable is absent.
 */
export const defaultExec: Exec = (cmd, args, opts) => {
  if (process.env.MISSION_DRYRUN === '1') {
    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
  }
  return _realExec(cmd, args, opts);
};
