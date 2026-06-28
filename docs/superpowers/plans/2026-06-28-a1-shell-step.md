# A1 — Native Shell Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native `sh:` step type to `@plyflow/core` that shells out, captures `stdout`/`stderr`/exit code, optionally parses JSON, resolves `${{ }}` expressions in its fields, and honors an engine dry-run flag with a declarative per-step `dryRun:` result — replacing the hand-rolled `lib/exec.ts` pattern in `examples/mission/`.

**Architecture:** A new injectable shell primitive (`core/shell.ts`) wraps `node:child_process`; the `sh` step is a `makeShStep(exec = defaultShellExec)` factory (mirroring the existing `makeLoopStep`/`makeForeachStep` factories) so tests inject a mock exec. A `dryRun` boolean is threaded from `RunOptions` → `ExecScope` → `StepContext` (default `false`); this is the minimal plumbing A4 will later wire to a CLI `--dry-run`. The step never reaches the real shell under dry-run.

**Tech Stack:** TypeScript ESM (Node ≥24), Zod (workflow schema), vitest. Repo is a pnpm monorepo; all A1 work is inside `packages/core`.

## Global Constraints

- **Node ≥24, ESM.** Relative imports keep the `.js` extension in `.ts` source (e.g. `import { x } from './shell.js'`).
- **Inject side effects.** The shell exec is an optional parameter with a real default (`defaultShellExec`), so unit tests never spawn a real process. Follow the existing factory pattern: `makeShStep(exec = defaultShellExec)`.
- **Test gate is vitest** (`pnpm --filter @plyflow/core test`), not `tsc`. Run `node -v` ⇒ must be v24.x; if it shows v20 run `source "$HOME/.nvm/nvm.sh" && nvm use 24.18.0`.
- **TDD:** failing test first (watch it fail), minimal implementation, watch it pass, commit. Tests live beside source as `*.test.ts`.
- **Exactly-one step-type key:** the schema's exclusive-or refinement must include `sh` so `sh` + `run` (etc.) on one step is rejected.
- **Expression resolution:** `sh`/`cwd`/`env`/`dryRun` values may contain `${{ }}`; resolve them at run time via `ctx.resolve(...)` (the same way `agent.ts` resolves `model`). Do NOT resolve in `parse`.
- **Non-zero exit throws** (message includes the exit code and stderr), so the engine's existing `continueOnError`/`retry` handling applies uniformly. Under dry-run, the step never throws for exit code.
- All work is in `packages/core`; do not touch tui/cli/meta in this plan.

---

## File Structure

```
packages/core/src/
  core/
    shell.ts            # NEW: ShellExec type + defaultShellExec (child_process)
    shell.test.ts       # NEW
    types.ts            # MODIFY: StepDef gains sh, json, cwd, env, dryRun
    format-schema.ts    # MODIFY: sh-step schema fields + exclusive-or includes 'sh'
    exec.ts             # MODIFY: thread `dryRun` through ExecScope/createRootScope/stepCtx
    engine.ts           # MODIFY: RunOptions.dryRun; register makeShStep(); pass dryRun to root scope
  steps/
    sh.ts               # NEW: makeShStep(exec) factory → StepType
    sh.test.ts          # NEW
    types.ts            # MODIFY: StepContext gains `dryRun: boolean`
  index.ts              # MODIFY: export makeShStep, defaultShellExec, type ShellExec
```

**Interfaces produced (used across tasks):**

```ts
// core/shell.ts
export interface ShellResult { stdout: string; stderr: string; code: number; }
export interface ShellExec {
  (command: string, opts?: { cwd?: string; env?: Record<string, string | undefined> }): Promise<ShellResult>;
}
export const defaultShellExec: ShellExec;

// steps/sh.ts
export function makeShStep(exec?: ShellExec): StepType<ShCfg>;
// sh step output: { stdout: string; stderr: string; code: number; json?: unknown }

// StepContext (steps/types.ts) gains: dryRun: boolean
// StepDef (core/types.ts) gains: sh?: string; json?: boolean; cwd?: string;
//   env?: Record<string,string>; dryRun?: { stdout?: string; stderr?: string; code?: number }
// RunOptions (engine.ts) gains: dryRun?: boolean
```

---

## Task 1: Workflow schema accepts the `sh` step

**Files:**
- Modify: `packages/core/src/core/types.ts` (StepDef fields)
- Modify: `packages/core/src/core/format-schema.ts` (schema + exclusive-or list)
- Test: `packages/core/src/core/format-schema.test.ts` (if it exists, add cases; else create it)

**Interfaces:**
- Produces: a workflow with a `sh:` step parses; `sh` participates in the exactly-one-type-key rule.

- [ ] **Step 1: Write the failing test** (add to `format-schema.test.ts`, or create it)

```ts
import { describe, it, expect } from 'vitest';
import { parseWorkflow } from './format-schema.js';

const wrap = (step: Record<string, unknown>) => ({
  name: 'w',
  phases: [{ name: 'p', steps: [{ id: 's', ...step }] }],
});

describe('sh step schema', () => {
  it('accepts a sh step with its optional fields', () => {
    const wf = parseWorkflow(
      wrap({ sh: 'echo hi', json: true, cwd: '/tmp', env: { A: 'b' }, dryRun: { stdout: 'x', code: 0 } }),
    );
    expect(wf.phases[0]!.steps[0]!.sh).toBe('echo hi');
  });

  it('rejects a step with both sh and run (exactly-one-type-key)', () => {
    expect(() => parseWorkflow(wrap({ sh: 'echo hi', run: 'return 1' }))).toThrow();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm --filter @plyflow/core test -- format-schema`
Expected: FAIL (schema strips unknown `sh`/`json`/… or the exclusive-or list lacks `sh`).

- [ ] **Step 3: Add the StepDef fields** in `packages/core/src/core/types.ts`, inside `interface StepDef` (after the existing `step?` / `default?` group):

```ts
  /** Shell command to execute (the `sh:` step type). Expression-resolved. */
  sh?: string;
  /** Parse the command's stdout as JSON into the step output (`sh` step). */
  json?: boolean;
  /** Working directory for the `sh` command (expression-resolved). */
  cwd?: string;
  /** Environment overrides for the `sh` command (expression-resolved values). */
  env?: Record<string, string>;
  /** Declarative result returned for this `sh` step under engine dry-run. */
  dryRun?: { stdout?: string; stderr?: string; code?: number };
```

- [ ] **Step 4: Extend the schema** in `packages/core/src/core/format-schema.ts`. Add these keys to the `z.object({ ... })` inside `stepDef` (next to `step: z.string().optional(),`):

```ts
      sh: z.string().optional(),
      json: z.boolean().optional(),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      dryRun: z
        .object({ stdout: z.string().optional(), stderr: z.string().optional(), code: z.number().optional() })
        .optional(),
```

And add `'sh'` to the exclusive-or `.filter([...])` array in the `.refine(...)` (and to the message):

```ts
        return ['run', 'uses', 'agent', 'input', 'parallel', 'loop', 'foreach', 'widget', 'step', 'sh'].filter(
          (k) => r[k] !== undefined,
        ).length === 1;
```
```ts
          'a step must have exactly one type key: run | uses | agent | input | parallel | loop | foreach | widget | step | sh',
```

- [ ] **Step 5: Run it, watch it pass**

Run: `pnpm --filter @plyflow/core test -- format-schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core/types.ts packages/core/src/core/format-schema.ts packages/core/src/core/format-schema.test.ts
git commit -m "feat(core): accept sh step in workflow schema"
```

---

## Task 2: Shell exec primitive (`core/shell.ts`)

**Files:**
- Create: `packages/core/src/core/shell.ts`
- Test: `packages/core/src/core/shell.test.ts`

**Interfaces:**
- Produces: `ShellResult`, `ShellExec`, `defaultShellExec` (consumed by Task 4's `makeShStep`).
- `defaultShellExec` runs a command line through a shell, resolves with `{ stdout, stderr, code }`, and **never rejects on a non-zero exit** (the code is returned, not thrown).

- [ ] **Step 1: Write the failing test** — `packages/core/src/core/shell.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { defaultShellExec } from './shell.js';

describe('defaultShellExec', () => {
  it('captures stdout and a zero exit code', async () => {
    const r = await defaultShellExec(`node -e "process.stdout.write('hello')"`);
    expect(r.stdout).toBe('hello');
    expect(r.code).toBe(0);
  });

  it('returns (does not throw) a non-zero exit code with stderr', async () => {
    const r = await defaultShellExec(`node -e "process.stderr.write('boom'); process.exit(3)"`);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('boom');
  });

  it('runs in the given cwd and passes env', async () => {
    const r = await defaultShellExec(`node -e "process.stdout.write(process.env.FOO || '')"`, {
      env: { ...process.env, FOO: 'bar' },
    });
    expect(r.stdout).toBe('bar');
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm --filter @plyflow/core test -- shell`
Expected: FAIL (`./shell.js` not found).

- [ ] **Step 3: Implement** `packages/core/src/core/shell.ts`

```ts
import { spawn } from 'node:child_process';

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ShellExec {
  (
    command: string,
    opts?: { cwd?: string; env?: Record<string, string | undefined> },
  ): Promise<ShellResult>;
}

/**
 * Run a command line through the system shell, capturing stdout/stderr and the
 * exit code. Never rejects on a non-zero exit — the caller (the `sh` step)
 * decides whether a non-zero code is an error, so retry/continueOnError stay
 * uniform with other steps. Rejects only if the process cannot be spawned.
 */
export const defaultShellExec: ShellExec = (command, opts = {}) =>
  new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd,
      env: opts.env ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm --filter @plyflow/core test -- shell`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/shell.ts packages/core/src/core/shell.test.ts
git commit -m "feat(core): injectable shell exec primitive"
```

---

## Task 3: Thread `dryRun` through the step context

**Files:**
- Modify: `packages/core/src/steps/types.ts` (StepContext)
- Modify: `packages/core/src/core/exec.ts` (ExecScope, RootScopeOptions, createRootScope, stepCtx)
- Modify: `packages/core/src/core/engine.ts` (RunOptions.dryRun; pass to createRootScope)
- Test: `packages/core/src/core/exec.test.ts` (add a case) or a focused new test

**Interfaces:**
- Produces: `StepContext.dryRun: boolean` (default `false`), settable via `runWorkflow(path, { dryRun: true })`. Task 4's `sh` step reads it.

- [ ] **Step 1: Write the failing test** — add to an existing engine/exec test file (e.g. `packages/core/src/core/engine.test.ts`); if none asserts ctx, create `packages/core/src/steps/dryrun-ctx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow, buildDefaultRegistry } from '../core/engine.js';
import { StepRegistry } from './registry.js';
import type { StepType } from './types.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function probeRegistry(seen: { dryRun?: boolean }): StepRegistry {
  const reg = buildDefaultRegistry();
  const probe: StepType = {
    name: 'probe',
    match: (d) => d.step === 'probe',
    parse: () => ({}),
    run: async (_cfg, ctx) => {
      seen.dryRun = ctx.dryRun;
      return { output: ctx.dryRun };
    },
  };
  reg.register(probe);
  return reg;
}

it('exposes dryRun on the step context (default false; true when requested)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        step: probe\n');

  const seenA: { dryRun?: boolean } = {};
  await runWorkflow(wf, { provider: new FakeProvider(), registry: probeRegistry(seenA), isTty: false });
  expect(seenA.dryRun).toBe(false);

  const seenB: { dryRun?: boolean } = {};
  await runWorkflow(wf, { provider: new FakeProvider(), registry: probeRegistry(seenB), isTty: false, dryRun: true });
  expect(seenB.dryRun).toBe(true);
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm --filter @plyflow/core test -- dryrun-ctx`
Expected: FAIL (`ctx.dryRun` is `undefined`; `RunOptions` has no `dryRun`).

- [ ] **Step 3: Add `dryRun` to `StepContext`** in `packages/core/src/steps/types.ts`, in the `StepContext` interface (after `isTty: boolean;`):

```ts
  /** True when the run is in dry-run mode; side-effecting steps must not execute. */
  dryRun: boolean;
```

- [ ] **Step 4: Thread it through `exec.ts`.** Add `dryRun: boolean;` to `ExecScope` (after `isTty: boolean;`) and to `RootScopeOptions` (as `dryRun?: boolean;`). In `createRootScope`, set `dryRun: opts.dryRun ?? false,`. In `makeRunChildren`'s `childScope`, set `dryRun: parentScope.dryRun,`. In the `stepCtx` object literal, add `dryRun: scope.dryRun,`.

- [ ] **Step 5: Add `dryRun` to `RunOptions` and pass it.** In `packages/core/src/core/engine.ts`, add to `RunOptions`:

```ts
  /** Run side-effecting steps (sh, …) in dry-run mode. Defaults to false. */
  dryRun?: boolean;
```

Then find the `createRootScope({ ... })` call in `runWorkflow` and add `dryRun: opts.dryRun ?? false,` to its options object.

- [ ] **Step 6: Run it, watch it pass**

Run: `pnpm --filter @plyflow/core test -- dryrun-ctx`
Expected: PASS.

- [ ] **Step 7: Run the full core suite (no regressions from the context change)**

Run: `pnpm --filter @plyflow/core test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/steps/types.ts packages/core/src/core/exec.ts packages/core/src/core/engine.ts packages/core/src/steps/dryrun-ctx.test.ts
git commit -m "feat(core): thread dryRun flag through the step context"
```

---

## Task 4: The `sh` step type (`makeShStep`)

**Files:**
- Create: `packages/core/src/steps/sh.ts`
- Test: `packages/core/src/steps/sh.test.ts`
- Modify: `packages/core/src/core/engine.ts` (register `makeShStep()` in `buildDefaultRegistry`)

**Interfaces:**
- Consumes: `ShellExec`/`defaultShellExec` (Task 2), `ctx.dryRun` (Task 3), `ctx.resolve` (existing).
- Produces: `makeShStep(exec?)` → `StepType`; output `{ stdout, stderr, code, json? }`. Registered as a built-in.

- [ ] **Step 1: Write the failing test** — `packages/core/src/steps/sh.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeShStep } from './sh.js';
import type { ShellExec, ShellResult } from '../core/shell.js';
import type { StepContext } from './types.js';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {}, env: {}, steps: {}, with: {}, bindings: {},
    provider: {} as never, baseDir: '/wf', isTty: false, dryRun: false, provided: [],
    resolve: (v) => v, // identity resolver for tests
    emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    ...over,
  } as StepContext;
}

const mkExec = (impl: (cmd: string, opts?: unknown) => ShellResult): ShellExec =>
  vi.fn(async (cmd, opts) => impl(cmd, opts));

describe('makeShStep', () => {
  it('runs the command and returns stdout/stderr/code', async () => {
    const step = makeShStep(mkExec(() => ({ stdout: 'hi', stderr: '', code: 0 })));
    const res = await step.run(step.parse({ id: 's', sh: 'echo hi' }), ctx());
    expect(res.output).toEqual({ stdout: 'hi', stderr: '', code: 0 });
  });

  it('parses JSON stdout when json:true', async () => {
    const step = makeShStep(mkExec(() => ({ stdout: '{"a":1}', stderr: '', code: 0 })));
    const res = await step.run(step.parse({ id: 's', sh: 'x', json: true }), ctx());
    expect((res.output as { json: unknown }).json).toEqual({ a: 1 });
  });

  it('throws on a non-zero exit code (message includes code + stderr)', async () => {
    const step = makeShStep(mkExec(() => ({ stdout: '', stderr: 'nope', code: 2 })));
    await expect(step.run(step.parse({ id: 's', sh: 'x' }), ctx())).rejects.toThrow(/2.*nope|nope.*2/);
  });

  it('passes cwd and env to the exec', async () => {
    const exec = mkExec(() => ({ stdout: '', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    await step.run(step.parse({ id: 's', sh: 'x', cwd: '/work', env: { A: 'b' } }), ctx());
    expect(exec).toHaveBeenCalledWith('x', { cwd: '/work', env: { A: 'b' } });
  });

  it('resolves ${{ }} in command/cwd/env via ctx.resolve', async () => {
    const exec = mkExec(() => ({ stdout: '', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    const resolve = (v: unknown) => (v === '${{ inputs.c }}' ? 'real-cmd' : v);
    await step.run(step.parse({ id: 's', sh: '${{ inputs.c }}' }), ctx({ resolve }));
    expect(exec).toHaveBeenCalledWith('real-cmd', { cwd: undefined, env: undefined });
  });

  it('under dryRun returns the declared result without calling exec', async () => {
    const exec = mkExec(() => ({ stdout: 'SHOULD NOT RUN', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    const res = await step.run(
      step.parse({ id: 's', sh: 'x', dryRun: { stdout: 'mocked', code: 0 } }),
      ctx({ dryRun: true }),
    );
    expect(exec).not.toHaveBeenCalled();
    expect(res.output).toEqual({ stdout: 'mocked', stderr: '', code: 0 });
  });

  it('under dryRun with no declared result no-ops to empty success', async () => {
    const exec = mkExec(() => ({ stdout: 'x', stderr: '', code: 0 }));
    const step = makeShStep(exec);
    const res = await step.run(step.parse({ id: 's', sh: 'x' }), ctx({ dryRun: true }));
    expect(exec).not.toHaveBeenCalled();
    expect(res.output).toEqual({ stdout: '', stderr: '', code: 0 });
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm --filter @plyflow/core test -- steps/sh`
Expected: FAIL (`./sh.js` not found).

- [ ] **Step 3: Implement** `packages/core/src/steps/sh.ts`

```ts
import type { StepDef } from '../core/types.js';
import type { StepType, StepContext, StepResult } from './types.js';
import { defaultShellExec, type ShellExec, type ShellResult } from '../core/shell.js';

interface ShCfg {
  command: string;
  json: boolean;
  cwd?: string;
  env?: Record<string, string>;
  dryRun?: { stdout?: string; stderr?: string; code?: number };
}

function resolveStr(ctx: StepContext, v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return ctx.resolve ? (ctx.resolve(v) as string) : v;
}

export function makeShStep(exec: ShellExec = defaultShellExec): StepType<ShCfg> {
  return {
    name: 'sh',
    match: (def: StepDef) => def.sh !== undefined,
    parse: (def: StepDef): ShCfg => ({
      command: def.sh!,
      json: def.json ?? false,
      cwd: def.cwd,
      env: def.env,
      dryRun: def.dryRun,
    }),
    run: async (cfg: ShCfg, ctx: StepContext): Promise<StepResult> => {
      const build = (r: ShellResult): StepResult => {
        const output: { stdout: string; stderr: string; code: number; json?: unknown } = {
          stdout: r.stdout,
          stderr: r.stderr,
          code: r.code,
        };
        if (cfg.json) output.json = JSON.parse(r.stdout);
        return { output };
      };

      if (ctx.dryRun) {
        const d = cfg.dryRun ?? {};
        return build({ stdout: d.stdout ?? '', stderr: d.stderr ?? '', code: d.code ?? 0 });
      }

      const command = resolveStr(ctx, cfg.command)!;
      const cwd = resolveStr(ctx, cfg.cwd);
      let env: Record<string, string> | undefined = cfg.env;
      if (env && ctx.resolve) {
        env = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, ctx.resolve!(v) as string]));
      }

      const r = await exec(command, { cwd, env });
      if (r.code !== 0) {
        throw new Error(`sh command failed (code ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
      }
      return build(r);
    },
  };
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm --filter @plyflow/core test -- steps/sh`
Expected: PASS (7 tests).

- [ ] **Step 5: Register the step as a built-in.** In `packages/core/src/core/engine.ts`, import and register it in `buildDefaultRegistry`:

```ts
import { makeShStep } from '../steps/sh.js';
```
and alongside the other `reg.register(...)` calls:
```ts
  reg.register(makeShStep());
```

- [ ] **Step 6: Run the full core suite**

Run: `pnpm --filter @plyflow/core test`
Expected: all pass (sh registered, no conflicts).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/steps/sh.ts packages/core/src/steps/sh.test.ts packages/core/src/core/engine.ts
git commit -m "feat(core): native sh step type (injectable exec, json, dry-run)"
```

---

## Task 5: Barrel exports, end-to-end run, and docs

**Files:**
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/steps/sh.e2e.test.ts` (runs a real `sh` workflow through `runWorkflow`)
- Modify: `website/docs/` (add `sh` to the step-types reference) and `AGENTS.md` (note the new step type)

**Interfaces:**
- Consumes: everything above.
- Produces: public exports `makeShStep`, `defaultShellExec`, type `ShellExec`/`ShellResult`; a green end-to-end proof.

- [ ] **Step 1: Write the failing e2e test** — `packages/core/src/steps/sh.e2e.test.ts` (uses the built-in `sh` with a real, portable command)

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow } from '../core/engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('runs a sh step end-to-end and exposes its output to later steps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-sh-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(
    wf,
    [
      'name: w',
      'phases:',
      '  - name: p',
      '    steps:',
      `      - id: greet`,
      `        sh: node -e "process.stdout.write('hello')"`,
      `      - id: use`,
      `        needs: [greet]`,
      `        run: return ctx.steps.greet.output.stdout + '!'`,
    ].join('\n'),
  );

  const { outputs } = await runWorkflow(wf, { provider: new FakeProvider(), isTty: false });
  expect((outputs.greet as { stdout: string }).stdout).toBe('hello');
  expect(outputs.use).toBe('hello!');
});

it('dry-run returns the declared mock and never executes the command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-shdry-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(
    wf,
    [
      'name: w',
      'phases:',
      '  - name: p',
      '    steps:',
      `      - id: danger`,
      `        sh: node -e "process.exit(1)"`,
      `        dryRun: { stdout: "safe", code: 0 }`,
    ].join('\n'),
  );
  const { outputs } = await runWorkflow(wf, { provider: new FakeProvider(), isTty: false, dryRun: true });
  expect((outputs.danger as { stdout: string }).stdout).toBe('safe');
});
```

- [ ] **Step 2: Run it, watch it fail (or pass partially)**

Run: `pnpm --filter @plyflow/core test -- sh.e2e`
Expected: the run already works (sh is registered); the test exists to lock the contract. If the inline `run:` accessing `ctx.steps.greet.output` is wrong for this codebase, adjust the expression to match how `run:` reads prior outputs (see `steps/run.ts`: the inline function gets `(input, ctx)` where `ctx.steps.<id>.output` holds prior outputs). Confirm green before moving on.

- [ ] **Step 3: Add barrel exports** in `packages/core/src/index.ts`:

```ts
// Shell step (sh:) — primitive + factory for custom registries / testing
export { makeShStep } from './steps/sh.js';
export { defaultShellExec } from './core/shell.js';
export type { ShellExec, ShellResult } from './core/shell.js';
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm --filter @plyflow/core test -- sh.e2e`
Expected: PASS (2 tests).

- [ ] **Step 5: Document the step.** In the website step-types reference (find the page under `website/docs/` that lists `run`/`uses`/`agent`/… — e.g. a "steps" or "reference" page via `grep -rl "uses:" website/docs`), add a `sh:` entry: command string, `json`, `cwd`, `env`, `dryRun`, output shape `{ stdout, stderr, code, json? }`, non-zero-exit-throws behaviour, and that it honors `--dry-run`. In `AGENTS.md`'s step-type sentence (the `run | uses | agent | …` list under "What this is"), add `sh` to the list.

- [ ] **Step 6: Full core build + test gate**

Run: `pnpm --filter @plyflow/core build && pnpm --filter @plyflow/core test`
Expected: build exit 0; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/steps/sh.e2e.test.ts website/docs AGENTS.md
git commit -m "feat(core): export sh primitives; e2e test; docs"
```

---

## Self-Review

**Spec coverage (Spec A §A1):**
- Native `sh:` step keyed `sh` → Tasks 1, 4. Captured `{ stdout, stderr, code, json? }` → Task 4. `json`/`cwd`/`env` fields → Tasks 1, 4. Expression resolution of command/cwd/env → Task 4 (test + impl). Non-zero exit throws, `continueOnError`/`retry` uniform → Task 4 (engine handling unchanged). Declarative `dryRun:` + honors engine dry-run → Tasks 1, 3, 4, 5. Injectable exec (mission's `lib/exec.ts` replacement) → Task 2 + factory in Task 4. ✅
- A1's dry-run plumbing is the minimal `ctx.dryRun` flag (Task 3); the **CLI `--dry-run`** wiring and `@plyflow/testing` belong to **A4** (out of scope here, by the spec's sequencing). The `runWorkflow({ dryRun })` option added in Task 3 is what A4's CLI flag will set.

**Placeholder scan:** every step has concrete code/commands and expected results; no TBD/▢. ✅

**Type/name consistency:** `ShellExec`/`ShellResult`/`defaultShellExec` (Task 2) are consumed verbatim by `makeShStep` (Task 4) and re-exported (Task 5). `StepContext.dryRun` (Task 3) is read by `sh.run` (Task 4) and the probe test (Task 3). `StepDef` fields (Task 1) match what `parse` reads (Task 4) and the schema validates (Task 1). Output shape `{ stdout, stderr, code, json? }` is identical across Task 4 impl, Task 4 tests, and Task 5 e2e. ✅

**Adjust-at-implementation note:** Task 5 Step 2 flags that the inline `run:` expression reading `ctx.steps.greet.output` must match this codebase's `run:`-step context shape — verify against `steps/run.ts` and fix the expression if needed before locking the e2e test. This is the one place reality must be checked, not assumed.
