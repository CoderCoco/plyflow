import type { StepDef, InputStepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';

interface InputStepConfig {
  def: InputStepDef;
  stepId: string;
  defaultValue: unknown;
  hasDefault: boolean;
}

export const inputStep: StepType<InputStepConfig> = {
  name: 'input',
  match: (def: StepDef) => def.input !== undefined,
  parse: (def: StepDef): InputStepConfig => ({
    def: def.input!,
    stepId: def.id,
    defaultValue: def.default,
    hasDefault: 'default' in def,
  }),
  run: async (cfg: InputStepConfig, ctx: StepContext): Promise<StepResult> => {
    if (!ctx.isTty) {
      if (cfg.hasDefault) {
        return { output: cfg.defaultValue };
      }
      throw new Error(
        `interactive input "${cfg.stepId}" requires a TTY or a default: value`,
      );
    }
    const answer = await ctx.prompt({
      kind: 'prompt',
      type: cfg.def.type,
      message: cfg.def.message,
      choices: cfg.def.choices,
    });
    return { output: answer };
  },
};
