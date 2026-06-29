import type { ShellExec } from '@plyflow/core';

/**
 * A fake ShellExec for `sh` steps: matches a rule key as a substring of the
 * command and returns its scripted `{ stdout, stderr, code }` (defaults '', '', 0).
 * Throws on an unmatched command so tests can't silently run real shell.
 */
export function mockExec(
  rules: Record<string, { stdout?: string; stderr?: string; code?: number }>,
): ShellExec {
  return async (command: string) => {
    for (const [key, r] of Object.entries(rules)) {
      if (command.includes(key)) {
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 };
      }
    }
    throw new Error(`no mockExec rule matched the command: ${command}`);
  };
}
