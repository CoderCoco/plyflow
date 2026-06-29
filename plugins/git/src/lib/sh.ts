/**
 * Build shell command strings for the core `ShellExec` primitive, which runs
 * its argument through `spawn(cmd, { shell: true })`. Each argument is quoted
 * so values containing spaces, newlines, or shell metacharacters survive.
 */
const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shQuote(arg: string): string {
  if (arg.length > 0 && SAFE.test(arg)) return arg;
  // Wrap in single quotes; escape any embedded single quote as '\''.
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function shJoin(parts: string[]): string {
  return parts.map(shQuote).join(' ');
}
