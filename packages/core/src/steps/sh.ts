import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';
import { defaultShellExec, type ShellExec, type ShellResult } from '../core/shell.js';

interface ShCfg {
  command: string;
  json: boolean;
  cwd?: string;
  env?: Record<string, string>;
  dryRun?: { stdout?: string; stderr?: string; code?: number };
}

function resolveStr(ctx: StepContext, v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return ctx.resolve ? (ctx.resolve(v) as string) : v;
}

export function makeShStep(exec: ShellExec = defaultShellExec): StepType<ShCfg> {
  return {
    name: 'sh',
    match: (def: StepDef) => def.sh !== undefined,
    parse: (def: StepDef): ShCfg => ({
      command: def.sh!,
      json: def.json ?? false,
      cwd: def.cwd,
      env: def.env,
      dryRun: def.dryRun,
    }),
    run: async (cfg: ShCfg, ctx: StepContext): Promise<StepResult> => {
      const build = (r: ShellResult): StepResult => {
        const output: { stdout: string; stderr: string; code: number; json?: unknown } = {
          stdout: r.stdout,
          stderr: r.stderr,
          code: r.code,
        };
        if (cfg.json && r.stdout.trim() !== '') output.json = JSON.parse(r.stdout);
        return { output };
      };

      if (ctx.dryRun) {
        const d = cfg.dryRun ?? {};
        return build({ stdout: d.stdout ?? '', stderr: d.stderr ?? '', code: d.code ?? 0 });
      }

      const command = resolveStr(ctx, cfg.command)!;
      const cwd = resolveStr(ctx, cfg.cwd);
      let resolvedEnv: Record<string, string> | undefined = cfg.env;
      if (resolvedEnv && ctx.resolve) {
        resolvedEnv = Object.fromEntries(Object.entries(resolvedEnv).map(([k, v]) => [k, ctx.resolve!(v) as string]));
      }
      const ctxEnv = Object.fromEntries(
        Object.entries(ctx.env).filter((e): e is [string, string] => e[1] !== undefined),
      );
      const hasEnv = Object.keys(ctxEnv).length > 0 || (resolvedEnv !== undefined && Object.keys(resolvedEnv).length > 0);
      const env: Record<string, string> | undefined = hasEnv
        ? { ...ctxEnv, ...resolvedEnv }
        : undefined;

      const r = await exec(command, { cwd, env });
      if (r.code !== 0) {
        throw new Error(`sh command failed (code ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
      }
      return build(r);
    },
  };
}
