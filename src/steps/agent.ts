import { resolve as resolvePath } from 'node:path';
import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';
import { loadAgent } from '../core/loader.js';
import { loadSchema } from '../schema/load.js';

interface AgentCfg {
  agentPath: string;
  prompt: string;
  outputPath?: string;
  model?: string;
  mode?: string;
  params?: Record<string, unknown>;
}

export const agentStep: StepType<AgentCfg> = {
  name: 'agent',
  match: (def: StepDef) => def.agent !== undefined,
  parse: (def: StepDef): AgentCfg => ({
    agentPath: def.agent!,
    prompt: def.prompt ?? '',
    outputPath: def.output,
    model: def.model,
    mode: def.mode,
    params: def.params,
  }),
  run: async (cfg: AgentCfg, ctx: StepContext): Promise<StepResult> => {
    const agent = await loadAgent(resolvePath(ctx.baseDir, cfg.agentPath));
    const schema = cfg.outputPath ? await loadSchema(cfg.outputPath, ctx.baseDir) : undefined;
    const result = await ctx.provider.complete({
      system: agent.systemPrompt,
      prompt: cfg.prompt,
      model: cfg.model ?? agent.config.model,
      mode: cfg.mode ?? agent.config.mode,
      params: {
        temperature: agent.config.temperature,
        ...cfg.params,
      },
      outputSchema: schema?.jsonSchema,
    });
    if (schema) {
      return { output: schema.validate(result.structured) };
    }
    return { output: result.text ?? '' };
  },
};
