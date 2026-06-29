/**
 * Build shell command strings for core's `ShellExec` (runs via
 * `spawn(cmd, { shell: true })`). Quote each argument so titles, bodies, and
 * GraphQL queries containing spaces/newlines/metacharacters survive intact.
 */
const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shQuote(arg: string): string {
  if (arg.length > 0 && SAFE.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function shJoin(parts: string[]): string {
  return parts.map(shQuote).join(' ');
}
