import { dirname } from 'node:path';
import { loadWorkflow } from './loader.js';
import { resolve as resolveExpr, type ExprContext } from './expression.js';
import { planPhase } from './scheduler.js';
import { Journal, hashStep } from './journal.js';
import { StepRegistry } from '../steps/registry.js';
import { runStep } from '../steps/run.js';
import { agentStep } from '../steps/agent.js';
import { inputStep } from '../steps/input.js';
import { makeParallelStep } from '../steps/parallel.js';
import type { StepContext, PromptRequest } from '../steps/types.js';
import type { AIProvider } from '../providers/types.js';
import type { StepDef } from './types.js';

export type EngineEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'step-start'; stepId: string }
  | { type: 'step-done'; stepId: string; output: unknown; cached: boolean }
  | { type: 'step-error'; stepId: string; error: string }
  | { type: 'step-log'; stepId: string; message: string };

export interface RunOptions {
  inputs?: Record<string, unknown>;
  runId?: string;
  runDir?: string;
  provider: AIProvider;
  registry?: StepRegistry;
  onEvent?: (e: EngineEvent) => void;
  prompt?: (stepId: string, req: PromptRequest) => Promise<unknown>;
}

export function buildDefaultRegistry(): StepRegistry {
  const reg = new StepRegistry();
  reg.register(runStep);
  reg.register(agentStep);
  reg.register(inputStep);
  reg.register(makeParallelStep(reg));
  return reg;
}

function randomRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function runWorkflow(
  workflowPath: string,
  opts: RunOptions,
): Promise<{ runId: string; outputs: Record<string, unknown> }> {
  const wf = await loadWorkflow(workflowPath);
  const baseDir = dirname(workflowPath);
  const registry = opts.registry ?? buildDefaultRegistry();
  const runDir = opts.runDir ?? '.plyflow/runs';

  const inputs: Record<string, unknown> = { ...(opts.inputs ?? {}) };
  for (const [key, def] of Object.entries(wf.inputs ?? {})) {
    if (inputs[key] === undefined) {
      if (def.default !== undefined) inputs[key] = def.default;
      else if (def.required) throw new Error(`missing required input "${key}"`);
    }
  }

  const emit = (e: EngineEvent) => opts.onEvent?.(e);

  let journal: Journal;
  if (opts.runId) {
    journal = await Journal.load(runDir, opts.runId).catch(() =>
      Journal.create(runDir, opts.runId!, wf.name, inputs),
    );
  } else {
    journal = Journal.create(runDir, randomRunId(), wf.name, inputs);
  }

  const outputs: Record<string, unknown> = {};
  const dirty = new Set<string>();
  const exprCtx = (): ExprContext => ({
    inputs,
    steps: Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, { output: v }])),
    env: process.env,
  });

  try {
    for (const phase of wf.phases) {
      emit({ type: 'phase-start', phase: phase.name });
      for (const wave of planPhase(phase)) {
        await Promise.all(wave.map((step) => runOneStep(step)));
      }
    }
    await journal.setStatus('completed');
  } catch (err) {
    await journal.setStatus('failed');
    throw err;
  }

  return { runId: journal.runId, outputs };

  async function runOneStep(step: StepDef): Promise<void> {
    const type = registry.select(step);
    const resolvedWith = resolveExpr(step.with ?? {}, exprCtx()) as Record<string, unknown>;
    const resolvedPrompt = step.prompt ? (resolveExpr(step.prompt, exprCtx()) as string) : undefined;
    const hash = hashStep({
      id: step.id,
      type: type.name,
      inputs,
      with: resolvedWith,
      prompt: resolvedPrompt,
      run: step.run,
      uses: step.uses,
      agent: step.agent,
      input: step.input,
      parallel: step.parallel,
      output: step.output,
    });

    const cached = journal.get(step.id);
    const upstreamDirty = (step.needs ?? []).some((n) => dirty.has(n));
    if (cached && cached.status === 'completed' && cached.hash === hash && !upstreamDirty) {
      outputs[step.id] = cached.output;
      emit({ type: 'step-done', stepId: step.id, output: cached.output, cached: true });
      return;
    }
    dirty.add(step.id);

    emit({ type: 'step-start', stepId: step.id });
    const startedAt = Date.now();
    const ctx: StepContext = {
      inputs,
      env: process.env,
      steps: Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, { output: v }])),
      with: resolvedWith,
      provider: opts.provider,
      baseDir,
      resolve: (value: unknown) => resolveExpr(value, exprCtx()),
      emit: (ev) => {
        if (ev.type === 'log') emit({ type: 'step-log', stepId: step.id, message: ev.message });
      },
      prompt: (req) =>
        opts.prompt ? opts.prompt(step.id, req) : Promise.reject(new Error('no prompt handler provided')),
    };
    // Inject resolved prompt for agent steps by shadowing def.prompt.
    const effectiveDef: StepDef = { ...step, prompt: resolvedPrompt };

    try {
      const res = await runWithRetry(type, effectiveDef, ctx, step.retry?.max ?? 0, step.retry?.backoff ?? 0);
      outputs[step.id] = res.output;
      await journal.record({
        stepId: step.id, hash, output: res.output, status: 'completed', startedAt, endedAt: Date.now(),
      });
      emit({ type: 'step-done', stepId: step.id, output: res.output, cached: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await journal.record({
        stepId: step.id, hash, output: null, status: 'failed', startedAt, endedAt: Date.now(),
      });
      emit({ type: 'step-error', stepId: step.id, error: message });
      if (!step.continueOnError) throw err;
    }
  }
}

async function runWithRetry(
  type: ReturnType<StepRegistry['select']>,
  def: StepDef,
  ctx: StepContext,
  max: number,
  backoff: number,
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await type.run(type.parse(def), ctx);
    } catch (err) {
      lastErr = err;
      if (attempt < max && backoff > 0) await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
