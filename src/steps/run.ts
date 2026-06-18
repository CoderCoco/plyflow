import { resolve as resolvePath } from 'node:path';
import { createJiti } from 'jiti';
import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';

const jiti = createJiti(import.meta.url);

interface RunCfg {
  module?: string; // path to load
  source?: string; // inline body
}

function isPath(v: string): boolean {
  return v.endsWith('.ts') || v.endsWith('.js') || v.startsWith('./') || v.startsWith('../');
}

async function callModule(absPath: string, input: unknown, ctx: StepContext): Promise<unknown> {
  const mod = (await jiti.import(absPath)) as { default?: unknown };
  if (typeof mod.default !== 'function') {
    throw new Error(`module ${absPath} must "export default" a function`);
  }
  return (mod.default as (i: unknown, c: StepContext) => unknown)(input, ctx);
}

export const runStep: StepType<RunCfg> = {
  name: 'run',
  match: (def: StepDef) => def.run !== undefined || def.uses !== undefined,
  parse: (def: StepDef): RunCfg => {
    if (def.uses !== undefined) return { module: def.uses };
    const run = def.run!;
    return isPath(run) ? { module: run } : { source: run };
  },
  run: async (cfg: RunCfg, ctx: StepContext): Promise<StepResult> => {
    if (cfg.module) {
      const abs = resolvePath(ctx.baseDir, cfg.module);
      return { output: await callModule(abs, ctx.with, ctx) };
    }
    const fn = new Function('input', 'ctx', `"use strict"; return (async () => { ${cfg.source} })();`);
    return { output: await fn(ctx.with, ctx) };
  },
};
