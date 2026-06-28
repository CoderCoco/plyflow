import { loadWorkflow } from './loader.js';
import { Journal } from './journal.js';
import { StepRegistry } from '../steps/registry.js';
import { runStep } from '../steps/run.js';
import { agentStep } from '../steps/agent.js';
import { inputStep } from '../steps/input.js';
import { widgetStep } from '../steps/widget.js';
import { makeParallelStep } from '../steps/parallel.js';
import { makeLoopStep } from '../steps/loop.js';
import { makeForeachStep } from '../steps/foreach.js';
import type { UiRequest } from '../steps/types.js';
import type { AIProvider } from '../providers/types.js';
import { createRootScope, runSteps } from './exec.js';
import { createLoader } from './module-loader.js';
import { prepareEnv, type Exec } from './workflow-env.js';
import { loadPlugins } from './plugins.js';

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
  prompt?: (stepId: string, req: UiRequest) => Promise<unknown>;
  /** Override TTY detection; defaults to !!process.stdout.isTTY. Useful for tests. */
  isTty?: boolean;
  /** Run side-effecting steps (sh, …) in dry-run mode. Defaults to false. */
  dryRun?: boolean;
  /** Injectable exec for running npm commands in prepareEnv; defaults to real npm. Useful for tests. */
  exec?: Exec;
}

export function buildDefaultRegistry(): StepRegistry {
  const reg = new StepRegistry();
  reg.register(runStep);
  reg.register(agentStep);
  reg.register(inputStep);
  reg.register(widgetStep);
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
  const emit = (e: EngineEvent) => opts.onEvent?.(e);

  // Prepare the workflow environment: resolve dir, provided modules, plugins.
  // For workflows without a package.json (the common case) this is a no-op that
  // returns defaults immediately.  When a package.json is present with missing
  // deps, npm ci/install runs (or the injected opts.exec in tests).
  const env = await prepareEnv(workflowPath, {
    exec: opts.exec,
    onLog: (msg) => emit({ type: 'step-log', stepId: '__env__', message: msg }),
  });

  const wf = await loadWorkflow(workflowPath);
  // Clone the caller-provided registry so plugin registrations are isolated
  // per run and don't mutate the caller's shared registry.  If no registry
  // was provided, buildDefaultRegistry() already returns a fresh instance.
  const registry = opts.registry ? opts.registry.clone() : buildDefaultRegistry();
  // Build the loader from the env-resolved dir + provided set (merges
  // DEFAULT_PROVIDED with any plyflow.provided entries from package.json).
  const loader = createLoader({ baseDir: env.dir, provided: env.provided });

  // Resolve plugin paths to absolute before deduplication so that
  // './echo-plugin.ts' and 'echo-plugin.ts' (both relative to env.dir)
  // collapse to the same entry and the file is only loaded once.
  const { resolve: pathResolve } = await import('node:path');
  const pluginPaths = Array.from(
    new Set(
      [...env.plugins, ...(wf.plugins ?? [])].map((p) => pathResolve(env.dir, p)),
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
        journal,
        journalPath: `phase:${phase.name}`,
        dirty,
        isTty,
        dryRun: opts.dryRun ?? false,
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
    await journal.setStatus('completed');
  } catch (err) {
    await journal.setStatus('failed');
    throw err;
  }

  return { runId: journal.runId, outputs: allOutputs };
}
