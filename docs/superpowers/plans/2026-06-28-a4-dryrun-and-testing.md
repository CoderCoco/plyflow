# A4 — Dry-Run CLI + `@plyflow/testing` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dry-run mode (engine support landed in A1) reachable from the CLI via `--dry-run`, and ship a new `@plyflow/testing` package that lets workflow authors test runs without the network or shell: `fakeProvider(rules)` (dispatch a fake AI provider by system-prompt substring) and `mockExec(rules)` (script `sh`/command output by substring). This replaces mission's hand-written `MissionFakeProvider` and the `MISSION_DRYRUN=1` env hack.

**Architecture:** `--dry-run` is a one-flag CLI change that sets `runWorkflow({ dryRun: true })` (the engine already honors it). `@plyflow/testing` is a new scoped package depending on `@plyflow/core`. For `mockExec` (a `ShellExec`) to reach `sh` steps, the engine's built-in `sh` registration must become injectable: `buildDefaultRegistry(shellExec?)` and `RunOptions.shellExec?` thread a custom `ShellExec` into the default registry. `fakeProvider` implements `AIProvider`, matching a rule key as a substring of the request's `system` prompt and returning a normalized `AIResult`.

**Tech Stack:** TypeScript ESM (Node ≥24), Zod, vitest. pnpm monorepo — work spans `packages/core`, `packages/cli`, and a NEW `packages/testing`.

## Global Constraints

- **Node ≥24, ESM.** Relative imports keep `.js` extensions. `node -v` must be v24.x (`source "$HOME/.nvm/nvm.sh" && nvm use 24.18.0` if it shows v20).
- **Test gate is vitest**; CI runs `pnpm -r lint` (`no-unused-vars: error` — no unused imports), `pnpm -r build`, `pnpm test`.
- **TDD:** failing test first, watch fail, minimal impl, watch pass, commit.
- **New package conventions (mirror existing packages exactly):** `"type": "module"`, `"engines": { "node": ">=24" }`, `"publishConfig": { "access": "public" }`, `exports` with a `@plyflow/source`→`./src/index.ts` condition + `default`→`./dist/index.js`, `tsdown.config.ts` with **`fixedExtension: false`** (so ESM output is `.js`), `vitest.config.ts` with **`ssr: { resolve: { conditions: ['@plyflow/source'] } }`** (so cross-package tests resolve live source), `tsconfig.json` extends `../../tsconfig.base.json`.
- **`@plyflow/testing` is a library, not a test file** — its own `*.test.ts` test the helpers; the helpers themselves are exported source.
- **Back-compat:** `buildDefaultRegistry()` with no args must behave exactly as today (`defaultShellExec`). `RunOptions.shellExec` is optional.

---

## File Structure

```text
packages/cli/src/
  args.ts             # MODIFY: ParsedArgs.dryRun; parse --dry-run
  args.test.ts        # MODIFY: --dry-run parsing
  index.ts            # MODIFY: pass dryRun: args.dryRun to runWorkflow
packages/core/src/
  core/engine.ts      # MODIFY: buildDefaultRegistry(shellExec?); RunOptions.shellExec?; wire into runWorkflow
packages/testing/                 # NEW PACKAGE → @plyflow/testing
  package.json
  tsdown.config.ts
  tsconfig.json
  vitest.config.ts
  src/
    index.ts          # barrel: fakeProvider, mockExec, re-export FakeProvider
    fake-provider.ts  + fake-provider.test.ts
    mock-exec.ts      + mock-exec.test.ts
    testing.e2e.test.ts   # workflow with agent + sh, run with fakeProvider + mockExec, no net/shell
package.json (root)   # MODIFY: add "@plyflow/testing": "workspace:*" to devDependencies
```

**Interfaces produced:**

```ts
// core/engine.ts
export function buildDefaultRegistry(shellExec?: import('./shell.js').ShellExec): StepRegistry;
// RunOptions gains: shellExec?: ShellExec  (injected into the default sh step)

// @plyflow/testing
export function fakeProvider(rules: Record<string, unknown>): AIProvider;
//   matches a rule key as a substring of req.system; returns a normalized AIResult:
//   value with own 'text'/'structured' key → used as-is; string → { text }; else → { structured: value }
export function mockExec(rules: Record<string, { stdout?: string; stderr?: string; code?: number }>): ShellExec;
//   matches a rule key as a substring of the command; returns { stdout, stderr, code } (defaults '', '', 0)
export { FakeProvider } from '@plyflow/core';
```

---

## Task 1: CLI `--dry-run` flag

**Files:**
- Modify: `packages/cli/src/args.ts` (ParsedArgs.dryRun + parse)
- Modify: `packages/cli/src/args.test.ts`
- Modify: `packages/cli/src/index.ts` (pass to runWorkflow)

**Interfaces:**
- Produces: `plyflow run wf.yaml --dry-run` sets `runWorkflow(..., { dryRun: true })`.

- [ ] **Step 1: Write the failing test** (append to `args.test.ts`)

```ts
it('parses --dry-run', () => {
  expect(parseArgs(['run', 'wf.yaml', '--dry-run']).dryRun).toBe(true);
});
it('defaults dryRun to false', () => {
  expect(parseArgs(['run', 'wf.yaml']).dryRun).toBe(false);
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter @plyflow/cli test -- args`
Expected: FAIL (`dryRun` undefined).

- [ ] **Step 3: Implement** in `packages/cli/src/args.ts`:
  - Add `dryRun: boolean;` to `interface ParsedArgs`.
  - Add `let dryRun = false;` with the other flag vars.
  - Add a branch in the parse loop: `else if (arg === '--dry-run') { dryRun = true; }`
  - Add `dryRun` to the returned object: `return { workflow, inputs, resume, refresh, yes, dryRun };`

- [ ] **Step 4: Run, watch pass**

Run: `pnpm --filter @plyflow/cli test -- args`
Expected: PASS.

- [ ] **Step 5: Wire into `index.ts`.** Find the `runWorkflow(...)` call in `packages/cli/src/index.ts` and add `dryRun: args.dryRun,` to its options object. (Search for the existing `runWorkflow(` call; add the field next to `inputs`/`isTty`.)

- [ ] **Step 6: cli build + test + lint**

Run: `pnpm --filter @plyflow/cli build && pnpm --filter @plyflow/cli test && pnpm --filter @plyflow/cli lint`
Expected: build exit 0; tests pass; lint clean.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/args.ts packages/cli/src/args.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): --dry-run flag sets engine dry-run mode"
```

---

## Task 2: Inject a custom `ShellExec` into the default registry

**Files:**
- Modify: `packages/core/src/core/engine.ts` (`buildDefaultRegistry(shellExec?)`; `RunOptions.shellExec?`; wire)
- Test: `packages/core/src/core/shell-inject.test.ts`

**Interfaces:**
- Produces: `buildDefaultRegistry(shellExec?)` builds the `sh` step with the given exec (default `defaultShellExec`); `runWorkflow(..., { shellExec })` uses it when it builds the default registry. Enables `mockExec` (Task 4) to reach `sh` steps.

- [ ] **Step 1: Write the failing test** — `packages/core/src/core/shell-inject.test.ts`

```ts
import { it, expect, vi } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import type { ShellExec } from './shell.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('runWorkflow routes sh steps through an injected shellExec', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-shinj-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, 'name: w\nphases:\n  - name: p\n    steps:\n      - id: s\n        sh: echo SHOULD-NOT-RUN\n');
  const fake: ShellExec = vi.fn(async () => ({ stdout: 'mocked', stderr: '', code: 0 }));
  const res = await runWorkflow(wf, { provider: new FakeProvider([]), isTty: false, shellExec: fake });
  expect(fake).toHaveBeenCalledWith('echo SHOULD-NOT-RUN', expect.anything());
  expect((res.outputs.s as { stdout: string }).stdout).toBe('mocked');
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter @plyflow/core test -- shell-inject`
Expected: FAIL (`shellExec` ignored; real `echo` runs → stdout `'SHOULD-NOT-RUN\n'`).

- [ ] **Step 3: Implement** in `packages/core/src/core/engine.ts`:
  - Add the import if missing: `import { type ShellExec } from '../steps/sh.js';` — NO; `ShellExec` is exported from `./shell.js`. Use `import type { ShellExec } from './shell.js';`
  - Change the signature: `export function buildDefaultRegistry(shellExec?: ShellExec): StepRegistry {` and the `sh` registration to `reg.register(makeShStep(shellExec));` (`makeShStep` already defaults to `defaultShellExec` when its arg is `undefined`, so `buildDefaultRegistry()` with no arg is unchanged).
  - Add `shellExec?: ShellExec;` to `RunOptions` (with a doc comment: "Injectable shell exec for `sh` steps; defaults to the real shell. Useful for tests.").
  - In `runWorkflow`, change `const registry = opts.registry ? opts.registry.clone() : buildDefaultRegistry();` to `const registry = opts.registry ? opts.registry.clone() : buildDefaultRegistry(opts.shellExec);`

- [ ] **Step 4: Run, watch pass**

Run: `pnpm --filter @plyflow/core test -- shell-inject`
Expected: PASS.

- [ ] **Step 5: Full core suite + lint (back-compat: `buildDefaultRegistry()` callers unchanged)**

Run: `pnpm --filter @plyflow/core test && pnpm --filter @plyflow/core lint`
Expected: all pass; lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core/engine.ts packages/core/src/core/shell-inject.test.ts
git commit -m "feat(core): inject a custom ShellExec into the default registry"
```

---

## Task 3: `@plyflow/testing` package + `fakeProvider`

**Files:**
- Create: `packages/testing/package.json`, `tsdown.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/fake-provider.ts`, `src/fake-provider.test.ts`

**Interfaces:**
- Produces: the `@plyflow/testing` package exporting `fakeProvider(rules)` (+ re-export `FakeProvider`).

- [ ] **Step 1: Scaffold the package.** Create these files (mirror `packages/core` conventions):

`packages/testing/package.json`:
```json
{
  "name": "@plyflow/testing",
  "version": "0.3.0",
  "description": "Test helpers for plyflow workflows: fake AI provider and mock shell exec.",
  "type": "module",
  "engines": { "node": ">=24" },
  "publishConfig": { "access": "public" },
  "exports": { ".": { "@plyflow/source": "./src/index.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": { "build": "tsdown", "test": "vitest run", "lint": "eslint src" },
  "dependencies": { "@plyflow/core": "workspace:*" }
}
```

`packages/testing/tsdown.config.ts`:
```ts
import { defineConfig } from 'tsdown';
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node24',
  dts: true,
  sourcemap: true,
  clean: true,
  fixedExtension: false,
});
```

`packages/testing/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist" }, "include": ["src"] }
```

`packages/testing/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['@plyflow/source'] },
  ssr: { resolve: { conditions: ['@plyflow/source'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 2: Write the failing test** — `packages/testing/src/fake-provider.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { fakeProvider } from './index.js';

describe('fakeProvider', () => {
  it('dispatches by system-prompt substring', async () => {
    const p = fakeProvider({
      'Flight Director': { plan: ['a', 'b'] },
      'Astronaut': 'done',
    });
    const a = await p.complete({ system: 'You are the Flight Director.', prompt: '', model: 'm' });
    expect(a.structured).toEqual({ plan: ['a', 'b'] }); // plain object → structured
    const b = await p.complete({ system: 'You are an Astronaut.', prompt: '', model: 'm' });
    expect(b.text).toBe('done'); // string → text
  });

  it('passes through an explicit AIResult value', async () => {
    const p = fakeProvider({ X: { text: 'hi', usage: { inputTokens: 1, outputTokens: 2 } } });
    const r = await p.complete({ system: 'contains X here', prompt: '', model: 'm' });
    expect(r.text).toBe('hi');
    expect(r.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('throws a clear error when no rule matches', async () => {
    const p = fakeProvider({ X: 'x' });
    await expect(p.complete({ system: 'no match', prompt: '', model: 'm' })).rejects.toThrow(/no fakeProvider rule/i);
  });
});
```

- [ ] **Step 3: Run, watch fail** — `pnpm --filter @plyflow/testing test` (FAIL: module missing).

- [ ] **Step 4: Implement** `packages/testing/src/fake-provider.ts`:

```ts
import type { AIProvider, AICompleteRequest, AIResult } from '@plyflow/core';

function normalize(value: unknown): AIResult {
  if (value !== null && typeof value === 'object' && ('text' in value || 'structured' in value || 'usage' in value)) {
    return value as AIResult;
  }
  if (typeof value === 'string') return { text: value };
  return { structured: value };
}

/**
 * A fake AIProvider that returns a scripted result based on which rule key
 * appears as a substring of the request's `system` prompt. Robust to scheduler
 * reordering (unlike a positional queue). Rule values: an explicit AIResult is
 * used as-is; a string becomes `{ text }`; anything else becomes `{ structured }`.
 */
export function fakeProvider(rules: Record<string, unknown>): AIProvider {
  return {
    name: 'fake',
    async complete(req: AICompleteRequest): Promise<AIResult> {
      for (const [key, value] of Object.entries(rules)) {
        if (req.system.includes(key)) return normalize(value);
      }
      throw new Error(`no fakeProvider rule matched the system prompt: ${req.system.slice(0, 80)}`);
    },
  };
}
```

`packages/testing/src/index.ts`:
```ts
export { fakeProvider } from './fake-provider.js';
export { FakeProvider } from '@plyflow/core';
```

- [ ] **Step 5: Install + run, watch pass**

Run: `pnpm install && pnpm --filter @plyflow/testing test && pnpm --filter @plyflow/testing build`
Expected: package links; tests pass; `dist/index.js` produced.

- [ ] **Step 6: Commit**

```bash
git add packages/testing pnpm-lock.yaml
git commit -m "feat(testing): @plyflow/testing package with fakeProvider"
```

---

## Task 4: `mockExec` + root wiring

**Files:**
- Create: `packages/testing/src/mock-exec.ts`, `packages/testing/src/mock-exec.test.ts`
- Modify: `packages/testing/src/index.ts` (export `mockExec`)
- Modify: root `package.json` (add `@plyflow/testing` devDependency)

**Interfaces:**
- Produces: `mockExec(rules)` → a `ShellExec` matching the command by substring.

- [ ] **Step 1: Write the failing test** — `packages/testing/src/mock-exec.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mockExec } from './index.js';

describe('mockExec', () => {
  it('matches a command by substring and returns the scripted result', async () => {
    const exec = mockExec({
      'gh issue view': { stdout: '{"title":"x"}', code: 0 },
      'git push': { stdout: '', code: 0 },
    });
    expect(await exec('gh issue view 7 --json title')).toEqual({ stdout: '{"title":"x"}', stderr: '', code: 0 });
    expect(await exec('git push -u origin HEAD')).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('defaults stdout/stderr to "" and code to 0', async () => {
    const exec = mockExec({ ls: {} });
    expect(await exec('ls -la')).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('throws when no rule matches the command', async () => {
    const exec = mockExec({ ls: {} });
    await expect(exec('rm -rf /')).rejects.toThrow(/no mockExec rule/i);
  });
});
```

- [ ] **Step 2: Run, watch fail** — `pnpm --filter @plyflow/testing test -- mock-exec`.

- [ ] **Step 3: Implement** `packages/testing/src/mock-exec.ts`:

```ts
import type { ShellExec } from '@plyflow/core';

/**
 * A fake ShellExec for `sh` steps: matches a rule key as a substring of the
 * command and returns its scripted `{ stdout, stderr, code }` (defaults '', '', 0).
 * Throws on an unmatched command so tests can't silently run real shell.
 */
export function mockExec(
  rules: Record<string, { stdout?: string; stderr?: string; code?: number }>,
): ShellExec {
  return async (command: string) => {
    for (const [key, r] of Object.entries(rules)) {
      if (command.includes(key)) {
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 };
      }
    }
    throw new Error(`no mockExec rule matched the command: ${command}`);
  };
}
```

Add to `packages/testing/src/index.ts`:
```ts
export { mockExec } from './mock-exec.js';
```

- [ ] **Step 4: Run, watch pass** — `pnpm --filter @plyflow/testing test`.

- [ ] **Step 5: Wire `@plyflow/testing` into the root** so examples/integration can use it. In root `package.json` `devDependencies`, add `"@plyflow/testing": "workspace:*"`. Run `pnpm install`.

- [ ] **Step 6: Verify `ShellExec` is exported from `@plyflow/core`.** `mock-exec.ts` imports `type { ShellExec }` from `@plyflow/core` — confirm the core barrel re-exports it (it was added in A1: `export type { ShellExec, ShellResult } from './core/shell.js';`). If missing, the import will fail at build; in that case the fix belongs in core's barrel, but A1 already added it — just confirm.

- [ ] **Step 7: Commit**

```bash
git add packages/testing/src pnpm-lock.yaml package.json
git commit -m "feat(testing): mockExec; wire @plyflow/testing into root"
```

---

## Task 5: Integration e2e + docs

**Files:**
- Create: `packages/testing/src/testing.e2e.test.ts`
- Modify: `website/docs/` (a testing page) and `AGENTS.md`

**Interfaces:**
- Consumes: `fakeProvider`, `mockExec`, `runWorkflow`, `buildDefaultRegistry`/`shellExec`.
- Produces: a green proof that a workflow with an `agent` step and a `sh` step runs with zero network and zero real shell.

- [ ] **Step 1: Write the failing e2e** — `packages/testing/src/testing.e2e.test.ts`

```ts
import { it, expect } from 'vitest';
import { runWorkflow } from '@plyflow/core';
import { fakeProvider, mockExec } from './index.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('runs an agent + sh workflow with no network and no real shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-testing-'));
  writeFileSync(
    join(dir, 'planner.md'),
    '---\nmodel: claude-opus-4-8\n---\nYou are the Flight Director. Produce a plan.',
  );
  writeFileSync(
    join(dir, 'w.yaml'),
    [
      'name: w',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: plan',
      '        agent: ./planner.md',
      '        prompt: go',
      '      - id: fetch',
      '        sh: gh issue view 7 --json title',
      '        json: true',
    ].join('\n'),
  );
  const res = await runWorkflow(join(dir, 'w.yaml'), {
    isTty: false,
    provider: fakeProvider({ 'Flight Director': { tasks: ['a', 'b'] } }),
    shellExec: mockExec({ 'gh issue view': { stdout: '{"title":"Bug"}', code: 0 } }),
  });
  expect(res.outputs.plan).toEqual({ tasks: ['a', 'b'] });           // agent → fakeProvider structured
  expect((res.outputs.fetch as { json: unknown }).json).toEqual({ title: 'Bug' }); // sh → mockExec
});
```

- [ ] **Step 2: Run, watch it pass (or adjust)**

Run: `pnpm --filter @plyflow/testing test -- testing.e2e`
Expected: PASS. If the `agent` step returns its result under a different shape (e.g. `res.outputs.plan` is the structured value directly vs wrapped), verify against `steps/agent.ts` and adjust the assertion to the real shape before locking. (The agent step returns the provider's `structured` as the step output when an output schema/structured result is present; confirm and match.)

- [ ] **Step 3: Docs.** Create `website/docs/testing.md` (or add to an existing testing/programmatic page — check `website/docs/programmatic-usage.md`): document `@plyflow/testing` (`fakeProvider(rules)`, `mockExec(rules)`), the `--dry-run` CLI flag, and `runWorkflow({ dryRun, shellExec })`. Register any new page in `website/sidebars.ts`. In `AGENTS.md`, add a one-line mention of `@plyflow/testing` and `--dry-run` (and add `@plyflow/testing` to the architecture-map package list).

- [ ] **Step 4: Full monorepo gate**

Run: `pnpm -r build && pnpm -r lint && pnpm test`
Expected: build exit 0; lint clean; all tests pass (core + cli + tui + meta + testing + examples).

- [ ] **Step 5: Commit**

```bash
git add packages/testing/src/testing.e2e.test.ts website/docs website/sidebars.ts AGENTS.md
git commit -m "test(testing): agent+sh e2e with fakeProvider+mockExec; docs"
```

---

## Self-Review

**Spec coverage (Spec A §A4):**
- Engine `--dry-run` mode → engine support is A1; CLI `--dry-run` flag → Task 1. ✅
- `@plyflow/testing` package → Tasks 3–5. ✅
- `fakeProvider(rules)` dispatch by system-prompt substring → Task 3. ✅
- `mockExec(rules)` for `sh`/command output → Task 4, reaching `sh` steps via the `shellExec` injection in Task 2. ✅
- Replaces `MissionFakeProvider` + `MISSION_DRYRUN` → the e2e (Task 5) demonstrates the replacement (agent + sh, no net/shell). ✅

**Placeholder scan:** every step has concrete code/commands + expected output; no TBD. ✅

**Type/name consistency:** `buildDefaultRegistry(shellExec?)` + `RunOptions.shellExec?` (Task 2) are consumed by the e2e and `mockExec` path (Tasks 4–5). `fakeProvider`/`mockExec` signatures are identical across impl (Tasks 3–4), tests, and the e2e (Task 5). `ShellExec`/`AIProvider`/`AICompleteRequest`/`AIResult` are imported from `@plyflow/core`'s barrel (confirmed exported: providers types + ShellExec from A1). New-package conventions (fixedExtension/ssr.resolve.conditions/source export) match the existing packages. ✅

**Adjust-at-implementation notes:** (a) Task 5 Step 2 — verify the `agent` step output shape against `steps/agent.ts` before locking the e2e assertion. (b) Task 4 Step 6 — confirm `ShellExec` is re-exported from the core barrel (added in A1); if not, that one-line core-barrel fix is in scope.

**Deliberate scope note:** A `runWorkflowForTest(...)` convenience wrapper is intentionally omitted (YAGNI) — callers compose `runWorkflow` with `fakeProvider`/`mockExec`/`dryRun` directly, as the e2e shows. `mockExec` targets the `sh`-step `ShellExec`; the separate workflow-env `Exec` (npm install) is already injectable via the existing `RunOptions.exec` and is out of scope here.
