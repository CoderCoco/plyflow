import { resolve as resolveExpr, type ExprContext } from './expression.js';
import { planPhase } from './scheduler.js';
import { Journal, hashStep } from './journal.js';
import { StepRegistry } from '../steps/registry.js';
import type { StepContext, UiRequest } from '../steps/types.js';
import type { AIProvider } from '../providers/types.js';
import type { StepDef } from './types.js';
import type { EngineEvent } from './engine.js';
import { DEFAULT_PROVIDED } from './module-loader.js';
import type { Exec } from './workflow-env.js';

export interface ExecScope {
  inputs: Record<string, unknown>;
  env: Record<string, string | undefined>;
  baseDir: string;
  provider: AIProvider;
  registry: StepRegistry;
  /** Journal directory; forwarded to sub-workflow runs via use step. */
  runDir: string;
  /** Injectable exec for npm commands; forwarded to sub-workflow runs. */
  exec?: Exec;
  outputs: Record<string, unknown>;
  bindings: Record<string, unknown>;
  inheritedSteps: Record<string, { output: unknown }>;
  journal: Journal;
  journalPath: string;
  dirty: Set<string>;
  isTty: boolean;
  dryRun: boolean;
  useChain: string[];
  provided: string[];
  loadModule(path: string): Promise<unknown>;
  emit(e: EngineEvent): void;
  prompt(stepId: string, req: UiRequest): Promise<unknown>;
  runChildren(
    steps: StepDef[],
    extraBindings: Record<string, unknown>,
    subPath: string,
  ): Promise<Record<string, unknown>>;
}

export interface RootScopeOptions {
  inputs: Record<string, unknown>;
  env: Record<string, string | undefined>;
  baseDir: string;
  provider: AIProvider;
  registry: StepRegistry;
  /** Journal directory; forwarded to sub-workflow runs via use step. Defaults to '.plyflow/runs'. */
  runDir?: string;
  /** Injectable exec for npm commands; forwarded to sub-workflow runs. */
  exec?: Exec;
  journal: Journal;
  journalPath: string;
  dirty: Set<string>;
  isTty: boolean;
  dryRun?: boolean;
  useChain?: string[];
  provided?: string[];
  loadModule(path: string): Promise<unknown>;
  emit(e: EngineEvent): void;
  prompt(stepId: string, req: UiRequest): Promise<unknown>;
}

function makeRunChildren(
  parentScope: ExecScope,
): ExecScope['runChildren'] {
  return function runChildren(steps, extraBindings, subPath) {
    // Snapshot parent outputs as inheritedSteps at fan-out time so child
    // expressions can reference ancestor step outputs via ${{ steps.x.output }}.
    const inheritedSteps: Record<string, { output: unknown }> = {
      ...parentScope.inheritedSteps,
      ...Object.fromEntries(
        Object.entries(parentScope.outputs).map(([k, v]) => [k, { output: v }]),
      ),
    };
    // Build childScope without runChildren first to avoid referencing the variable
    // before it is initialised (TDZ error with const in object literal).
    const childScope: ExecScope = {
      inputs: parentScope.inputs,
      env: parentScope.env,
      baseDir: parentScope.baseDir,
      provider: parentScope.provider,
      registry: parentScope.registry,
      runDir: parentScope.runDir,
      exec: parentScope.exec,
      outputs: {},
      bindings: { ...parentScope.bindings, ...extraBindings },
      inheritedSteps,
      journal: parentScope.journal,
      journalPath: `${parentScope.journalPath}/${subPath}`,
      dirty: parentScope.dirty,
      isTty: parentScope.isTty,
      dryRun: parentScope.dryRun,
      useChain: parentScope.useChain,
      provided: parentScope.provided,
      loadModule: parentScope.loadModule,
      emit: parentScope.emit,
      prompt: parentScope.prompt,
      runChildren: null!, // set immediately below
    };
    // Now that childScope is initialised, wire up runChildren to close over it.
    childScope.runChildren = makeRunChildren(childScope);
    return runSteps(steps, childScope);
  };
}

export function createRootScope(opts: RootScopeOptions): ExecScope {
  const scope: ExecScope = {
    inputs: opts.inputs,
    env: opts.env,
    baseDir: opts.baseDir,
    provider: opts.provider,
    registry: opts.registry,
    runDir: opts.runDir ?? '.plyflow/runs',
    exec: opts.exec,
    outputs: {},
    bindings: {},
    inheritedSteps: {},
    journal: opts.journal,
    journalPath: opts.journalPath,
    dirty: opts.dirty,
    isTty: opts.isTty,
    dryRun: opts.dryRun ?? false,
    useChain: opts.useChain ?? [],
    provided: opts.provided ?? DEFAULT_PROVIDED,
    loadModule: opts.loadModule,
    emit: opts.emit,
    prompt: opts.prompt,
    runChildren: null!, // set below after scope is constructed
  };
  scope.runChildren = makeRunChildren(scope);
  return scope;
}

export async function runSteps(
  steps: StepDef[],
  scope: ExecScope,
): Promise<Record<string, unknown>> {
  const syntheticPhase = { name: scope.journalPath, steps };
  const waves = planPhase(syntheticPhase);

  const exprCtx = (): ExprContext => ({
    inputs: scope.inputs,
    // Merge inherited ancestor step outputs first, then own outputs so own steps
    // win on collision.  The child's returned outputs map is scope.outputs only.
    steps: {
      ...scope.inheritedSteps,
      ...Object.fromEntries(
        Object.entries(scope.outputs).map(([k, v]) => [k, { output: v }]),
      ),
    },
    env: scope.env,
    bindings: scope.bindings,
  });

  for (const wave of waves) {
    await Promise.all(wave.map((step) => runOneStep(step)));
  }

  return scope.outputs;

  async function runOneStep(step: StepDef): Promise<void> {
    const instanceId = `${scope.journalPath}/${step.id}`;
    const parentId = scope.journalPath;
    const type = scope.registry.select(step);
    const kind = type.name as import('./engine.js').StepKind;

    // Evaluate the optional `if:` guard. If present and resolves falsy, skip.
    if (step.if !== undefined) {
      const guard = resolveExpr(step.if, exprCtx());
      if (!guard) {
        scope.outputs[step.id] = null;
        scope.emit({ type: 'step-skipped', stepId: step.id, instanceId });
        return;
      }
    }

    const ctx = exprCtx();
    const resolvedWith = resolveExpr(step.with ?? {}, ctx) as Record<string, unknown>;
    const resolvedPrompt = step.prompt ? (resolveExpr(step.prompt, ctx) as string) : undefined;
    const resolvedModel = step.model ? (resolveExpr(step.model, ctx) as string) : undefined;
    const resolvedMode = step.mode ? (resolveExpr(step.mode, ctx) as string) : undefined;
    const resolvedParams = step.params
      ? (resolveExpr(step.params, ctx) as Record<string, unknown>)
      : undefined;
    const hash = hashStep({
      id: step.id,
      type: type.name,
      inputs: scope.inputs,
      with: resolvedWith,
      prompt: resolvedPrompt,
      run: step.run,
      uses: step.uses,
      agent: step.agent,
      input: step.input,
      parallel: step.parallel,
      loop: step.loop,
      steps: step.steps,
      output: step.output,
      sh: step.sh,
      cwd: step.cwd,
      env: step.env,
      json: step.json,
      use: step.use,
    });

    const journalKey = instanceId;
    const cached = scope.journal.get(journalKey);
    const upstreamDirty = (step.needs ?? []).some((n) =>
      scope.dirty.has(`${scope.journalPath}/${n}`),
    );
    if (cached && cached.status === 'completed' && cached.hash === hash && !upstreamDirty) {
      scope.outputs[step.id] = cached.output;
      scope.emit({ type: 'step-done', stepId: step.id, instanceId, output: cached.output, cached: true });
      return;
    }
    scope.dirty.add(journalKey);

    scope.emit({ type: 'step-start', stepId: step.id, instanceId, parentId, kind });
    const startedAt = Date.now();
    const stepCtx: StepContext = {
      inputs: scope.inputs,
      env: scope.env,
      steps: {
        ...scope.inheritedSteps,
        ...Object.fromEntries(
          Object.entries(scope.outputs).map(([k, v]) => [k, { output: v }]),
        ),
      },
      with: resolvedWith,
      bindings: scope.bindings,
      provider: scope.provider,
      registry: scope.registry,
      baseDir: scope.baseDir,
      runDir: scope.runDir,
      exec: scope.exec,
      isTty: scope.isTty,
      dryRun: scope.dryRun,
      useChain: scope.useChain,
      provided: scope.provided,
      loadModule: scope.loadModule,
      resolve: (value: unknown) => resolveExpr(value, exprCtx()),
      emit: (ev) => {
        if (ev.type === 'log') {
          scope.emit({ type: 'step-log', stepId: step.id, instanceId, message: ev.message });
        } else if (ev.type === 'output') {
          scope.emit({ type: 'agent-stream', stepId: step.id, instanceId, chunk: ev.chunk });
        }
      },
      prompt: (req) => scope.prompt(step.id, req),
      runChildren: scope.runChildren,
    };
    const effectiveDef: StepDef = {
      ...step,
      prompt: resolvedPrompt,
      model: resolvedModel,
      mode: resolvedMode,
      params: resolvedParams,
    };

    try {
      const res = await runWithRetry(type, effectiveDef, stepCtx, step.retry?.max ?? 0, step.retry?.backoff ?? 0);
      scope.outputs[step.id] = res.output;
      await scope.journal.record({
        stepId: journalKey,
        hash,
        output: res.output,
        status: 'completed',
        startedAt,
        endedAt: Date.now(),
      });
      scope.emit({ type: 'step-done', stepId: step.id, instanceId, output: res.output, cached: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await scope.journal.record({
        stepId: journalKey,
        hash,
        output: null,
        status: 'failed',
        startedAt,
        endedAt: Date.now(),
      });
      scope.emit({ type: 'step-error', stepId: step.id, instanceId, error: message });
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
