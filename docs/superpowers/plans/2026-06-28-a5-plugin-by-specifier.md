# A5 — Plugin-by-Specifier Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workflow reference plugins by **bare package specifier** — `plugins: ['@plyflow/git']` (or `package.json` `plyflow.plugins`) — not just relative paths. This is the one core change Spec B's `@plyflow/git` / `@plyflow/github` packs depend on.

**Architecture:** Today both the engine's plugin-path mapping (`engine.ts`) and the module loader (`module-loader.ts`) force every non-absolute entry to `resolvePath(baseDir, …)`, which mangles a bare specifier into `baseDir/@plyflow/git`. The fix distinguishes three kinds of reference: **absolute** (use as-is), **relative** (`./`, `../` → resolve against the workflow dir, unchanged behaviour), and **bare specifier** (resolve via Node module resolution from the workflow dir, so it's found in the workflow's `node_modules`). The plugin contract (`StepType` / register-function) is unchanged.

**Tech Stack:** TypeScript ESM (Node ≥24), vitest. pnpm monorepo; all A5 work is in `packages/core`.

## Global Constraints

- **Node ≥24, ESM.** Relative imports keep `.js` extensions. `node -v` must be v24.x (`source "$HOME/.nvm/nvm.sh" && nvm use 24.18.0` if it shows v20).
- **Test gate is vitest**; CI runs `pnpm -r lint` (`no-unused-vars: error`), `pnpm -r build`, `pnpm test`.
- **TDD:** failing test first, watch fail, minimal impl, watch pass, commit.
- **Bare-specifier resolution is from the WORKFLOW dir** (`baseDir`), where the workflow's `package.json` deps are installed — NOT plyflow's own `node_modules`. Use `createRequire` based at `baseDir`.
- **No behaviour change for relative/absolute plugin paths** — existing `./steps/uppercase.ts`-style plugins must keep working byte-for-byte.
- **A "bare specifier"** is a reference that is not absolute and does not start with `./` or `../`. (Covers `pkg`, `@scope/pkg`, and `@scope/pkg/subpath`.)
- All work is in `packages/core`.

---

## File Structure

```text
packages/core/src/core/
  module-loader.ts        # MODIFY: import() resolves bare specifiers via Node resolution from baseDir
  module-loader.test.ts   # MODIFY/CREATE: bare-specifier resolution + relative unchanged + missing throws
  plugin-ref.ts           # NEW: resolvePluginRef(dir, ref) — relative→abs, bare→passthrough
  plugin-ref.test.ts      # NEW
  engine.ts               # MODIFY: use resolvePluginRef for the plugin path mapping
website/docs/extensibility/plugins.md   # MODIFY: document declaring plugins by package name
AGENTS.md                 # MODIFY: note plugin-by-specifier
```

**Interfaces produced:**

```ts
// core/plugin-ref.ts
export function resolvePluginRef(dir: string, ref: string): string;
//   absolute → ref; './'|'../' → resolvePath(dir, ref); else (bare) → ref unchanged (loader resolves it)

// module-loader.ts — import() gains bare-specifier handling:
//   absolute → as-is; relative → resolvePath(baseDir, path); bare → createRequire(baseDir).resolve(path)
```

---

## Task 1: Module loader resolves bare specifiers from `baseDir`

**Files:**
- Modify: `packages/core/src/core/module-loader.ts` (the `import(path)` method)
- Test: `packages/core/src/core/module-loader.test.ts` (create if absent; else add cases)

**Interfaces:**
- Produces: `loader.import('<bare-specifier>')` resolves the specifier from `baseDir`'s `node_modules` (via `createRequire`) and loads it; relative/absolute paths behave exactly as before; a missing bare specifier throws a clear error naming the specifier and the dir.

- [ ] **Step 1: Write the failing test** — `packages/core/src/core/module-loader.test.ts` (add to existing if present)

```ts
import { describe, it, expect } from 'vitest';
import { createLoader } from './module-loader.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This test file's own directory has node_modules reachable up to the repo root,
// where 'yaml' (a @plyflow/core dependency, NOT in the provided/virtualModules set)
// is installed — so it exercises real bare-specifier resolution.
const here = dirname(fileURLToPath(import.meta.url));

describe('createLoader bare-specifier resolution', () => {
  it('resolves a bare specifier from baseDir node_modules', async () => {
    const loader = createLoader({ baseDir: here });
    const mod = (await loader.import('yaml')) as { parse?: unknown };
    expect(typeof mod.parse).toBe('function');
  });

  it('throws a clear error for a bare specifier that is not installed', async () => {
    const loader = createLoader({ baseDir: here });
    await expect(loader.import('@plyflow/definitely-not-installed')).rejects.toThrow(
      /@plyflow\/definitely-not-installed/,
    );
  });
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter @plyflow/core test -- module-loader`
Expected: FAIL — `import('yaml')` currently becomes `resolvePath(baseDir, 'yaml')` → a non-existent file path → load error (not the real `yaml` package).

- [ ] **Step 3: Implement** in `packages/core/src/core/module-loader.ts`:
  - Add to the imports: `import { createRequire } from 'node:module';` and ensure `resolve as resolvePath, isAbsolute` are imported from `node:path` (they already are).
  - Add a small helper above `createLoader` (or inside it):
    ```ts
    function isRelative(p: string): boolean {
      return p.startsWith('./') || p.startsWith('../');
    }
    ```
  - Replace the body of the `import(path)` method so a bare specifier is resolved via Node resolution from `baseDir`:
    ```ts
    async import(path: string): Promise<unknown> {
      let abs: string;
      if (isAbsolute(path) || isRelative(path)) {
        abs = isAbsolute(path) ? path : resolvePath(opts.baseDir, path);
      } else {
        // Bare specifier (pkg | @scope/pkg | @scope/pkg/subpath): resolve from the
        // workflow dir's node_modules, where the workflow's deps are installed.
        const req = createRequire(resolvePath(opts.baseDir, 'noop.js'));
        try {
          abs = req.resolve(path);
        } catch {
          throw new Error(
            `Cannot resolve module "${path}" from "${opts.baseDir}". ` +
              `Declare it in the workflow's package.json dependencies so it is installed.`,
          );
        }
      }
      const load = await ensureJiti();
      return load(abs);
    }
    ```
  (The `createRequire` base file `noop.js` need not exist — Node uses its directory as the resolution root.)

- [ ] **Step 4: Run, watch pass**

Run: `pnpm --filter @plyflow/core test -- module-loader`
Expected: PASS.

- [ ] **Step 5: Full core suite (relative/absolute loads unchanged — many tests load `./` modules)**

Run: `pnpm --filter @plyflow/core test && pnpm --filter @plyflow/core lint`
Expected: all pass; lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core/module-loader.ts packages/core/src/core/module-loader.test.ts
git commit -m "feat(core): module loader resolves bare specifiers from the workflow dir"
```

---

## Task 2: `resolvePluginRef` — don't path-join bare plugin specifiers

**Files:**
- Create: `packages/core/src/core/plugin-ref.ts`
- Create: `packages/core/src/core/plugin-ref.test.ts`
- Modify: `packages/core/src/core/engine.ts` (use it in the plugin path mapping)

**Interfaces:**
- Produces: `resolvePluginRef(dir, ref)` — absolute → `ref`; `./`/`../` → `resolvePath(dir, ref)`; bare → `ref` unchanged (the loader resolves it in Task 1). The engine maps `[…env.plugins, …wf.plugins]` through it (still deduped).

- [ ] **Step 1: Write the failing test** — `packages/core/src/core/plugin-ref.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolvePluginRef } from './plugin-ref.js';
import { isAbsolute, resolve } from 'node:path';

describe('resolvePluginRef', () => {
  it('resolves relative refs against the dir', () => {
    const out = resolvePluginRef('/wf', './steps/up.ts');
    expect(isAbsolute(out)).toBe(true);
    expect(out).toBe(resolve('/wf', './steps/up.ts'));
  });
  it('resolves ../ refs against the dir', () => {
    expect(resolvePluginRef('/wf/sub', '../p.ts')).toBe(resolve('/wf/sub', '../p.ts'));
  });
  it('passes a bare package specifier through unchanged', () => {
    expect(resolvePluginRef('/wf', '@plyflow/git')).toBe('@plyflow/git');
    expect(resolvePluginRef('/wf', 'some-plugin')).toBe('some-plugin');
    expect(resolvePluginRef('/wf', '@scope/pkg/sub')).toBe('@scope/pkg/sub');
  });
  it('leaves an absolute path unchanged', () => {
    expect(resolvePluginRef('/wf', '/abs/p.ts')).toBe('/abs/p.ts');
  });
});
```

- [ ] **Step 2: Run, watch fail** — `pnpm --filter @plyflow/core test -- plugin-ref` (module missing).

- [ ] **Step 3: Implement** `packages/core/src/core/plugin-ref.ts`:

```ts
import { isAbsolute, resolve as resolvePath } from 'node:path';

/**
 * Resolve a plugin reference for loading. Relative refs (`./`, `../`) are made
 * absolute against the workflow dir; absolute refs pass through; a bare package
 * specifier (`pkg`, `@scope/pkg`, `@scope/pkg/sub`) passes through unchanged so
 * the module loader can resolve it from the workflow's node_modules.
 */
export function resolvePluginRef(dir: string, ref: string): string {
  if (isAbsolute(ref)) return ref;
  if (ref.startsWith('./') || ref.startsWith('../')) return resolvePath(dir, ref);
  return ref;
}
```

- [ ] **Step 4: Run, watch pass** — `pnpm --filter @plyflow/core test -- plugin-ref`.

- [ ] **Step 5: Wire into `engine.ts`.** Replace the plugin-path mapping:
  - Add the import: `import { resolvePluginRef } from './plugin-ref.js';`
  - Change
    ```ts
    const pluginPaths = Array.from(
      new Set(
        [...env.plugins, ...(wf.plugins ?? [])].map((p) => pathResolve(env.dir, p)),
      ),
    );
    ```
    to
    ```ts
    const pluginPaths = Array.from(
      new Set(
        [...env.plugins, ...(wf.plugins ?? [])].map((p) => resolvePluginRef(env.dir, p)),
      ),
    );
    ```
  - If the `pathResolve`/`node:path` dynamic import (`const { resolve: pathResolve } = await import('node:path');`) is now unused elsewhere in the function, remove it to keep lint clean; otherwise leave it.

- [ ] **Step 6: Full core suite + lint**

Run: `pnpm --filter @plyflow/core test && pnpm --filter @plyflow/core lint`
Expected: all pass; lint clean (existing relative-path plugin tests still pass via `resolvePluginRef`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/core/plugin-ref.ts packages/core/src/core/plugin-ref.test.ts packages/core/src/core/engine.ts
git commit -m "feat(core): resolve workflow plugins by bare package specifier"
```

---

## Task 3: End-to-end + docs

**Files:**
- Test: `packages/core/src/core/plugin-specifier.e2e.test.ts`
- Modify: `website/docs/extensibility/plugins.md`, `AGENTS.md`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: a green proof that a workflow loads a plugin declared by **package name** (resolved from the workflow dir's `node_modules`).

- [ ] **Step 1: Write the failing e2e** — `packages/core/src/core/plugin-specifier.e2e.test.ts` (sets up a temp workflow dir with a fake plugin package installed under its `node_modules`)

```ts
import { it, expect } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('loads a plugin declared by bare package specifier from node_modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-pkgplugin-'));
  // Fake installed plugin package: node_modules/shout-plugin
  const pkgDir = join(dir, 'node_modules', 'shout-plugin');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'shout-plugin', type: 'module', main: 'index.js' }));
  writeFileSync(
    join(pkgDir, 'index.js'),
    [
      'export default {',
      '  name: "shout",',
      '  match: (def) => def.step === "shout",',
      '  parse: (def) => ({ text: def.with?.text ?? "" }),',
      '  run: async (cfg) => ({ output: String(cfg.text).toUpperCase() }),',
      '};',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'w.yaml'),
    [
      'name: w',
      'plugins:',
      '  - shout-plugin',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: s',
      '        step: shout',
      '        with: { text: hello }',
    ].join('\n'),
  );
  const res = await runWorkflow(join(dir, 'w.yaml'), { provider: new FakeProvider([]), isTty: false });
  expect(res.outputs.s).toBe('HELLO');
});
```

- [ ] **Step 2: Run, watch it pass (or adjust)**

Run: `pnpm --filter @plyflow/core test -- plugin-specifier`
Expected: PASS. If `prepareEnv` complains about the temp dir having a `node_modules` but no `package.json`, add a minimal `package.json` (`{ "name": "wf", "type": "module" }`) to the temp dir. Adjust and confirm green before locking.

- [ ] **Step 3: Docs.** In `website/docs/extensibility/plugins.md`, add a short section: plugins may be declared by **package name** (bare specifier) in `plugins:` or `package.json` `plyflow.plugins`, resolved from the workflow's `node_modules` (declare the package in the workflow's `package.json` dependencies so it is installed) — alongside the existing relative-path form. In `AGENTS.md`, add a one-line note that workflow plugins can be referenced by package specifier (e.g. `@plyflow/git`).

- [ ] **Step 4: Full monorepo gate**

Run: `pnpm -r build && pnpm -r lint && pnpm test`
Expected: build exit 0; lint clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/plugin-specifier.e2e.test.ts website/docs AGENTS.md
git commit -m "test(core): e2e plugin-by-specifier; docs"
```

---

## Self-Review

**Spec coverage (Spec A §A5):**
- Resolve `plugins:` / `plyflow.plugins` entries by bare package specifier → Task 2 (engine mapping) + Task 1 (loader resolution). ✅
- Relative/absolute plugin paths unchanged → Task 2 (`resolvePluginRef` preserves them) + Task 1 (relative/absolute branch unchanged); existing plugin tests still green. ✅
- Plugin contract (StepType / register-function) unchanged → `loadPlugins` untouched. ✅
- Enables Spec B (`@plyflow/git` referenced as `'@plyflow/git'`) → Task 3 e2e proves bare-specifier plugin loading end-to-end. ✅

**Placeholder scan:** every step has concrete code/commands + expected output; no TBD. ✅

**Type/name consistency:** `resolvePluginRef(dir, ref)` (Task 2) is consumed by `engine.ts` (Task 2 Step 5). The module-loader `import()` bare branch (Task 1) is what resolves the passthrough specifier from Task 2. The e2e (Task 3) exercises both: engine mapping leaves `shout-plugin` unchanged → loader resolves it from the temp `node_modules`. The "bare specifier" definition (not absolute, not `./`/`../`) is identical in `plugin-ref.ts` and `module-loader.ts`. ✅

**Adjust-at-implementation notes:** (a) Task 2 Step 5 — check whether the `node:path` dynamic import in `runWorkflow` becomes unused after switching to `resolvePluginRef`; remove it if so (lint). (b) Task 3 Step 2 — `prepareEnv` may need a minimal `package.json` in the temp workflow dir; add one if the run errors on env prep.

**Scope note:** Resolution is from the workflow's `node_modules` (where `prepareEnv` installs declared deps). For a workflow run from the monorepo or with a hoisted install, `createRequire` walks up to find the package — standard Node resolution. No change to how plugins are *registered*, only how their module is *located*.
