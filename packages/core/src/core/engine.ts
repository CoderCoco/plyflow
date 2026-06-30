import { loadWorkflow } from './loader.js';
import { Journal } from './journal.js';
import { resolve as resolveExpr } from './expression.js';
import { StepRegistry } from '../steps/registry.js';
import { runStep } from '../steps/run.js';
import { agentStep } from '../steps/agent.js';
import { inputStep } from '../steps/input.js';
import { widgetStep } from '../steps/widget.js';
import { makeParallelStep } from '../steps/parallel.js';
import { makeLoopStep } from '../steps/loop.js';
import { makeForeachStep } from '../steps/foreach.js';
import { makeShStep } from '../steps/sh.js';
import { makeUseStep } from '../steps/use.js';
import type { UiRequest } from '../steps/types.js';
import type { AIProvider } from '../providers/types.js';
import { createRootScope, runSteps } from './exec.js';
import { createLoader } from './module-loader.js';
import { prepareEnv, type Exec } from './workflow-env.js';
import { loadPlugins } from './plugins.js';
import { resolvePluginRef } from './plugin-ref.js';
import type { ShellExec } from './shell.js';

// Known core step kinds; plugin steps (e.g. 'git.worktree') carry arbitrary
// names, so the union stays open via `(string & {})` to accept any `type.name`
// without a cast error while keeping editor autocomplete for the common kinds.
export type StepKind =
  | 'agent' | 'sh' | 'run' | 'input' | 'widget'
  | 'parallel' | 'loop' | 'foreach' | 'use'
  | (string & {});

export type AgentChunk =
  | { t: 'tool_use'; name: string; summary: string }
  | { t: 'tool_result'; ok: boolean; summary: string }
  | { t: 'assistant'; text: string }
  | { t: 'thinking'; text: string }
  | { t: 'result'; tokens?: number }
  | { t: 'raw'; text: string };

export type EngineEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'step-start'; stepId: string; instanceId: string; parentId: string | null; kind: StepKind }
  | { type: 'step-done'; stepId: string; instanceId: string; output: unknown; cached: boolean }
  | { type: 'step-error'; stepId: string; instanceId: string; error: string }
  | { type: 'step-log'; stepId: string; instanceId: string; message: string }
  | { type: 'step-skipped'; stepId: string; instanceId: string }
  | { type: 'agent-stream'; stepId: string; instanceId: string; chunk: AgentChunk };

export interface RunOptions {
  inputs?: Record<string, unknown>;
  runId?: string;
  runDir?: string;
  provider: AIProvider;
  registry?: StepRegistry;
  onEvent?: (e: EngineEvent) => void;
  prompt?: (stepId: string, req: UiRequest) => Promise<unknown>;
  /** Override TTY detection; defaults to !!process.stdout.isTTY. Useful for tests. */
  isTty?: boolean;
  /** Run side-effecting steps (sh, …) in dry-run mode. Defaults to false. */
  dryRun?: boolean;
  /** Internal: ancestor sub-workflow paths for cycle detection. */
  useChain?: string[];
  /** Injectable exec for running npm commands in prepareEnv; defaults to real npm. Useful for tests. */
  exec?: Exec;
  /** Injectable shell exec for `sh` steps; defaults to the real shell. Useful for tests. */
  shellExec?: ShellExec;
}

export function buildDefaultRegistry(shellExec?: ShellExec): StepRegistry {
  const reg = new StepRegistry();
  reg.register(runStep);
  reg.register(agentStep);
  reg.register(inputStep);
  reg.register(widgetStep);
  reg.register(makeParallelStep(reg));
  reg.register(makeLoopStep());
  reg.register(makeForeachStep());
  reg.register(makeShStep(shellExec));
  reg.register(makeUseStep(runWorkflow));
  return reg;
}

function randomRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function runWorkflow(
  workflowPath: string,
  opts: RunOptions,
): Promise<{ runId: string; outputs: Record<string, unknown>; declaredOutputs: Record<string, unknown> }> {
  const emit = (e: EngineEvent) => opts.onEvent?.(e);

  // Prepare the workflow environment: resolve dir, provided modules, plugins.
  // For workflows without a package.json (the common case) this is a no-op that
  // returns defaults immediately.  When a package.json is present with missing
  // deps, npm ci/install runs (or the injected opts.exec in tests).
  const env = await prepareEnv(workflowPath, {
    exec: opts.exec,
    onLog: (msg) => emit({ type: 'step-log', stepId: '__env__', instanceId: '__env__', message: msg }),
  });

  const wf = await loadWorkflow(workflowPath);
  // Clone the caller-provided registry so plugin registrations are isolated
  // per run and don't mutate the caller's shared registry.  If no registry
  // was provided, buildDefaultRegistry() already returns a fresh instance.
  const registry = opts.registry ? opts.registry.clone() : buildDefaultRegistry(opts.shellExec);
  // Build the loader from the env-resolved dir + provided set (merges
  // DEFAULT_PROVIDED with any plyflow.provided entries from package.json).
  const loader = createLoader({ baseDir: env.dir, provided: env.provided });

  // Resolve plugin paths before deduplication: relative refs become absolute
  // (so './echo-plugin.ts' and 'echo-plugin.ts' collapse to the same entry),
  // bare package specifiers pass through unchanged for the module loader to resolve.
  const pluginPaths = Array.from(
    new Set(
      [...env.plugins, ...(wf.plugins ?? [])].map((p) => resolvePluginRef(env.dir, p)),
    ),
  );

  const runDir = opts.runDir ?? '.plyflow/runs';

  const inputs: Record<string, unknown> = { ...(opts.inputs ?? {}) };
  for (const [key, def] of Object.entries(wf.inputs ?? {})) {
    if (inputs[key] === undefined) {
      if (def.default !== undefined) inputs[key] = def.default;
      else if (def.required) throw new Error(`missing required input "${key}"`);
    }
  }

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
  let declaredOutputs: Record<string, unknown> = {};

  const prompt = opts.prompt ?? ((stepId: string) => Promise.reject(new Error(`no prompt handler provided for step "${stepId}"`)));
  const isTty = opts.isTty !== undefined ? opts.isTty : !!process.stdout.isTTY;

  try {
    // Load plugins inside the try/catch so a plugin-load failure marks the
    // journal as failed (consistent with all other run failures) and the
    // error/result carries the runId.
    if (pluginPaths.length > 0) {
      await loadPlugins(pluginPaths, registry, (p) => loader.import(p));
    }

    for (const phase of wf.phases) {
      emit({ type: 'phase-start', phase: phase.name });

      const scope = createRootScope({
        inputs,
        env: process.env,
        baseDir: env.dir,
        provider: opts.provider,
        registry,
        runDir,
        exec: opts.exec,
        journal,
        journalPath: `phase:${phase.name}`,
        dirty,
        isTty,
        dryRun: opts.dryRun ?? false,
        useChain: opts.useChain ?? [],
        provided: env.provided,
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
    if (wf.outputs) {
      const stepsCtx = Object.fromEntries(
        Object.entries(allOutputs).map(([k, v]) => [k, { output: v }]),
      );
      declaredOutputs = Object.fromEntries(
        Object.entries(wf.outputs).map(([k, expr]) => [
          k,
          resolveExpr(expr, { inputs, steps: stepsCtx, env: process.env, bindings: {} }),
        ]),
      );
    }
    await journal.setStatus('completed');
  } catch (err) {
    await journal.setStatus('failed');
    throw err;
  }

  return { runId: journal.runId, outputs: allOutputs, declaredOutputs };
}
