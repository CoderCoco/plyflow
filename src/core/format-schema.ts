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
      id: z.string().min(1).refine((v) => !v.includes('/'), { message: "step id must not contain '/'" }),
      needs: z.array(z.string()).optional(),
      with: z.record(z.string(), z.unknown()).optional(),
      output: z.string().optional(),
      retry: z.object({ max: z.number().int().positive(), backoff: z.number().optional() }).optional(),
      continueOnError: z.boolean().optional(),
      'if': z.string().optional(),
      run: z.string().optional(),
      uses: z.string().optional(),
      agent: z.string().optional(),
      prompt: z.string().optional(),
      input: inputStepDef.optional(),
      parallel: z.array(stepDef).optional(),
      loop: z
        .object({ maxIterations: z.number().int().positive(), until: z.string().optional() })
        .optional(),
      foreach: z.string().optional(),
      as: z.string().optional(),
      key: z.string().optional(),
      dependsOn: z.string().optional(),
      concurrency: z.number().int().positive().optional(),
      steps: z.array(stepDef).optional(),
      model: z.string().optional(),
      mode: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
    })
    .refine(
      (s) =>
        ['run', 'uses', 'agent', 'input', 'parallel', 'loop', 'foreach'].filter(
          (k) => s[k] !== undefined,
        ).length === 1,
      {
        message:
          'a step must have exactly one type key: run | uses | agent | input | parallel | loop | foreach',
      },
    )
    .superRefine((s, ctx) => {
      // Composite step types that orchestrate child steps must provide a non-empty steps array.
      const compositesRequiringSteps: string[] = ['loop', 'foreach'];
      for (const key of compositesRequiringSteps) {
        if (s[key] !== undefined && (!Array.isArray(s['steps']) || s['steps'].length === 0)) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps'],
            message: `a step with '${key}' must have a non-empty 'steps' array`,
          });
        }
      }

      // Reject bare if/until — must be ${{ }} expressions to avoid always-truthy bugs.
      const requiresExpr = (val: unknown, field: string) => {
        if (typeof val === 'string' && !val.includes('${{')) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `if/until must be a \${{ }} expression (got bare string: "${val}")`,
          });
        }
      };
      requiresExpr(s['if'], 'if');
      if (s.loop && typeof s.loop === 'object' && 'until' in s.loop) {
        requiresExpr((s.loop as { until?: unknown }).until, 'loop.until');
      }
    }),
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
