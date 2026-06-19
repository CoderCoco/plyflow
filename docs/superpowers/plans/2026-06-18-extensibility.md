# plyflow v0.3 — Extensibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`. Work in the MAIN tree on branch `feat/extensibility` — do NOT create worktrees.

**Goal:** Make workflows self-contained, extensible artifacts: workflow-local dependency management with host-provided modules (pillar C), a `widget` step type for custom Ink/React UI (pillar A), and custom step-type plugins (pillar B).

**Architecture:** A central `jiti`-based module loader aliases host-provided libs (zod/react/ink) to plyflow's own copies and resolves user imports from the workflow dir. The engine prepares the workflow environment (auto-install deps) once per run, then all user-code loads (schemas, run/uses, widgets, plugins) go through the loader.

**Tech Stack:** Node 20 ESM, TypeScript strict, jiti, Zod v4, Ink 5 + React 18, Vitest.

## Global Constraints

- Node >= 20; ESM; `.js` imports; strict; co-located `*.test.ts`; TDD.
- jiti loads all user `.ts`/`.tsx`. Local workflows TRUSTED (no sandbox).
- All v0.2 tests (225) must stay green after every task. Build + lint + built-binary smoke stay green.
- Conventional Commits. Build order is C → A → B.

---

## Pillar C — Workflow environment

### Task C1: Central module loader with provided-module aliasing

**Files:** Create `src/core/module-loader.ts`, `src/core/module-loader.test.ts`, fixture `src/core/__fixtures__/uses-zod.ts`.

**Interfaces:**
```ts
export const DEFAULT_PROVIDED: string[];  // ['zod','react','ink']
export interface LoaderOptions { baseDir: string; provided?: string[]; }
export interface ModuleLoader { import(path: string): Promise<unknown>; }
export function createLoader(opts: LoaderOptions): ModuleLoader;
```
`createLoader` builds a `jiti` instance with `alias` mapping each provided specifier to plyflow's own resolved module path (resolve via `import.meta.resolve`, falling back to `createRequire(import.meta.url).resolve`), and resolution rooted at `baseDir`. `import(path)` resolves `path` against `baseDir` if relative, then `jiti.import`s it.

- [ ] **Step 1: failing test** — fixture `uses-zod.ts`: `import { z } from 'zod'; export default z.object({ n: z.number() });`. Test: `createLoader({ baseDir: <fixtures dir> }).import('./uses-zod.ts')` returns a module whose default export `instanceof z.ZodType` is **true** (proving the loaded module's zod is plyflow's realm — the alias works). Also assert `z.toJSONSchema(default)` succeeds.
- [ ] **Step 2: run** `npx vitest run src/core/module-loader.test.ts` → FAIL.
- [ ] **Step 3: implement** `module-loader.ts`. Resolve plyflow's zod/react/ink paths and pass as jiti `alias`.
- [ ] **Step 4: run** → PASS; full suite green.
- [ ] **Step 5: commit** `feat(core): add module loader with host-provided aliasing`.

> NOTE: confirm jiti's `alias` option shape against the installed jiti (2.7) types; the report should record the exact option used.

### Task C2: Route schema/load + run/uses through the loader; retire duck-typing

**Files:** Modify `src/schema/load.ts`, `src/steps/run.ts`. Modify `src/steps/types.ts` (add `loadModule` to `StepContext`). Modify `src/core/exec.ts`/`engine.ts` to provide `ctx.loadModule`. Tests: existing `schema/load.test.ts`, `steps/run.test.ts` stay green + a new assertion.

**Interfaces:** `StepContext.loadModule(path: string): Promise<unknown>` — uses the run's loader. `schema/load.ts` uses `ctx.loadModule` (or a loader passed in) and, because zod is realm-shared, replaces `findSchema` duck-typing with `schema instanceof z.ZodType` (keep a one-line guard message).

- [ ] **Step 1: failing test** — add to `schema/load.test.ts`: after refactor, `loadSchema` still validates the fixture AND the loaded schema is `instanceof z.ZodType`. For `run.ts`, a test that `ctx.loadModule` is used. (Write the new assertions first.)
- [ ] **Step 2–4:** refactor both to use the loader; provide `ctx.loadModule` from the engine (built from `createLoader` at run start — for now default provided set + workflow baseDir). All existing tests + new pass.
- [ ] **Step 5: commit** `refactor(core): load user modules via shared loader; drop zod duck-typing`.

> The engine builds the loader in C4; until then, C2 can construct a default loader at run start (baseDir = workflow dir, DEFAULT_PROVIDED) so `ctx.loadModule` works. C4 swaps in the env-resolved provided set.

### Task C3: Workflow environment + dependency auto-install

**Files:** Create `src/core/workflow-env.ts`, `src/core/workflow-env.test.ts`.

**Interfaces:**
```ts
import type { Exec } from ...;  // reuse a small exec type or define one here
export interface WorkflowEnv { dir: string; provided: string[]; plugins: string[]; }
export async function prepareEnv(workflowPath: string, exec?: Exec): Promise<WorkflowEnv>;
```
- `dir` = directory of the workflow file. Read `dir/package.json` if present: parse `plyflow.provided` (merge with `DEFAULT_PROVIDED`, dedupe) and `plyflow.plugins` (default []).
- Determine if declared deps (dependencies + devDependencies, minus provided) are resolvable from `dir/node_modules` (check each dep dir exists). If any missing: run `npm ci` when a lockfile exists else `npm install` in `dir`, via the injected `exec` (default spawns real npm). Emit progress (return value or a callback; keep it simple — `prepareEnv` can take an optional `onLog`).
- No `package.json` → `{ dir, provided: DEFAULT_PROVIDED, plugins: [] }`, no install.

- [ ] **Step 1: failing test** (fake `exec` recording calls): a fixture workflow dir with a package.json declaring a missing dep + a lockfile → `prepareEnv` runs `npm ci`; with deps present → no install; `plyflow.provided` merged with defaults; `plyflow.plugins` parsed; a dir without package.json → defaults, no exec calls.
- [ ] **Step 2–4:** implement; tests pass; full suite green.
- [ ] **Step 5: commit** `feat(core): add workflow env preparation with dep auto-install`.

### Task C4: Engine integration (prepareEnv + loader threading)

**Files:** Modify `src/core/engine.ts` (`runWorkflow`), `src/core/exec.ts` (thread loader onto scope/ctx).

**Interfaces:** `runWorkflow` calls `prepareEnv(path)` first, builds `createLoader({ baseDir: env.dir, provided: env.provided })`, and threads it so `ctx.loadModule` uses it (replacing the default loader from C2). `RunOptions` may accept an injected `exec` for tests.

- [ ] **Step 1: failing test** — an e2e test: a workflow whose `output:` schema imports zod runs via `runWorkflow` and validates (proving the env-built loader is used). A workflow dir with a package.json + fake exec asserts install ran once.
- [ ] **Step 2–4:** wire it; tests + full suite green; `npm run build` clean.
- [ ] **Step 5: commit** `feat(core): prepare workflow env and thread loader through runWorkflow`.

---

## Pillar A — `widget` step type

### Task A1: UiRequest union + StepDef fields + input `default` + non-TTY rule

**Files:** Modify `src/steps/types.ts` (UiRequest union), `src/core/types.ts` (`widget?`, `default?` on StepDef), `src/core/format-schema.ts`, `src/steps/input.ts` (+`default`, non-TTY). Tests updated.

**Interfaces:**
```ts
export type UiRequest =
  | { kind: 'prompt'; type: 'confirm'|'text'|'select'; message: string; choices?: string[] }
  | { kind: 'widget'; module: string; baseDir: string; props: unknown };
// StepContext.prompt(req: UiRequest): Promise<unknown>   (generalized; input sends {kind:'prompt',...})
```
- Add `widget?: string` and `default?: unknown` to `StepDef`; allow in format-schema; add `widget` to the one-type-key set.
- `input.ts` sends `{ kind: 'prompt', ... }`. Non-TTY behavior: a helper the engine exposes — `ctx.isTty: boolean`; when false, `input`/`widget` return `def.default` if present else throw. Add `isTty` to `StepContext` (engine sets from `process.stdout.isTTY`, overridable in tests).

- [ ] **Step 1: failing tests** — input with `default` in non-TTY (ctx.isTty=false) returns the default; without default throws; with isTty=true still prompts. UiRequest union compiles; existing input test updated to `{kind:'prompt'}`.
- [ ] **Step 2–4:** implement; full suite green.
- [ ] **Step 5: commit** `feat(steps): generalize UI channel; add default + non-TTY handling to input`.

### Task A2: `widget` step type

**Files:** Create `src/steps/widget.ts`, `src/steps/widget.test.ts`. Register in `buildDefaultRegistry`.

**Interfaces:** `widgetStep: StepType` matching `def.widget !== undefined`. `run(cfg, ctx)`: if `!ctx.isTty`, return `cfg.default` if present else throw; else send `ctx.prompt({ kind: 'widget', module: <resolved abs path of def.widget>, baseDir: ctx.baseDir, props: ctx.with })` and return the resolved value as output.

- [ ] **Step 1: failing test** — with a fake `ctx.prompt` that records the request and resolves a value: assert the widget step sends a `widget` UiRequest with the right module path + props (= resolved `with`) and returns the resolved value. Non-TTY: returns `default` / throws.
- [ ] **Step 2–4:** implement + register; full suite green.
- [ ] **Step 5: commit** `feat(steps): add widget step type`.

### Task A3: TUI App mounts widgets

**Files:** Modify `src/tui/App.tsx` (handle `widget` UiRequest by loading the component via the loader and mounting it). Test: `src/tui/widget.test.tsx`, fixture `src/tui/__fixtures__/EchoWidget.tsx`.

**Interfaces:** The App's pending-UI handling branches on `request.kind`: `prompt` → `<Prompt>` (as today); `widget` → load `request.module` via a loader (the App gets a loader, or uses `createLoader({ baseDir: request.baseDir })`), get the default export component, render `<Component data={request.props} resolve={onResolve} />`. The widget fixture imports React/ink and calls `resolve` on a keypress.

- [ ] **Step 1: failing test** — fixture `EchoWidget.tsx`: a component that on mount (or on 'y') calls `resolve(props.data)`. Render `<App>` driving a `widget` UiRequest through the channel (mirror the existing App test harness), assert the resolved value equals the passed `data` and the frame rendered the widget. (Use `ink-testing-library`.)
- [ ] **Step 2–4:** implement App widget mounting (load via the module loader so react/ink are plyflow's); full suite green; `npm run build` clean.
- [ ] **Step 5: commit** `feat(tui): mount custom widgets in the App`.

---

## Pillar B — custom step-type plugins

### Task B1: `step:` type key + `plugins:` field + schema

**Files:** Modify `src/core/types.ts` (`step?: string` on StepDef; `plugins?: string[]` on WorkflowFile), `src/core/format-schema.ts` (add `step` + `widget` to one-type-key set; allow `plugins` on the workflow). Tests.

- [ ] **Step 1: failing test** — a workflow with `plugins: ['./p.ts']` and a step `{ id, step: 'my', with: {} }` PARSES; a step with both `step` and `run` fails the one-type-key refine; `widget` is a valid type key.
- [ ] **Step 2–4:** implement; full suite green.
- [ ] **Step 5: commit** `feat(core): add step: type key and plugins field`.

### Task B2: Plugin loader

**Files:** Create `src/core/plugins.ts`, `src/core/plugins.test.ts`, fixtures `src/core/__fixtures__/plugin-steptype.ts` and `plugin-register.ts`.

**Interfaces:**
```ts
export async function loadPlugins(plugins: string[], registry: StepRegistry, load: (p: string) => Promise<unknown>): Promise<void>;
```
For each plugin path: `load(path)`; if the default export looks like a `StepType` (`name`+`match`+`run`), `registry.register(it)`; if it's a function, call `it(registry)` (register-fn form). Custom step types invoked via `step:` — so the built-in selection in `StepRegistry`/exec must resolve `def.step === '<name>'` to the registered type. (Add a registry match: a registered custom StepType's `match` returns true when `def.step === type.name`; OR the registry gains a `byStepName` lookup. Prefer: custom types define `match: (def) => def.step === '<name>'` — document this in the fixture; the loader can wrap a bare StepType to match on `step` by its name.)

- [ ] **Step 1: failing test** — fixture `plugin-steptype.ts` default-exports a StepType named `echo` whose `run` returns `with.value`; `plugin-register.ts` default-exports a `register(reg)` that registers a `twice` type. `loadPlugins([...], reg, fakeLoad)` registers both; a `{ step: 'echo', with: { value: 7 } }` resolves to the echo type and runs → 7.
- [ ] **Step 2–4:** implement; full suite green.
- [ ] **Step 5: commit** `feat(core): add workflow plugin loader`.

### Task B3: Engine wires plugins + `step:` invocation

**Files:** Modify `src/core/engine.ts` (`runWorkflow`: after `prepareEnv` + loader + `buildDefaultRegistry`, call `loadPlugins(env.plugins ∪ wf.plugins, registry, loader.import)`), and the registry/exec so `step:` resolves. Test e2e.

- [ ] **Step 1: failing test** — an e2e workflow declaring a fixture plugin and invoking it via `step:`; run via `runWorkflow` + FakeProvider; assert the custom step ran and produced its output. A workflow invoking an unregistered `step: ghost` errors with a clear message listing available custom step names.
- [ ] **Step 2–4:** wire; full suite + build + lint green.
- [ ] **Step 5: commit** `feat(core): load and invoke workflow plugins`.

---

## Task Z: Examples + docs + integration

**Files:** `examples/widgets/` (a widget `.tsx` + a workflow using it), `examples/plugins/` (a plugin + workflow), update `README.md`. Test: `examples/extensibility.e2e.test.ts` (dry-run the example workflows parse/validate; the plugin example runs end-to-end against FakeProvider/non-TTY default).

- [ ] **Step 1: failing test** — the example workflows parse via `loadWorkflow`; the plugin example runs (non-TTY, widget uses `default:`) and completes.
- [ ] **Step 2–4:** author examples + README section (workflow package.json + provided modules; widgets; plugins; `step:`); full suite + build + lint green.
- [ ] **Step 5: commit** `docs(extensibility): add widget + plugin examples and README`.

---

## Self-Review

- **Coverage:** module loader + aliasing (C1), loader routing + duck-typing retirement (C2), env+auto-install (C3), engine wiring (C4), UI channel + input default/non-TTY (A1), widget step (A2), App widget mounting (A3), step:/plugins schema (B1), plugin loader (B2), engine plugin wiring (B3), examples/docs (Z). All spec items covered.
- **Ordering:** C before A/B (loader is the dependency); within C, C1→C2→C3→C4; A1→A2→A3; B1→B2→B3; Z last.
- **Type consistency:** `ModuleLoader`/`createLoader` (C1) consumed by C2/C4/A3/B3; `StepContext.loadModule`+`isTty` (C2/A1) consumed by widget (A2) and steps; `UiRequest` union (A1) consumed by input/widget/App; `StepDef.widget/step/default` + `WorkflowFile.plugins` (A1/B1) consumed by schema + engine.
- **Regression gate:** v0.2 suite (225) green after every task; C2's refactor of `schema/load.ts` (removing the duck-typing) is the riskiest — its existing tests are the guard, and the realm-shared zod must make `instanceof` hold.
