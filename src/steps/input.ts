import type { StepDef, InputStepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';

export const inputStep: StepType<InputStepDef> = {
  name: 'input',
  match: (def: StepDef) => def.input !== undefined,
  parse: (def: StepDef): InputStepDef => def.input!,
  run: async (cfg: InputStepDef, ctx: StepContext): Promise<StepResult> => {
    const answer = await ctx.prompt({ type: cfg.type, message: cfg.message, choices: cfg.choices });
    return { output: answer };
  },
};
