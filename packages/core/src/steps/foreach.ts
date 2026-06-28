import { resolve as resolveExpr } from '../core/expression.js';
import { planWaves } from '../core/dag.js';
import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';

interface ForeachCfg {
  stepId: string;
  foreach: string;
  as: string;
  key?: string;
  dependsOn?: string;
  concurrency?: number;
  steps: StepDef[];
}

/**
 * Run at most `concurrency` promises from `tasks` concurrently.
 * If concurrency is undefined/0, all tasks run together (unlimited).
 */
async function promisePool(
  tasks: Array<() => Promise<void>>,
  concurrency: number | undefined,
): Promise<void> {
  if (!concurrency || concurrency <= 0) {
    await Promise.all(tasks.map((t) => t()));
    return;
  }

  const iter = tasks[Symbol.iterator]();

  async function worker(): Promise<void> {
    for (;;) {
      const { value: task, done: iterDone } = iter.next();
      if (iterDone) return;
      await task();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
}

export function makeForeachStep(): StepType<ForeachCfg> {
  return {
    name: 'foreach',

    match: (def: StepDef) => def.foreach !== undefined,

    parse: (def: StepDef): ForeachCfg => ({
      stepId: def.id,
      foreach: def.foreach!,
      as: def.as ?? 'item',
      key: def.key,
      dependsOn: def.dependsOn,
      concurrency: def.concurrency,
      steps: def.steps ?? [],
    }),

    run: async (cfg: ForeachCfg, ctx: StepContext): Promise<StepResult> => {
      if (!ctx.runChildren) {
        throw new Error(
          'foreach step requires runChildren on StepContext; make sure the step is invoked through the engine',
        );
      }

      // Build base expression context from the outer scope.
      const baseExprCtx = {
        inputs: ctx.inputs,
        env: ctx.env,
        steps: ctx.steps,
        bindings: ctx.bindings ?? {},
      };

      // 1. Resolve the array.
      const array = resolveExpr(cfg.foreach, baseExprCtx);
      if (!Array.isArray(array)) {
        throw new Error(
          `foreach: expression "${cfg.foreach}" must resolve to an array, got ${typeof array}`,
        );
      }

      // 2. For each element, compute key and dependsOn using item-scoped bindings.
      type ElementMeta = { key: string; element: unknown; needs: string[] };
      const metas: ElementMeta[] = array.map((element, i) => {
        const itemCtx = { ...baseExprCtx, bindings: { ...baseExprCtx.bindings, [cfg.as]: element } };

        const key = cfg.key !== undefined ? String(resolveExpr(cfg.key, itemCtx)) : String(i);

        const rawNeeds =
          cfg.dependsOn !== undefined ? resolveExpr(cfg.dependsOn, itemCtx) : [];
        if (!Array.isArray(rawNeeds)) {
          throw new Error(
            `foreach: dependsOn expression must resolve to an array for element ${key}`,
          );
        }
        const needs: string[] = rawNeeds.map(String);

        return { key, element, needs };
      });

      // 2b. Detect duplicate keys before building the DAG.
      const seenKeys = new Set<string>();
      for (const m of metas) {
        if (seenKeys.has(m.key)) {
          throw new Error(`foreach: duplicate element key "${m.key}"`);
        }
        seenKeys.add(m.key);
      }

      // 3. Build DAG over elements and topo-sort into waves.
      //    planWaves throws /unknown/i on bad refs, /cycle/i on cycles.
      const dagNodes = metas.map((m) => ({ id: m.key, needs: m.needs }));
      const waveIds = planWaves(dagNodes);

      const metaByKey = new Map(metas.map((m) => [m.key, m]));

      // 4. Run waves in order, elements within each wave concurrently (capped).
      const results = new Map<string, Record<string, unknown>>();

      for (const wave of waveIds) {
        const tasks = wave.map((key) => async () => {
          const meta = metaByKey.get(key)!;
          // Sanitize '/' in the key so it does not create ambiguous nested journal paths.
          // The output map still uses the original key.
          const safeKey = String(key).replaceAll('/', '%2F');
          const childOutputs = await ctx.runChildren!(
            cfg.steps,
            { [cfg.as]: meta.element },
            `${cfg.stepId}/foreach:${safeKey}`,
          );
          results.set(key, childOutputs);
        });
        await promisePool(tasks, cfg.concurrency);
      }

      // 5. Build output map: key → child step output map.
      const output: Record<string, Record<string, unknown>> = {};
      for (const [key, childOutputs] of results) {
        output[key] = childOutputs;
      }

      return { output };
    },
  };
}
