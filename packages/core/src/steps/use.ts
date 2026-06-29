import { resolve as resolvePath } from 'node:path';
import type { StepDef } from '../core/types.js';
import type { RunOptions } from '../core/engine.js';
import type { StepType, StepContext, StepResult } from './types.js';

type RunWorkflowFn = (
  path: string,
  opts: RunOptions,
) => Promise<{ runId: string; outputs: Record<string, unknown>; declaredOutputs: Record<string, unknown> }>;

interface UseCfg {
  path: string;
}

export function makeUseStep(run: RunWorkflowFn): StepType<UseCfg> {
  return {
    name: 'use',
    match: (def: StepDef) => def.use !== undefined,
    parse: (def: StepDef): UseCfg => ({ path: def.use! }),
    run: async (cfg: UseCfg, ctx: StepContext): Promise<StepResult> => {
      const childAbs = resolvePath(ctx.baseDir, cfg.path);
      const chain = ctx.useChain ?? [];
      if (chain.includes(childAbs)) {
        throw new Error(`sub-workflow cycle detected: ${childAbs} is already in the call chain`);
      }
      const result = await run(childAbs, {
        provider: ctx.provider,
        registry: ctx.registry,
        runDir: ctx.runDir,
        exec: ctx.exec,
        // `with:` is already engine-resolved against the parent scope → child inputs.
        inputs: ctx.with,
        isTty: ctx.isTty,
        dryRun: ctx.dryRun,
        useChain: [...chain, childAbs],
        onEvent: (e) => {
          if (e.type === 'step-log') ctx.emit({ type: 'log', message: e.message });
        },
        prompt: (_stepId, req) => ctx.prompt(req),
      });
      return { output: result.declaredOutputs };
    },
  };
}
