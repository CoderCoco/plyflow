import { z } from 'zod';
import type { WorkflowFile, AgentConfig } from './types.js';

const inputDef = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const inputStepDef = z.object({
  type: z.enum(['confirm', 'text', 'select']),
  message: z.string(),
  choices: z.array(z.string()).optional(),
});

const stepDef: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      needs: z.array(z.string()).optional(),
      with: z.record(z.string(), z.unknown()).optional(),
      output: z.string().optional(),
      retry: z.object({ max: z.number().int().positive(), backoff: z.number().optional() }).optional(),
      continueOnError: z.boolean().optional(),
      run: z.string().optional(),
      uses: z.string().optional(),
      agent: z.string().optional(),
      prompt: z.string().optional(),
      input: inputStepDef.optional(),
      parallel: z.array(stepDef).optional(),
    })
    .refine(
      (s) => ['run', 'uses', 'agent', 'input', 'parallel'].filter((k) => s[k] !== undefined).length === 1,
      { message: 'a step must have exactly one type key: run | uses | agent | input | parallel' },
    ),
);

const workflowSchema = z.object({
  name: z.string().min(1),
  inputs: z.record(z.string(), inputDef).optional(),
  phases: z
    .array(z.object({ name: z.string().min(1), steps: z.array(stepDef).min(1) }))
    .min(1),
});

export function parseWorkflow(raw: unknown): WorkflowFile {
  return workflowSchema.parse(raw) as WorkflowFile;
}

const agentConfigSchema = z
  .object({
    model: z.string().min(1),
    provider: z.string().default('claude'),
    mode: z.enum(['api', 'agent-sdk', 'cli']).default('api'),
    temperature: z.number().optional(),
  })
  .passthrough();

export function parseAgentConfig(raw: unknown): AgentConfig {
  return agentConfigSchema.parse(raw) as AgentConfig;
}
