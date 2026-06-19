# plyflow v0.3 — Extensibility Design Spec

**Date:** 2026-06-18
**Status:** Approved (design); feeds an implementation plan
**Repo:** plyflow

## Summary

Make plyflow workflows self-contained, extensible artifacts. Three pillars:

- **C. Workflow environment** (foundational) — a workflow directory may carry its own `package.json`; plyflow auto-installs its deps and resolves a configurable set of **host-provided modules** (default `zod`/`react`/`ink`) to plyflow's own copies, so workflow code needn't declare them and shares plyflow's module realm.
- **A. `widget` step type** — mount a user-supplied custom Ink/React `.tsx` component in the TUI and capture its resolved value as the step output, like the built-in `input` step.
- **B. custom step-type plugins** — a workflow registers its own declarative step types, invoked by name via `step: <name>`.

Build order is **C → A → B**: A needs C (a widget's `react`/`ink` must be plyflow's instances), and B needs C (plugins load via the shared loader).

## Goals

- A workflow folder with a `package.json` runs with its declared deps auto-installed and version-pinned (via the lockfile).
- Workflow code (`run`/`uses`/schemas/widgets/plugins) can `import` host-provided libs (`zod`, `react`, `ink`, plus any configured) without declaring them, resolving to plyflow's copies (same realm).
- A `widget:` step renders a custom component and returns its resolved value; an `input`/`widget` step may declare a `default:` for non-TTY mode.
- A workflow may register custom step types and invoke them via `step: <name>`.
- Retire the dual-realm duck-typing workaround in `schema/load.ts` once `zod` is realm-shared.

## Non-Goals

- A package registry or publishing mechanism for workflows (a workflow is just a directory).
- Sandboxing plugin/widget/code execution — local workflows remain TRUSTED (consistent with v0.1+).
- Hot-reloading widgets/plugins during a run.
- Bundling/transpiling user code ahead of time — jiti loads on demand.

## Global Constraints

- Node >= 24; ESM; intra-project imports use `.js`; TypeScript strict; Vitest; co-located `*.test.ts`. Stack: Ink 7 + React 19, TypeScript 6, ESLint 10 (latest).
- Local workflows TRUSTED (in-process execution, no sandbox).
- `jiti` is the runtime loader for all user `.ts`/`.tsx`.
- Conventional Commits.

---

## Pillar C — Workflow environment

### C.1 Central module loader

Introduce `src/core/module-loader.ts`:

```ts
export interface LoaderOptions {
  baseDir: string;                 // workflow dir (resolution root for user imports)
  provided?: string[];             // host-provided module specifiers (default below)
}
export function createLoader(opts: LoaderOptions): {
  import(absOrRelPath: string): Promise<unknown>;
};
export const DEFAULT_PROVIDED = ['zod', 'react', 'ink'];
```

`createLoader` builds a `jiti` instance configured with `alias` mapping each provided specifier to plyflow's own resolved path (computed via `import.meta.resolve`/`require.resolve` from plyflow's location), and base resolution at `baseDir`. Every place that loads user `.ts`/`.tsx` — `schema/load.ts`, the `run`/`uses` step, the `widget` step (via the TUI), and the plugin loader — uses this loader instead of creating ad-hoc jiti instances.

**Realm consequence:** because `zod` now resolves to plyflow's instance, `schema/load.ts` can use `schema instanceof z.ZodType` and drop the duck-typing/`findSchema` fallback. (Keep a thin guard, but the realm hazard is gone.)

### C.2 Provided-modules allowlist

- Default `DEFAULT_PROVIDED = ['zod','react','ink']`.
- Extensible per-workflow via the workflow `package.json`: `"plyflow": { "provided": ["zod","react","ink","my-lib"] }` (merged with the default, deduped).
- Provided modules are excluded from dependency verify/install (C.3).

### C.3 Dependency auto-install

`src/core/workflow-env.ts`:

```ts
export interface WorkflowEnv { dir: string; provided: string[]; }
export async function prepareEnv(workflowPath: string, exec?: Exec): Promise<WorkflowEnv>;
```

- Locate the workflow dir (the directory containing the workflow file). Look for `package.json` there.
- If present: read `plyflow.provided` (merge with default). Determine whether declared deps (minus provided) are resolvable from the dir's `node_modules`. If not, run `npm ci` when a `package-lock.json`/`npm-shrinkwrap.json` exists, else `npm install`, in the dir — reporting via an event/log. (Auto-install always, per the chosen policy.)
- If no `package.json`: provided = default; no install.
- The `exec` is injectable for tests (no real npm/network in tests).
- The engine calls `prepareEnv` once at the start of `runWorkflow`, then builds the loader with the resolved `provided` set and threads it through the run.

### C.4 Engine integration

`runWorkflow` gains an internal step: resolve `WorkflowEnv` → build the loader → make the loader available to step types that load user code (via `ExecScope`/`StepContext`, e.g. `ctx.loadModule(path)`), replacing the ad-hoc jiti in `run.ts`/`schema/load.ts`.

---

## Pillar A — `widget` step type

### A.1 YAML shape

```yaml
- id: pick
  widget: ./widgets/Chart.tsx
  with: { data: "${{ steps.x.output }}" }
  default: { choice: 0 }     # used when non-TTY
```

`widget?: string`, the shared `with?`, and `default?: unknown` are added to `StepDef` + format-schema. (`default` also added to the `input` step.)

### A.2 Engine stays React-free

The `widget` step type does NOT import React. It sends a request through the existing UI channel (`ctx.prompt`, generalized to a union):

```ts
type UiRequest =
  | { kind: 'prompt'; type: 'confirm'|'text'|'select'; message: string; choices?: string[] }
  | { kind: 'widget'; module: string; baseDir: string; props: unknown };
```

The TUI `App` (which already imports React/Ink and now uses the module loader) handles a `widget` request by loading `module` via the loader, then mounting `<Component {...props} resolve={onResolve} />`. The `input` step sends a `prompt` request (unchanged behavior).

### A.3 Widget contract

The widget `.tsx` default-exports a component receiving props `{ data: <resolved with>, resolve: (value: unknown) => void }`. It calls `resolve(value)` when done; that value becomes the step's output. `react`/`ink` imported by the widget resolve to plyflow's instances (via the loader's provided alias), so Ink's context works.

### A.4 Non-TTY behavior

When `process.stdout.isTTY` is false, a `widget` (and `input`) step uses its `default:` value if declared; otherwise it errors with a clear message. This generalizes the current input non-TTY error.

---

## Pillar B — custom step-type plugins

### B.1 Declaration

A workflow declares plugins either:
- top-level in the YAML: `plugins: [ ./steps/fetch-db.ts ]`, or
- in the workflow `package.json`: `"plyflow": { "plugins": ["./steps/fetch-db.ts"] }`.

Each plugin module default-exports either a `StepType` or a `register(registry: StepRegistry): void` function (support both — if the default export has `.name`/`.match`/`.run` it's a StepType; if it's a function, call it with the registry).

### B.2 Loading & registration

At the start of `runWorkflow`, after `buildDefaultRegistry()`, plyflow loads each declared plugin via the module loader and registers its step type(s). Plugins load before workflow validation needs them.

### B.3 Invocation by name

Custom step types are invoked with a new type-key `step: <registered-name>` plus the shared `with:`:

```yaml
- id: q
  step: fetch-db
  with: { table: users }
```

`step?: string` is added to `StepDef` + format-schema (as one of the mutually-exclusive type keys). The registry resolves `def.step` to the registered custom type by its `name`. A custom type implements the standard `StepType` interface and receives the full `StepContext` (provider, `runChildren`, `prompt`, `loadModule`, etc.). Invoking an unregistered `step:` name is a clear load-time error.

### B.4 Validation

The format-schema's "exactly one type key" refine adds `step` (and `widget`) to its key set, keeping the schema closed. Custom plugins do NOT inject arbitrary top-level keys — they are always invoked via `step:`.

---

## Data flow (per run)

1. `runWorkflow(path)` → `prepareEnv(path)` (auto-install, resolve provided set).
2. Build `createLoader({ baseDir, provided })`.
3. `buildDefaultRegistry()` → load + register declared plugins.
4. Execute phases as today; user-code loads (schemas, `run`/`uses`, custom steps) go through the loader; `widget` steps send UI requests the App fulfils via the loader.

## Error handling

- Missing/failed `npm` install → fail fast with the npm output.
- Provided alias resolution failure (plyflow's copy not found) → clear error naming the module.
- Widget/plugin module missing default export of the right shape → clear error with the path.
- Non-TTY widget/input without `default:` → clear error.
- Unregistered `step:` name → clear error listing available custom step names.

## Testing strategy

- **C:** `module-loader` resolves a provided `zod` to plyflow's instance (assert `instanceof` works across a loaded schema); `workflow-env` auto-installs when deps missing and skips when present (fake `exec`); `plyflow.provided`/`plyflow.plugins` parsed from a fixture package.json. Refactor `schema/load.ts` to the loader + `instanceof`, keeping its tests green.
- **A:** `widget` step sends the right UI request; the App mounts a fixture widget and resolves its value (`ink-testing-library`); non-TTY uses `default:` / errors. `input` gains `default:` + a test.
- **B:** a fixture plugin (StepType and register-fn forms) registers and runs via `step:`; unregistered name errors; format-schema accepts `step`/`widget` and still enforces one-type-key.
- Full suite + build + lint + built-binary smoke stay green on Node 24.

## File structure (additions)

```
src/core/module-loader.ts        # createLoader + DEFAULT_PROVIDED
src/core/workflow-env.ts         # prepareEnv (auto-install, provided resolution)
src/steps/widget.ts              # widget step type
src/core/plugins.ts              # load + register workflow plugins
# modified: src/schema/load.ts (use loader + instanceof), src/steps/run.ts (use loader),
#   src/steps/input.ts (+default), src/tui/App.tsx (mount widgets), src/steps/types.ts
#   (UiRequest union + ctx.loadModule), src/core/types.ts + format-schema.ts (widget/step/default/plugins),
#   src/core/engine.ts (prepareEnv + loader + plugins wiring)
examples/widgets/…               # example widget + workflow
examples/plugins/…               # example plugin + workflow
```

## Future work

- A `plyflow init` scaffolder for a workflow dir (package.json + example widget/plugin).
- Workflow-scoped MCP servers as provided capabilities.
- Streaming widget updates from long-running steps (progress widgets).
- Optional sandboxing tier for untrusted workflows.
