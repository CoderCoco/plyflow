import path from 'node:path';
import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';

interface WidgetStepConfig {
  module: string;
  stepId: string;
  hasDefault: boolean;
  defaultValue: unknown;
}

export const widgetStep: StepType<WidgetStepConfig> = {
  name: 'widget',
  match: (def: StepDef): boolean => def.widget !== undefined,
  parse: (def: StepDef): WidgetStepConfig => ({
    module: def.widget!,
    stepId: def.id,
    hasDefault: 'default' in def,
    defaultValue: def.default,
  }),
  run: async (cfg: WidgetStepConfig, ctx: StepContext): Promise<StepResult> => {
    if (!ctx.isTty) {
      if (cfg.hasDefault) {
        return { output: cfg.defaultValue };
      }
      throw new Error(
        `widget "${cfg.stepId}" requires a TTY or a default: value`,
      );
    }
    const absModule = path.resolve(ctx.baseDir, cfg.module);
    const resolved = await ctx.prompt({
      kind: 'widget',
      module: absModule,
      baseDir: ctx.baseDir,
      props: ctx.with,
    });
    return { output: resolved };
  },
};
