export interface ParsedArgs {
  workflow: string;
  inputs: Record<string, string>;
  resume?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] !== 'run') throw new Error(`unknown command "${argv[0] ?? ''}"; expected: run`);
  const rest = argv.slice(1);
  const inputs: Record<string, string> = {};
  let workflow: string | undefined;
  let resume: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--input') {
      const pair = rest[++i] ?? '';
      const eq = pair.indexOf('=');
      if (eq === -1) throw new Error(`--input expects key=value, got "${pair}"`);
      inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === '--resume') {
      resume = rest[++i];
    } else if (!arg.startsWith('--')) {
      workflow = arg;
    }
  }

  if (!workflow) throw new Error('no workflow file given; usage: plyflow run <file.yaml>');
  return { workflow, inputs, resume };
}
