import { resolve as resolveExpr } from '../core/expression.js';
import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';

interface LoopCfg {
  stepId: string;
  maxIterations: number;
  until?: string;
  steps: StepDef[];
}

export function makeLoopStep(): StepType<LoopCfg> {
  return {
    name: 'loop',

    match: (def: StepDef) => def.loop !== undefined,

    parse: (def: StepDef): LoopCfg => ({
      stepId: def.id,
      maxIterations: def.loop!.maxIterations,
      until: def.loop!.until,
      steps: def.steps ?? [],
    }),

    run: async (cfg: LoopCfg, ctx: StepContext): Promise<StepResult> => {
      if (!ctx.runChildren) {
        throw new Error(
          'loop step requires runChildren on StepContext; make sure the step is invoked through the engine',
        );
      }

      let lastOutputs: Record<string, unknown> = {};

      for (let i = 0; i < cfg.maxIterations; i++) {
        lastOutputs = await ctx.runChildren(cfg.steps, { iteration: i }, `${cfg.stepId}/loop:${i}`);

        if (cfg.until !== undefined) {
          // Build an expression context: merge ancestor steps (ctx.steps) with
          // this iteration's own outputs so the `until` expression can reference
          // both e.g. `steps.before.output` and `steps.tick.output`.
          const iterationSteps = Object.fromEntries(
            Object.entries(lastOutputs).map(([k, v]) => [k, { output: v }]),
          );
          const exprCtx = {
            inputs: ctx.inputs,
            env: ctx.env,
            steps: { ...ctx.steps, ...iterationSteps },
            bindings: { ...(ctx.bindings ?? {}), iteration: i },
          };
          const stop = resolveExpr(cfg.until, exprCtx);
          if (stop) break;
        }
      }

      return { output: lastOutputs };
    },
  };
}
