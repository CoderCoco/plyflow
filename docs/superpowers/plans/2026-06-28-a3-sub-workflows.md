# A3 — Callable Sub-Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one workflow call another as a step. A workflow file gains an optional top-level `outputs:` block; a new `use: ./sub.yaml` step runs that workflow (with `with:` as its inputs) and exposes only its declared `outputs:` to the caller as `steps.<id>.output`. This deletes the duplicated Setup phase shared by mission.yaml and comms.yaml.

**Architecture:** `runWorkflow` is reused wholesale to execute the child (so the child gets its own env/loader/plugins/input-validation for free); the engine just learns to (a) evaluate a workflow's `outputs:` block and return it as `declaredOutputs`, and (b) thread a `useChain` of ancestor sub-workflow paths for cycle detection. The `use:` step is a `makeUseStep(runWorkflow)` factory — `runWorkflow` is injected to break the steps↔engine import cycle, mirroring `makeShStep`. `with:` is already engine-resolved against the parent scope before the step runs, so it is passed verbatim as the child's inputs. Only the child's declared `outputs:` cross the boundary — internal child step outputs do not leak.

**Tech Stack:** TypeScript ESM (Node ≥24), Zod, vitest. pnpm monorepo; all A3 work is in `packages/core`.

## Global Constraints

- **Node ≥24, ESM.** Relative imports keep `.js` extensions. `node -v` must be v24.x (`source "$HOME/.nvm/nvm.sh" && nvm use 24.18.0` if it shows v20).
- **Test gate is vitest** (`pnpm --filter @plyflow/core test`), not tsc. CI runs `pnpm -r lint` with `no-unused-vars: error` — **no unused imports**.
- **TDD:** failing test first, watch fail, minimal impl, watch pass, commit.
- **Reuse `runWorkflow` for the child** — do NOT reimplement phase/scope execution inside the step. Inject `runWorkflow` into the step via a factory to avoid an import cycle.
- **Only declared `outputs:` are visible to the caller.** The step's output is the child's `declaredOutputs` object; the child's individual step outputs are not exposed.
- **Cycle detection is mandatory** (a workflow may not transitively `use:` itself) — infinite recursion otherwise.
- **Resume across the boundary is OUT OF SCOPE for A3.** The child runs as a fresh `runWorkflow` invocation each time the `use:` step executes (its own journal/runId). Document this; do not thread parent runId. (Cycle-safety and dry-run propagation are IN scope.)
- All work is in `packages/core`.

---

## File Structure

```
packages/core/src/
  core/
    types.ts            # MODIFY: WorkflowFile.outputs?; StepDef.use?
    format-schema.ts    # MODIFY: top-level outputs?; 'use' in step schema + exclusive-or
    engine.ts           # MODIFY: evaluate wf.outputs → declaredOutputs in return;
                        #         RunOptions.useChain?; pass useChain to root scope;
                        #         register makeUseStep(runWorkflow)
    exec.ts             # MODIFY: thread useChain through ExecScope/createRootScope/childScope/stepCtx
  steps/
    use.ts              # NEW: makeUseStep(runWorkflow) factory → StepType
    use.test.ts         # NEW
    types.ts            # MODIFY: StepContext gains useChain?: string[]
  index.ts              # MODIFY: export makeUseStep
```

**Interfaces produced (used across tasks):**

```ts
// core/types.ts
interface WorkflowFile { /* …existing… */ outputs?: Record<string, string>; }
interface StepDef { /* …existing… */ use?: string; }

// engine.ts — runWorkflow return gains declaredOutputs (back-compat: outputs unchanged)
function runWorkflow(path, opts): Promise<{ runId: string; outputs: Record<string, unknown>; declaredOutputs: Record<string, unknown> }>;
// RunOptions gains: useChain?: string[]   (internal; ancestor sub-workflow abs paths)

// StepContext (steps/types.ts) gains: useChain?: string[]

// steps/use.ts
type RunWorkflowFn = (path: string, opts: import('../core/engine.js').RunOptions)
  => Promise<{ runId: string; outputs: Record<string, unknown>; declaredOutputs: Record<string, unknown> }>;
export function makeUseStep(run: RunWorkflowFn): StepType<{ path: string }>;
```

---

## Task 1: Schema — top-level `outputs:` and the `use` step

**Files:**
- Modify: `packages/core/src/core/types.ts` (WorkflowFile.outputs, StepDef.use)
- Modify: `packages/core/src/core/format-schema.ts` (workflowSchema.outputs, stepDef.use + exclusive-or)
- Test: `packages/core/src/core/format-schema.test.ts`

**Interfaces:**
- Produces: a workflow with `outputs:` and a `use:` step parses; `use` joins the exactly-one-type-key rule.

- [ ] **Step 1: Write the failing tests** (append to `format-schema.test.ts`)

```ts
describe('sub-workflows schema', () => {
  it('accepts a top-level outputs block and a use step', () => {
    const wf = parseWorkflow({
      name: 'w',
      outputs: { path: '${{ steps.x.output }}' },
      phases: [{ name: 'p', steps: [{ id: 's', use: './sub.yaml', with: { a: 1 } }] }],
    });
    expect(wf.outputs!.path).toBe('${{ steps.x.output }}');
    expect(wf.phases[0]!.steps[0]!.use).toBe('./sub.yaml');
  });

  it('rejects a step with both use and run (exactly-one-type-key)', () => {
    expect(() =>
      parseWorkflow({
        name: 'w',
        phases: [{ name: 'p', steps: [{ id: 's', use: './sub.yaml', run: 'return 1' }] }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter @plyflow/core test -- format-schema`
Expected: FAIL (`outputs`/`use` stripped or `use` not in exclusive-or).

- [ ] **Step 3: Add the types** in `packages/core/src/core/types.ts`:
  - In `interface WorkflowFile`, add: `outputs?: Record<string, string>;`
  - In `interface StepDef`, add (near `step?`): `/** Path to a sub-workflow file to run (the \`use:\` step). */ use?: string;`

- [ ] **Step 4: Extend the schema** in `packages/core/src/core/format-schema.ts`:
  - Add `use: z.string().optional(),` to the step `z.object({ ... })` (next to `step:`).
  - Add `'use'` to the exclusive-or `.filter([...])` array AND the message string:
    ```ts
    return ['run', 'uses', 'agent', 'input', 'parallel', 'loop', 'foreach', 'widget', 'step', 'sh', 'use'].filter(
      (k) => r[k] !== undefined,
    ).length === 1;
    ```
    ```ts
    'a step must have exactly one type key: run | uses | agent | input | parallel | loop | foreach | widget | step | sh | use'
    ```
  - Add `outputs` to `workflowSchema`:
    ```ts
    const workflowSchema = z.object({
      name: z.string().min(1),
      inputs: z.record(z.string(), inputDef).optional(),
      outputs: z.record(z.string(), z.string()).optional(),
      phases: z.array(z.object({ name: z.string().min(1), steps: z.array(stepDef).min(1) })).min(1),
      plugins: z.array(z.string()).optional(),
    });
    ```

- [ ] **Step 5: Run, watch pass**

Run: `pnpm --filter @plyflow/core test -- format-schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core/types.ts packages/core/src/core/format-schema.ts packages/core/src/core/format-schema.test.ts
git commit -m "feat(core): schema for workflow outputs and the use step"
```

---

## Task 2: Evaluate `outputs:` and return `declaredOutputs`

**Files:**
- Modify: `packages/core/src/core/engine.ts` (evaluate `wf.outputs`; widen return type)
- Test: `packages/core/src/core/engine.test.ts` (add a case) or a new `packages/core/src/core/workflow-outputs.test.ts`

**Interfaces:**
- Consumes: `resolve` from `expression.js`.
- Produces: `runWorkflow(...)` returns `{ runId, outputs, declaredOutputs }`; `declaredOutputs` is `{}` when no `outputs:` block, else each expression evaluated against `{ inputs, steps: <all step outputs> }`.

- [ ] **Step 1: Write the failing test** — `packages/core/src/core/workflow-outputs.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('evaluates the outputs block and returns declaredOutputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-out-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(
    wf,
    [
      'name: w',
      'outputs:',
      '  doubled: ${{ steps.n.output }}',
      '  label: "v-${{ inputs.tag }}"',
      'inputs: { tag: { type: string } }',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: n',
      '        run: return 21 * 2',
    ].join('\n'),
  );
  const res = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false, inputs: { tag: 'x' } });
  expect(res.declaredOutputs).toEqual({ doubled: 42, label: 'v-x' });
});

it('declaredOutputs is {} when no outputs block is declared', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-noout-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        run: return 1\n');
  const res = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false });
  expect(res.declaredOutputs).toEqual({});
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter @plyflow/core test -- workflow-outputs`
Expected: FAIL (`declaredOutputs` undefined).

- [ ] **Step 3: Implement** in `packages/core/src/core/engine.ts`:
  - Add the import (if not already present): `import { resolve as resolveExpr } from './expression.js';`
  - Widen the return type of `runWorkflow` to `Promise<{ runId: string; outputs: Record<string, unknown>; declaredOutputs: Record<string, unknown> }>`.
  - After the phases loop and `await journal.setStatus('completed');`, before `return`, evaluate the outputs block:
    ```ts
    let declaredOutputs: Record<string, unknown> = {};
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
    ```
    (Place the `let declaredOutputs` declaration BEFORE the `try` block and assign inside, or compute after the try — but it must run only on success. Simplest: compute it right after `await journal.setStatus('completed');` inside the `try`, declaring the variable before the `try` so it's in scope for the `return`.)
  - Change the final `return { runId: journal.runId, outputs: allOutputs };` to `return { runId: journal.runId, outputs: allOutputs, declaredOutputs };`.

- [ ] **Step 4: Run, watch pass**

Run: `pnpm --filter @plyflow/core test -- workflow-outputs`
Expected: PASS.

- [ ] **Step 5: Full core suite (return-shape change must not break callers/tests)**

Run: `pnpm --filter @plyflow/core test && pnpm --filter @plyflow/core lint`
Expected: all pass; lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core/engine.ts packages/core/src/core/workflow-outputs.test.ts
git commit -m "feat(core): evaluate workflow outputs block, return declaredOutputs"
```

---

## Task 3: Thread `useChain` through the step context

**Files:**
- Modify: `packages/core/src/steps/types.ts` (StepContext.useChain)
- Modify: `packages/core/src/core/exec.ts` (ExecScope, RootScopeOptions, createRootScope, childScope, stepCtx)
- Modify: `packages/core/src/core/engine.ts` (RunOptions.useChain; pass to createRootScope)
- Test: `packages/core/src/steps/usechain-ctx.test.ts`

**Interfaces:**
- Produces: `StepContext.useChain?: string[]` (ancestor sub-workflow abs paths), settable via `runWorkflow(..., { useChain })`. Task 4's `use` step reads/extends it.

- [ ] **Step 1: Write the failing test** — `packages/core/src/steps/usechain-ctx.test.ts` (probe custom step records `ctx.useChain`)

```ts
import { it, expect } from 'vitest';
import { runWorkflow, buildDefaultRegistry } from '../core/engine.js';
import type { StepType } from './types.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function probeRegistry(seen: { chain?: string[] }) {
  const reg = buildDefaultRegistry();
  const probe: StepType = {
    name: 'probe',
    match: (d) => d.step === 'probe',
    parse: () => ({}),
    run: async (_c, ctx) => {
      seen.chain = ctx.useChain;
      return { output: ctx.useChain ?? [] };
    },
  };
  reg.register(probe);
  return reg;
}

it('exposes useChain on the step context (default empty; set when provided)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-uc-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        step: probe\n');

  const a: { chain?: string[] } = {};
  await runWorkflow(wf, { provider: new FakeProvider([]), registry: probeRegistry(a), isTty: false });
  expect(a.chain ?? []).toEqual([]);

  const b: { chain?: string[] } = {};
  await runWorkflow(wf, { provider: new FakeProvider([]), registry: probeRegistry(b), isTty: false, useChain: ['/p/a.yaml'] });
  expect(b.chain).toEqual(['/p/a.yaml']);
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter @plyflow/core test -- usechain-ctx`
Expected: FAIL.

- [ ] **Step 3: Add `useChain` to `StepContext`** in `packages/core/src/steps/types.ts` (after `dryRun`):
  ```ts
  /** Absolute paths of ancestor sub-workflows in the current call chain (cycle guard). */
  useChain?: string[];
  ```

- [ ] **Step 4: Thread it through `exec.ts`** (mirror `dryRun`): add `useChain: string[];` to `ExecScope`; `useChain?: string[];` to `RootScopeOptions`; in `createRootScope` set `useChain: opts.useChain ?? []`; in `makeRunChildren` childScope set `useChain: parentScope.useChain`; in the `stepCtx` literal add `useChain: scope.useChain`.

- [ ] **Step 5: Add to `RunOptions` and pass it** in `engine.ts`: add `/** Internal: ancestor sub-workflow paths for cycle detection. */ useChain?: string[];` to `RunOptions`; in the `createRootScope({ ... })` call add `useChain: opts.useChain ?? [],`.

- [ ] **Step 6: Run, watch pass; then full suite**

Run: `pnpm --filter @plyflow/core test -- usechain-ctx && pnpm --filter @plyflow/core test`
Expected: PASS; full suite green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/steps/types.ts packages/core/src/core/exec.ts packages/core/src/core/engine.ts packages/core/src/steps/usechain-ctx.test.ts
git commit -m "feat(core): thread useChain through the step context"
```

---

## Task 4: The `use` step (`makeUseStep`)

**Files:**
- Create: `packages/core/src/steps/use.ts`
- Test: `packages/core/src/steps/use.test.ts`
- Modify: `packages/core/src/core/engine.ts` (register `makeUseStep(runWorkflow)` in `buildDefaultRegistry`)

**Interfaces:**
- Consumes: injected `runWorkflow`, `ctx.with` (engine-resolved child inputs), `ctx.useChain`, `ctx.dryRun`, `ctx.provider`.
- Produces: `makeUseStep(run)` → `StepType`; output = child's `declaredOutputs`. Registered as a built-in.

- [ ] **Step 1: Write the failing tests** — `packages/core/src/steps/use.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow } from '../core/engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmp() { return mkdtempSync(join(tmpdir(), 'ply-use-')); }

describe('use step (sub-workflows)', () => {
  it('runs a child workflow and exposes only its declared outputs', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'child.yaml'),
      [
        'name: child',
        'inputs: { n: { type: number } }',
        'outputs: { total: "${{ steps.calc.output }}" }',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: calc',
        '        run: return ctx.inputs.n + 1',
        '      - id: secret',
        '        run: return "hidden"',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'parent.yaml'),
      [
        'name: parent',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: sub',
        '        use: ./child.yaml',
        '        with: { n: 41 }',
        '      - id: read',
        '        needs: [sub]',
        '        run: return ctx.steps.sub.output',
      ].join('\n'),
    );
    const res = await runWorkflow(join(dir, 'parent.yaml'), { provider: new FakeProvider([]), isTty: false });
    // Only declared outputs cross the boundary — `secret` is not present.
    expect(res.outputs.sub).toEqual({ total: 42 });
    expect(res.outputs.read).toEqual({ total: 42 });
  });

  it('detects a direct self-reference cycle', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'loop.yaml'),
      [
        'name: loop',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: again',
        '        use: ./loop.yaml',
      ].join('\n'),
    );
    await expect(
      runWorkflow(join(dir, 'loop.yaml'), { provider: new FakeProvider([]), isTty: false }),
    ).rejects.toThrow(/cycle/i);
  });

  it('propagates dry-run into the child', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'child.yaml'),
      [
        'name: child',
        'outputs: { out: "${{ steps.s.output.stdout }}" }',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: s',
        `        sh: node -e "process.exit(1)"`,
        `        dryRun: { stdout: "safe", code: 0 }`,
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'parent.yaml'),
      'name: parent\nphases:\n  - name: p\n    steps:\n      - id: sub\n        use: ./child.yaml\n',
    );
    const res = await runWorkflow(join(dir, 'parent.yaml'), { provider: new FakeProvider([]), isTty: false, dryRun: true });
    expect(res.outputs.sub).toEqual({ out: 'safe' });
  });
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter @plyflow/core test -- steps/use`
Expected: FAIL (`use` step not registered).

- [ ] **Step 3: Implement** `packages/core/src/steps/use.ts`

```ts
import { resolve as resolvePath } from 'node:path';
import type { StepDef } from '../core/types.js';
import type { RunOptions } from '../core/engine.js';
import type { StepType, StepContext, StepResult } from './types.js';

type RunWorkflowFn = (
  path: string,
  opts: RunOptions,
) => Promise<{ runId: string; outputs: Record<string, unknown>; declaredOutputs: Record<string, unknown> }>;

interface UseCfg {
  path: string;
}

export function makeUseStep(run: RunWorkflowFn): StepType<UseCfg> {
  return {
    name: 'use',
    match: (def: StepDef) => def.use !== undefined,
    parse: (def: StepDef): UseCfg => ({ path: def.use! }),
    run: async (cfg: UseCfg, ctx: StepContext): Promise<StepResult> => {
      const childAbs = resolvePath(ctx.baseDir, cfg.path);
      const chain = ctx.useChain ?? [];
      if (chain.includes(childAbs)) {
        throw new Error(`sub-workflow cycle detected: ${childAbs} is already in the call chain`);
      }
      const result = await run(childAbs, {
        provider: ctx.provider,
        // `with:` is already engine-resolved against the parent scope → child inputs.
        inputs: ctx.with,
        isTty: ctx.isTty,
        dryRun: ctx.dryRun,
        useChain: [...chain, childAbs],
        onEvent: (e) => {
          if (e.type === 'step-log') ctx.emit({ type: 'log', message: e.message });
        },
        prompt: (_stepId, req) => ctx.prompt(req),
      });
      return { output: result.declaredOutputs };
    },
  };
}
```

- [ ] **Step 4: Run, watch pass**

Run: `pnpm --filter @plyflow/core test -- steps/use`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the step** in `packages/core/src/core/engine.ts` `buildDefaultRegistry`:
  - Import: `import { makeUseStep } from '../steps/use.js';`
  - Register (alongside the others): `reg.register(makeUseStep(runWorkflow));`
  - Note: `runWorkflow` is a hoisted `function` declaration in this module, so referencing it inside `buildDefaultRegistry` is fine even though it is defined lower in the file.

- [ ] **Step 6: Full core suite + lint**

Run: `pnpm --filter @plyflow/core test && pnpm --filter @plyflow/core lint`
Expected: all pass; lint clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/steps/use.ts packages/core/src/steps/use.test.ts packages/core/src/core/engine.ts
git commit -m "feat(core): use step runs sub-workflows (cycle-guarded, dry-run aware)"
```

---

## Task 5: Barrel export, end-to-end, and docs

**Files:**
- Modify: `packages/core/src/index.ts` (export `makeUseStep`)
- Test: `packages/core/src/steps/use.e2e.test.ts` (a parent that shares a `setup.yaml` like mission/comms)
- Modify: `website/docs/steps/use.md` (new), `website/docs/steps/overview.md`, `website/sidebars.ts`, `AGENTS.md`

**Interfaces:**
- Produces: public `makeUseStep` export; a mission-shaped end-to-end proof.

- [ ] **Step 1: Write the failing e2e test** — `packages/core/src/steps/use.e2e.test.ts`

```ts
import { it, expect } from 'vitest';
import { runWorkflow } from '../core/engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('two workflows share one setup sub-workflow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-share-'));
  writeFileSync(
    join(dir, 'setup.yaml'),
    [
      'name: setup',
      'inputs: { issue: { type: string, required: true } }',
      'outputs: { branch: "${{ steps.b.output }}" }',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: b',
      '        run: return "issue-" + ctx.inputs.issue',
    ].join('\n'),
  );
  const mk = (name: string) =>
    writeFileSync(
      join(dir, `${name}.yaml`),
      [
        `name: ${name}`,
        'inputs: { issue: { type: string, required: true } }',
        'phases:',
        '  - name: p',
        '    steps:',
        '      - id: setup',
        '        use: ./setup.yaml',
        '        with: { issue: "${{ inputs.issue }}" }',
        '      - id: use',
        '        needs: [setup]',
        '        run: return ctx.steps.setup.output.branch',
      ].join('\n'),
    );
  mk('mission');
  mk('comms');
  for (const name of ['mission', 'comms']) {
    const res = await runWorkflow(join(dir, `${name}.yaml`), { provider: new FakeProvider([]), isTty: false, inputs: { issue: '7' } });
    expect(res.outputs.use).toBe('issue-7');
  }
});
```

- [ ] **Step 2: Run, watch pass (or adjust)**

Run: `pnpm --filter @plyflow/core test -- use.e2e`
Expected: PASS. If the inline `run:` access pattern differs, fix the expression against `steps/run.ts` before locking.

- [ ] **Step 3: Barrel export** in `packages/core/src/index.ts`:

```ts
// Sub-workflow step (use:) — factory for custom registries / testing
export { makeUseStep } from './steps/use.js';
```

- [ ] **Step 4: Run, watch pass**

Run: `pnpm --filter @plyflow/core test -- use.e2e`
Expected: PASS.

- [ ] **Step 5: Docs.** Create `website/docs/steps/use.md` (mirror a sibling page's front-matter) documenting: `use:` runs another workflow, `with:` becomes the child's inputs (validated against the child's `inputs:`), the child's top-level `outputs:` block is the only thing exposed (as `steps.<id>.output`), cycle detection, dry-run propagation, and the resume limitation (the child runs fresh per invocation). Add a short section documenting the workflow-level `outputs:` block. Add `use` to `website/docs/steps/overview.md` and register `steps/use` in `website/sidebars.ts`. Add `use` to the step-type list in `AGENTS.md`.

- [ ] **Step 6: Full monorepo gate**

Run: `pnpm -r build && pnpm -r lint && pnpm test`
Expected: build exit 0; lint clean; all tests pass (core + cli + examples).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/steps/use.e2e.test.ts website/docs AGENTS.md
git commit -m "feat(core): export makeUseStep; e2e; docs for sub-workflows"
```

---

## Self-Review

**Spec coverage (Spec A §A3):**
- Top-level `outputs:` block → Task 1 (schema) + Task 2 (evaluation/return). ✅
- Callable `use: ./sub.yaml` with `with:` → Task 4. ✅
- `with:` validated against child `inputs:` (required/defaults) → handled by `runWorkflow` reuse (Task 4). ✅
- Only declared outputs visible; internal child outputs do not leak → Task 4 (the step returns `declaredOutputs`; `use.test.ts` asserts `secret` is absent). ✅
- Cycle detection → Tasks 3 (useChain plumbing) + 4 (check + test). ✅
- Dry-run propagation into the child → Task 4 (passes `ctx.dryRun`; test asserts the child's `dryRun:` mock is returned). ✅
- Deletes mission/comms duplicated Setup → demonstrated by the Task 5 e2e (two workflows share one `setup.yaml`). ✅

**Deliberate deferral:** cross-boundary partial **resume** is OUT OF SCOPE (Global Constraints) — the child runs as a fresh `runWorkflow` each time the `use:` step executes. Documented in Task 5's `use.md`. Not a coverage gap; an explicit scope boundary for A3.

**Placeholder scan:** every step has concrete code/commands + expected output; no TBD. ✅

**Type/name consistency:** `runWorkflow` return `{ runId, outputs, declaredOutputs }` is defined in Task 2, consumed by the `RunWorkflowFn` type and `makeUseStep` in Task 4, and asserted in Tasks 2/4/5. `StepContext.useChain` (Task 3) is read by `use.run` (Task 4) and the probe test (Task 3). `WorkflowFile.outputs` / `StepDef.use` (Task 1) match the schema (Task 1), the engine evaluation (Task 2), and the step parse (Task 4). The factory injection (`makeUseStep(runWorkflow)`) avoids the steps↔engine import cycle — `use.ts` imports only the `RunOptions` *type* from engine, never the runtime. ✅

**Adjust-at-implementation note:** Task 5 Step 2 — verify the inline `run:` access (`ctx.steps.setup.output.branch`, `ctx.inputs.n`) against `steps/run.ts` before locking the e2e; fix the expression if the real context shape differs.
```
