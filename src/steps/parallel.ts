import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';
import type { StepRegistry } from './registry.js';

export function makeParallelStep(registry: StepRegistry): StepType<StepDef[]> {
  return {
    name: 'parallel',
    match: (def: StepDef) => def.parallel !== undefined,
    parse: (def: StepDef): StepDef[] => def.parallel!,
    run: async (children: StepDef[], ctx: StepContext): Promise<StepResult> => {
      const results = await Promise.all(
        children.map(async (child) => {
          const type = registry.select(child);
          const childCtx: StepContext = { ...ctx, with: child.with ?? {} };
          const res = await type.run(type.parse(child), childCtx);
          return [child.id, res.output] as const;
        }),
      );
      return { output: Object.fromEntries(results) };
    },
  };
}
