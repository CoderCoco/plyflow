import { dirname } from 'node:path';
import { loadWorkflow } from './loader.js';
import { Journal } from './journal.js';
import { StepRegistry } from '../steps/registry.js';
import { runStep } from '../steps/run.js';
import { agentStep } from '../steps/agent.js';
import { inputStep } from '../steps/input.js';
import { makeParallelStep } from '../steps/parallel.js';
import { makeLoopStep } from '../steps/loop.js';
import { makeForeachStep } from '../steps/foreach.js';
import type { PromptRequest } from '../steps/types.js';
import type { AIProvider } from '../providers/types.js';
import { createRootScope, runSteps } from './exec.js';
import { createLoader, DEFAULT_PROVIDED } from './module-loader.js';

export type EngineEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'step-start'; stepId: string }
  | { type: 'step-done'; stepId: string; output: unknown; cached: boolean }
  | { type: 'step-error'; stepId: string; error: string }
  | { type: 'step-log'; stepId: string; message: string }
  | { type: 'step-skipped'; stepId: string };

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
  reg.register(makeLoopStep());
  reg.register(makeForeachStep());
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
  const loader = createLoader({ baseDir, provided: DEFAULT_PROVIDED });
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

  // Shared outputs and dirty set across all phases (cross-phase step references).
  const allOutputs: Record<string, unknown> = {};
  const dirty = new Set<string>();

  const prompt = opts.prompt ?? ((stepId: string) => Promise.reject(new Error(`no prompt handler provided for step "${stepId}"`)));

  try {
    for (const phase of wf.phases) {
      emit({ type: 'phase-start', phase: phase.name });

      const scope = createRootScope({
        inputs,
        env: process.env,
        baseDir,
        provider: opts.provider,
        registry,
        journal,
        journalPath: `phase:${phase.name}`,
        dirty,
        loadModule: (path) => loader.import(path),
        emit,
        prompt,
      });

      // Seed scope with all previously accumulated outputs so that
      // cross-phase ${{ steps.x }} expressions resolve correctly.
      // Use inheritedSteps so the phase's own outputs map stays clean.
      Object.assign(scope.inheritedSteps,
        Object.fromEntries(
          Object.entries(allOutputs).map(([k, v]) => [k, { output: v }]),
        ),
      );

      await runSteps(phase.steps, scope);

      // Merge this phase's outputs back into the shared accumulator.
      Object.assign(allOutputs, scope.outputs);
    }
    await journal.setStatus('completed');
  } catch (err) {
    await journal.setStatus('failed');
    throw err;
  }

  return { runId: journal.runId, outputs: allOutputs };
}
