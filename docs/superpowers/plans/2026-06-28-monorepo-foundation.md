# Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the single `plyflow` package into a pnpm + Changesets monorepo publishing `@plyflow/core`, `@plyflow/tui`, `@plyflow/cli`, and a `plyflow` meta-package — with the existing behaviour and test suite fully green — so later feature plans (sh step, inputs/stdlib, sub-workflows, dry-run/testing, plugin-by-specifier) and the Spec B plugin packs have a home.

**Architecture:** This is a *refactor*, not a feature. Source moves wholesale into `packages/<pkg>/src`; intra-package relative `.js` imports are unchanged (files move together); only the handful of cross-layer imports (`tui`/`cli` → core internals) are rewritten to `@plyflow/core` subpath imports. The gate for every task is "build + existing tests still green," not test-first — the existing vitest suite is the regression net.

**Tech Stack:** pnpm workspaces, Changesets (`@changesets/cli`), tsdown (replacing tsup), vitest, TypeScript, ESM (`nodenext`-style `.js` import extensions), Node ≥24.

## Global Constraints

- **Node ≥24**, ESM (`"type": "module"`) everywhere. Copy verbatim into each package.json: `"engines": { "node": ">=24" }`.
- **Relative imports keep the `.js` extension** in `.ts` source (intra-package). Cross-package imports use the bare specifier `@plyflow/core` (no extension).
- **Scoped packages are public:** every published package sets `"publishConfig": { "access": "public" }`.
- **Internal deps use `workspace:*`** and are published via `pnpm publish` (which rewrites the protocol). Never raw-`npm publish` a copied `dist/`.
- **Test gate is vitest** (`pnpm -r test`), not `tsc --noEmit` (the repo has pre-existing tsc errors; do not let the migration add *new* ones).
- **`@plyflow/testing` is intentionally NOT created here** — its real content (`fakeProvider`, `mockExec`) belongs to the dry-run feature plan (Spec A4). This plan delivers core/tui/cli/meta.
- **Do not change runtime behaviour.** No logic edits beyond import-path rewrites and package wiring.

---

## File Structure (end state of this plan)

```
pnpm-workspace.yaml            # packages/*, plugins/*
package.json                   # private root: shared devDeps + orchestration scripts
.npmrc                         # pnpm settings
tsconfig.base.json             # shared compilerOptions + customConditions
.changeset/config.json         # Changesets config
.github/workflows/release.yml  # Changesets release workflow

packages/
  core/
    package.json               # @plyflow/core; subpath exports; deps: anthropic, yaml, zod, jiti, tar, gray-matter
    tsdown.config.ts           # named entries: index, module-loader, remote, remote/trust
    tsconfig.json              # extends ../../tsconfig.base.json
    src/
      index.ts                 # public barrel (moved from src/index.ts)
      smoke.test.ts            # moved from src/smoke.test.ts
      core/  providers/  steps/  schema/   # moved verbatim from src/*
  tui/
    package.json               # @plyflow/tui; dep: @plyflow/core (workspace:*), ink, react
    tsdown.config.ts
    tsconfig.json
    src/                       # moved from src/tui/* ; core imports rewritten to @plyflow/core
  cli/
    package.json               # @plyflow/cli; bin: plyflow; deps: @plyflow/core, @plyflow/tui
    tsdown.config.ts
    tsconfig.json
    src/                       # moved from src/cli/* ; core imports rewritten to @plyflow/core[/subpath]
  meta/
    package.json               # plyflow; re-exports @plyflow/core API; bin → @plyflow/cli
    src/index.ts               # export * from '@plyflow/core'
    bin.js                     # shim → @plyflow/cli

examples/  website/            # unchanged dirs; example test imports rewired to @plyflow/core
```

**Cross-package import map (the only import edits needed):**

| Importer | Old (`../…`) | New |
|---|---|---|
| tui | `../core/engine.js` | `@plyflow/core` |
| tui | `../core/types.js` | `@plyflow/core` |
| tui | `../steps/types.js` | `@plyflow/core` |
| tui | `../core/module-loader.js` | `@plyflow/core/module-loader` |
| cli | `../core/engine.js`, `../core/loader.js`, `../providers/factory.js`, `../steps/types.js` | `@plyflow/core` |
| cli | `../core/remote/index.js` | `@plyflow/core/remote` |
| cli | `../core/remote/trust.js` | `@plyflow/core/remote/trust` |

`@plyflow/core` therefore exposes four entry points: `.` (barrel), `./module-loader`, `./remote`, `./remote/trust`.

---

## Task 1: Workspace scaffold + tooling swap

**Files:**
- Create: `pnpm-workspace.yaml`, `.npmrc`, `.changeset/config.json`, `tsconfig.base.json`
- Modify: `package.json` (convert to private root)
- Delete: `tsup.config.ts`

**Interfaces:**
- Produces: a pnpm workspace whose root holds shared devDeps (typescript, vitest, eslint, tsdown, tsx, @changesets/cli) and orchestration scripts (`pnpm -r …`). Later tasks add package globs under `packages/*`.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'plugins/*'
```

- [ ] **Step 2: Create `.npmrc`**

```text
link-workspace-packages=true
prefer-workspace-packages=true
```

- [ ] **Step 3: Create `tsconfig.base.json`** (existing compilerOptions + the dev source condition)

```jsonc
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2024"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "customConditions": ["@plyflow/source"]
  }
}
```

- [ ] **Step 4: Create `.changeset/config.json`**

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 5: Replace root `package.json` with a private root**

```json
{
  "name": "plyflow-monorepo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "packageManager": "pnpm@11.9.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test && vitest run --config vitest.examples.config.ts",
    "test:watch": "vitest",
    "lint": "pnpm -r lint",
    "dev": "tsx packages/cli/src/index.ts",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "pnpm -r build && changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.31.0",
    "@eslint/js": "^10.0.1",
    "@types/node": "^26.0.1",
    "eslint": "^10.6.0",
    "tsdown": "^0.22.3",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.62.0",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 6: Delete `tsup.config.ts`**

```bash
git rm tsup.config.ts
```

- [ ] **Step 7: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error; creates `pnpm-lock.yaml`. (No packages yet, so nothing builds — that's fine.)

- [ ] **Step 8: Commit**

```bash
git rm package-lock.json
git add pnpm-workspace.yaml .npmrc tsconfig.base.json .changeset/config.json package.json pnpm-lock.yaml
git commit -m "chore: scaffold pnpm workspace + changesets, drop tsup/npm-lock"
```

---

## Task 2: `@plyflow/core` package

**Files:**
- Move: `src/index.ts` → `packages/core/src/index.ts`; `src/smoke.test.ts` → `packages/core/src/smoke.test.ts`; `src/core/` → `packages/core/src/core/`; `src/providers/` → `packages/core/src/providers/`; `src/steps/` → `packages/core/src/steps/`; `src/schema/` → `packages/core/src/schema/`
- Create: `packages/core/package.json`, `packages/core/tsdown.config.ts`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`

**Interfaces:**
- Produces entry points consumed by tui/cli/meta:
  - `@plyflow/core` → barrel (`runWorkflow`, `loadWorkflow`, `loadAgent`, `makeProvider`, `ClaudeProvider`, `FakeProvider`, `StepRegistry`, types `EngineEvent`, `RunOptions`, `WorkflowFile`, `StepDef`, `StepContext`, `StepType`, `UiRequest`, …)
  - `@plyflow/core/module-loader` → re-exports `src/core/module-loader.ts`
  - `@plyflow/core/remote` → re-exports `src/core/remote/index.ts` (`resolveWorkflowSource`, `RemoteFetchError`, type `ResolvedSource`)
  - `@plyflow/core/remote/trust` → re-exports `src/core/remote/trust.ts` (`hashDir`, `isTrusted`, `recordTrust`, `trustKey`)

- [ ] **Step 1: Move the source (preserves git history; intra-package relative imports stay valid)**

```bash
mkdir -p packages/core/src
git mv src/index.ts packages/core/src/index.ts
git mv src/smoke.test.ts packages/core/src/smoke.test.ts
git mv src/core packages/core/src/core
git mv src/providers packages/core/src/providers
git mv src/steps packages/core/src/steps
git mv src/schema packages/core/src/schema
```

- [ ] **Step 2: Create `packages/core/package.json`**

```json
{
  "name": "@plyflow/core",
  "version": "0.3.0",
  "description": "plyflow workflow engine (loader, scheduler, steps, providers).",
  "type": "module",
  "engines": { "node": ">=24" },
  "publishConfig": { "access": "public" },
  "exports": {
    ".": { "@plyflow/source": "./src/index.ts", "default": "./dist/index.js" },
    "./module-loader": { "@plyflow/source": "./src/core/module-loader.ts", "default": "./dist/module-loader.js" },
    "./remote": { "@plyflow/source": "./src/core/remote/index.ts", "default": "./dist/remote.js" },
    "./remote/trust": { "@plyflow/source": "./src/core/remote/trust.ts", "default": "./dist/remote/trust.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.183",
    "@anthropic-ai/sdk": "^0.105.0",
    "gray-matter": "^4.0.3",
    "jiti": "^2.7.0",
    "tar": "^7.5.16",
    "yaml": "^2.9.0",
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 3: Create `packages/core/tsdown.config.ts`** (named entries map to the export paths above)

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'module-loader': 'src/core/module-loader.ts',
    remote: 'src/core/remote/index.ts',
    'remote/trust': 'src/core/remote/trust.ts',
  },
  format: ['esm'],
  target: 'node24',
  dts: true,
  sourcemap: true,
  clean: true,
});
```

- [ ] **Step 4: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
```

- [ ] **Step 6: Install workspace deps**

Run: `pnpm install`
Expected: `@plyflow/core` is linked into the workspace; no errors.

- [ ] **Step 7: Build core**

Run: `pnpm --filter @plyflow/core build`
Expected: produces `packages/core/dist/index.js`, `dist/module-loader.js`, `dist/remote.js`, `dist/remote/trust.js` (+ `.d.ts`), exits 0.

- [ ] **Step 8: Run core tests**

Run: `pnpm --filter @plyflow/core test`
Expected: the moved core/providers/steps/remote/schema suites pass (same count as before the move).

- [ ] **Step 9: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "refactor(core): extract @plyflow/core package"
```

---

## Task 3: `@plyflow/tui` package

**Files:**
- Move: `src/tui/` → `packages/tui/src/`
- Create: `packages/tui/package.json`, `packages/tui/tsdown.config.ts`, `packages/tui/tsconfig.json`, `packages/tui/vitest.config.ts`
- Modify: every tui file importing core internals (rewrite per the import map)

**Interfaces:**
- Consumes from `@plyflow/core`: `runWorkflow`, type `EngineEvent`, workflow/step types, `UiRequest`; and `@plyflow/core/module-loader`.
- Produces: `@plyflow/tui` exposing `App` (Ink component) and `LineLogger`.

- [ ] **Step 1: Move the source**

```bash
mkdir -p packages/tui
git mv src/tui packages/tui/src
```

- [ ] **Step 2: Rewrite cross-package imports in tui**

Replace in `packages/tui/src/**`:
- `from '../core/engine.js'` → `from '@plyflow/core'`
- `from '../core/types.js'` → `from '@plyflow/core'`
- `from '../steps/types.js'` → `from '@plyflow/core'`
- `from '../core/module-loader.js'` → `from '@plyflow/core/module-loader'`

Run to find every occurrence:
```bash
grep -rn "from '\.\./\(core\|steps\)/" packages/tui/src
```
Expected after edits: that grep returns nothing.

- [ ] **Step 3: Create `packages/tui/package.json`**

```json
{
  "name": "@plyflow/tui",
  "version": "0.3.0",
  "description": "plyflow Ink/React terminal UI.",
  "type": "module",
  "engines": { "node": ">=24" },
  "publishConfig": { "access": "public" },
  "exports": { ".": { "@plyflow/source": "./src/index.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": { "build": "tsdown", "test": "vitest run", "lint": "eslint src" },
  "dependencies": {
    "@plyflow/core": "workspace:*",
    "ink": "^7.1.0",
    "react": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "ink-testing-library": "^4.0.0",
    "react-devtools-core": "^6.1.2"
  }
}
```

- [ ] **Step 4: Create `packages/tui/src/index.ts`** (barrel — export the public TUI surface)

```ts
export { App } from './App.js';
export { LineLogger } from './logger.js';
```

- [ ] **Step 5: Create `packages/tui/tsdown.config.ts`**

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node24',
  dts: true,
  sourcemap: true,
  clean: true,
});
```

- [ ] **Step 6: Create `packages/tui/tsconfig.json`** and `packages/tui/vitest.config.ts`

`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist" }, "include": ["src"] }
```
`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] } });
```

- [ ] **Step 7: Install, build, test**

Run: `pnpm install && pnpm --filter @plyflow/tui build && pnpm --filter @plyflow/tui test`
Expected: core resolves via `@plyflow/source` condition (live types); tui builds; the moved tui tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/tui pnpm-lock.yaml
git commit -m "refactor(tui): extract @plyflow/tui package"
```

---

## Task 4: `@plyflow/cli` package

**Files:**
- Move: `src/cli/` → `packages/cli/src/`
- Create: `packages/cli/package.json`, `packages/cli/tsdown.config.ts`, `packages/cli/tsconfig.json`, `packages/cli/vitest.config.ts`
- Modify: cli files importing core/tui internals (rewrite per the import map)

**Interfaces:**
- Consumes: `@plyflow/core` (`runWorkflow`, `loadWorkflow`, `makeProvider`, type `EngineEvent`, `UiRequest`), `@plyflow/core/remote`, `@plyflow/core/remote/trust`, `@plyflow/tui` (`App`, `LineLogger`).
- Produces: the `plyflow` bin entry at `packages/cli/dist/index.js`.

- [ ] **Step 1: Move the source**

```bash
mkdir -p packages/cli
git mv src/cli packages/cli/src
```

- [ ] **Step 2: Rewrite cross-package imports in cli**

Replace in `packages/cli/src/**`:
- `from '../core/engine.js'` → `from '@plyflow/core'`
- `from '../core/loader.js'` → `from '@plyflow/core'`
- `from '../providers/factory.js'` → `from '@plyflow/core'`
- `from '../steps/types.js'` → `from '@plyflow/core'`
- `from '../core/remote/index.js'` → `from '@plyflow/core/remote'`
- `from '../core/remote/trust.js'` → `from '@plyflow/core/remote/trust'`
- `from '../tui/logger.js'` → `from '@plyflow/tui'`
- `from '../tui/App.js'` → `from '@plyflow/tui'`

Run to confirm none remain:
```bash
grep -rn "from '\.\./\(core\|providers\|steps\|tui\)/" packages/cli/src
```
Expected: returns nothing.

- [ ] **Step 3: Create `packages/cli/package.json`**

```json
{
  "name": "@plyflow/cli",
  "version": "0.3.0",
  "description": "plyflow command-line interface.",
  "type": "module",
  "engines": { "node": ">=24" },
  "publishConfig": { "access": "public" },
  "bin": { "plyflow": "./dist/index.js" },
  "files": ["dist"],
  "scripts": { "build": "tsdown", "test": "vitest run", "lint": "eslint src" },
  "dependencies": {
    "@plyflow/core": "workspace:*",
    "@plyflow/tui": "workspace:*"
  }
}
```

- [ ] **Step 4: Create `packages/cli/tsdown.config.ts`** (preserve the executable shebang/entry)

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node24',
  dts: false,
  sourcemap: true,
  clean: true,
});
```

- [ ] **Step 5: Create `packages/cli/tsconfig.json`** and `packages/cli/vitest.config.ts` (same shape as Task 3 Step 6).

- [ ] **Step 6: Install, build, test**

Run: `pnpm install && pnpm --filter @plyflow/cli build && pnpm --filter @plyflow/cli test`
Expected: builds `packages/cli/dist/index.js`; the moved `args.test.ts` and `trust-prompt.test.ts` pass.

- [ ] **Step 7: Smoke-test the built CLI**

Run: `node packages/cli/dist/index.js --help`
Expected: prints usage (same output as the pre-migration CLI).

- [ ] **Step 8: Commit**

```bash
git add packages/cli pnpm-lock.yaml
git commit -m "refactor(cli): extract @plyflow/cli package"
```

---

## Task 5: `plyflow` meta-package

**Files:**
- Create: `packages/meta/package.json`, `packages/meta/src/index.ts`, `packages/meta/bin.js`, `packages/meta/tsdown.config.ts`, `packages/meta/tsconfig.json`

**Interfaces:**
- Consumes: `@plyflow/core` (re-exported as the library API), `@plyflow/cli` (for the bin).
- Produces: the user-facing `plyflow` package — `import … from 'plyflow'` and `npx plyflow` keep working.

- [ ] **Step 1: Create `packages/meta/src/index.ts`** (library surface = core's barrel)

```ts
export * from '@plyflow/core';
```

- [ ] **Step 2: Create `packages/meta/bin.js`** (delegate the CLI to `@plyflow/cli`)

```js
#!/usr/bin/env node
import '@plyflow/cli';
```

- [ ] **Step 3: Create `packages/meta/package.json`**

```json
{
  "name": "plyflow",
  "version": "0.3.0",
  "description": "Run AI agent workflows defined in YAML, with an interactive terminal UI.",
  "type": "module",
  "engines": { "node": ">=24" },
  "publishConfig": { "access": "public" },
  "bin": { "plyflow": "./bin.js" },
  "exports": { ".": { "@plyflow/source": "./src/index.ts", "default": "./dist/index.js" } },
  "files": ["dist", "bin.js"],
  "scripts": { "build": "tsdown", "test": "vitest run --passWithNoTests", "lint": "eslint src" },
  "dependencies": {
    "@plyflow/core": "workspace:*",
    "@plyflow/cli": "workspace:*"
  }
}
```

- [ ] **Step 4: Create `packages/meta/tsdown.config.ts`** and `packages/meta/tsconfig.json` (same shape as Task 2 Steps 3–4, entry `{ index: 'src/index.ts' }`, `dts: true`).

- [ ] **Step 5: Install and build the whole workspace**

Run: `pnpm install && pnpm -r build`
Expected: all four packages build in dependency order, exit 0.

- [ ] **Step 6: Verify the meta library surface re-exports core**

Run:
```bash
node --input-type=module -e "import { runWorkflow } from './packages/meta/dist/index.js'; console.log(typeof runWorkflow)"
```
Expected: prints `function`.

- [ ] **Step 7: Commit**

```bash
git add packages/meta pnpm-lock.yaml
git commit -m "feat(meta): add plyflow meta-package (keeps existing install path)"
```

---

## Task 6: Re-wire example tests + root example runner

**Files:**
- Create: `vitest.examples.config.ts` (root)
- Modify: `examples/**/*.test.ts` imports that reference the old `src/` paths or `plyflow` internals
- Modify: root `package.json` devDependency on the workspace (so examples resolve `@plyflow/core`)

**Interfaces:**
- Consumes: `@plyflow/core` (and `@plyflow/testing` later, not here).
- Produces: `pnpm test` green across packages *and* examples.

- [ ] **Step 1: Find how example tests currently import the engine**

Run: `grep -rn "from '" examples --include='*.test.ts' | grep -E "src/|plyflow|\.\./\.\." | sort -u`
Expected: a small list of imports pointing at the old single-package layout.

- [ ] **Step 2: Rewrite those imports to `@plyflow/core`**

For each match from Step 1, replace the engine/loader/provider import with the `@plyflow/core` barrel (or `@plyflow/core/remote` for remote symbols), mirroring the Task 2 interface list.

- [ ] **Step 3: Add the workspace packages as root devDeps so examples resolve them**

In root `package.json` add:
```json
"devDependencies": {
  "@plyflow/core": "workspace:*",
  "@plyflow/testing": "workspace:*"
}
```
(Remove the `@plyflow/testing` line if the dry-run feature plan has not yet created that package; add it back then.)

- [ ] **Step 4: Create `vitest.examples.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['examples/**/*.test.ts'] },
});
```

- [ ] **Step 5: Run the full gate**

Run: `pnpm install && pnpm test`
Expected: `pnpm -r test` (core/tui/cli/meta) green, then the examples suite green. Total test count matches pre-migration minus any tests intentionally relocated.

- [ ] **Step 6: Commit**

```bash
git add examples vitest.examples.config.ts package.json pnpm-lock.yaml
git commit -m "test: run example suites against @plyflow/core in the workspace"
```

---

## Task 7: Release workflow + docs

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `AGENTS.md` (commands table + architecture map → monorepo paths)

**Interfaces:**
- Produces: a CI path that versions/publishes changed `@plyflow/*` packages on merge to `main`.

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    branches: [main]
permissions:
  contents: write
  pull-requests: write
  id-token: write   # npm OIDC trusted publishing
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - uses: changesets/action@v1
        with:
          version: pnpm version-packages
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Fallback if OIDC trusted publishing of scoped pkgs hits E404:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Add a changeset for the restructure**

Run: `pnpm changeset`
Select all four packages, **minor** bump, summary: "Restructure into @plyflow/* monorepo packages." This writes a `.changeset/*.md` intent file.

- [ ] **Step 3: Update `AGENTS.md`**

In the Commands table, replace single-package commands with monorepo equivalents:

| Task | Command |
|------|---------|
| Run all tests | `pnpm test` |
| Test one package | `pnpm --filter @plyflow/core test` |
| Build all | `pnpm -r build` |
| Run the CLI from source | `pnpm dev -- run <file.yaml>` |
| Add a changeset | `pnpm changeset` |

In the Architecture map, repoint `src/cli`, `src/core`, `src/tui` to `packages/cli/src`, `packages/core/src`, `packages/tui/src`, and note `plugins/` is reserved for Spec B packs.

- [ ] **Step 4: Verify the full gate one more time**

Run: `pnpm install && pnpm -r build && pnpm test`
Expected: build + all tests green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml .changeset AGENTS.md
git commit -m "ci+docs: changesets release workflow; document monorepo layout"
```

---

## Self-Review

**Spec coverage (Spec A, Part 1 — monorepo):**
- pnpm workspaces → Task 1. Changesets → Tasks 1, 7. tsdown (off tsup) → Tasks 1–5. `packages/`+`plugins/` layout → Task 1 (`pnpm-workspace.yaml`). Finer split (core/cli/tui) + `plyflow` meta → Tasks 2–5. `workspace:*` + `publishConfig.access` → Tasks 2–5. Live-types export condition → `tsconfig.base.json` (Task 1) + per-package `exports` (Tasks 2–5). ESM `.js` extensions preserved → only cross-package edges rewritten (Tasks 3–4). OIDC + token fallback → Task 7. Migration approach (move src, fix imports, port tests) → Tasks 2–6. ✅
- **`@plyflow/testing`** (Spec A package set) is **deferred to the Spec A4 feature plan** by design (its content is the dry-run feature) — noted in Global Constraints and Task 6 Step 3. The four core features (sh step, inputs/stdlib, sub-workflows, dry-run, plugin-by-specifier) are **out of scope for this foundation plan** and get their own plans. This is intentional decomposition, not a coverage gap.

**Placeholder scan:** No "TBD/TODO/handle edge cases" steps; every file has concrete content; every command has an expected result. ✅

**Type/name consistency:** Cross-package import targets match the four `@plyflow/core` entry points declared in Task 2 (`.`, `/module-loader`, `/remote`, `/remote/trust`); tui consumes `App`/`LineLogger` produced by the Task 3 barrel; cli consumes those plus the core barrel; meta re-exports the core barrel. Package names (`@plyflow/core|tui|cli`, `plyflow`) are consistent throughout. ✅

**Toolchain versions (resolved to latest at 2026-06-28, per user request "use latest tools"):** pnpm `11.9.0` (root `packageManager` + corepack), `tsdown ^0.22.3`, `@changesets/cli ^2.31.0`, `typescript ^6.0.3`, `eslint ^10.6.0`, `@eslint/js ^10.0.1`, `typescript-eslint ^8.62.0`, `@types/node ^26.0.1`, `vitest ^4.1.9`, `tsx ^4.22.4`, `changesets/action@v1`. Node pinned to `24.18.0` via `.nvmrc`. **Runtime dependencies** (`@anthropic-ai/*`, `ink`, `react`, `yaml`, `zod`, `jiti`, `tar`, `gray-matter`) are left at their existing versions — "latest tools" scopes to the build/test/release toolchain, not runtime libraries whose major bumps could change behaviour.
