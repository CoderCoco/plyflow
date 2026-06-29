import type { ShellExec } from '@plyflow/core';

/**
 * A fake ShellExec: matches a rule key as a substring of the command and
 * returns its scripted `{ stdout, stderr, code }` (defaults '', '', 0). Accepts
 * both command forms — a shell string or an argv array; an array is joined with
 * spaces before matching, so the same rule keys work regardless of form.
 * Throws on an unmatched command so tests can't silently run real shell.
 */
export function mockExec(
  rules: Record<string, { stdout?: string; stderr?: string; code?: number }>,
): ShellExec {
  return async (command: string | string[]) => {
    const flat = Array.isArray(command) ? command.join(' ') : command;
    for (const [key, r] of Object.entries(rules)) {
      if (flat.includes(key)) {
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 };
      }
    }
    throw new Error(`no mockExec rule matched the command: ${flat}`);
  };
}
