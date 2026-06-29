# `@plyflow/github` Plugin Pack (Spec B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@plyflow/github`, a first-party plyflow plugin pack providing typed `github.issue`, `github.pr`, `github.comments`, and `github.review` step types that wrap the `gh` CLI through core's injectable shell primitive.

**Architecture:** A new workspace package under `plugins/github/`, structured identically to `@plyflow/git` (Spec B1): one file per step exporting a factory `makeGithub<X>Step(exec = defaultShellExec): StepType`; a `schemas.ts` of Zod output schemas; an `index.ts` with a default `register(registry)` plugin entry plus a named `registerWith(registry, exec)` for `mockExec` injection. Every `gh` invocation requests an explicit `--json <fields>` set so output shape is stable across `gh` versions; non-zero exit throws; `ctx.dryRun` returns synthetic output without calling `exec`.

**Tech Stack:** TypeScript (ESM, Node ≥24), Zod ^4.4.3, tsdown, vitest, `@plyflow/core`, `@plyflow/testing` (`mockExec`).

## Global Constraints

- **Node ≥24, TypeScript, ESM.** Relative imports MUST carry the `.js` extension in `.ts` source.
- **TDD.** Failing test first, watch fail, minimal impl, watch pass, commit. Tests beside source as `*.test.ts`.
- **Test gate is vitest:** `pnpm --filter @plyflow/github test`. Not `tsc`.
- **Build is tsdown:** `pnpm --filter @plyflow/github build`.
- **Conventional Commits.**
- **Package metadata:** name `@plyflow/github`, version `0.3.0`, scope `@plyflow`, `publishConfig.access = public`, under `plugins/`.
- **Zod `^4.4.3`** — match `@plyflow/core`.
- **`gh` CLI is a runtime requirement.** Document it; steps surface `gh`'s stderr on non-zero exit. No real `gh` calls in tests — inject `mockExec`.
- **Pin `--json` fields explicitly per step** (mitigates schema drift across `gh` versions).
- **Step ids namespaced** `github.*`; each step sets its own `match: (def) => def.step === '<name>'`.
- **Resolved inputs come from `ctx.with`** (engine resolves `${{ }}` before invoking the step; see `packages/core/src/core/exec.ts:175`). `parse` returns `{}`; `run` reads `ctx.with`.
- **Optional `repo`** input on every step: when present append `--repo <repo>` so workflows can target a non-default repository.

---

## File Structure

```
plugins/github/
  package.json          @plyflow/github metadata + deps
  tsconfig.json
  tsdown.config.ts
  vitest.config.ts
  src/
    index.ts            register() / registerWith() — wires all four steps
    schemas.ts          Zod output schemas
    lib/
      sh.ts             shQuote / shJoin (copied from @plyflow/git — packs are independent)
      sh.test.ts
    issue.ts            makeGithubIssueStep
    issue.test.ts
    pr.ts               makeGithubPrStep
    pr.test.ts
    comments.ts         makeGithubCommentsStep
    comments.test.ts
    review.ts           makeGithubReviewStep
    review.test.ts
    index.test.ts       integration: registerWith(mockExec) → run via registry
```

> The `lib/sh.ts` helper is duplicated from `@plyflow/git` on purpose: the packs are independently published and must not depend on each other. It is a 12-line file; duplication is cheaper than a shared internal package here.

---

## Task B2.1: Scaffold the `@plyflow/github` package + shell-quoting helper

**Files:**
- Create: `plugins/github/package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`
- Create: `plugins/github/src/lib/sh.ts`
- Test: `plugins/github/src/lib/sh.test.ts`

**Interfaces:**
- Produces: `shQuote(arg)`, `shJoin(parts)` from `./lib/sh.js` (identical contract to `@plyflow/git`).

- [ ] **Step 1: Create the package manifest and configs**

`plugins/github/package.json`:
```json
{
  "name": "@plyflow/github",
  "version": "0.3.0",
  "description": "First-party plyflow plugin pack: typed GitHub step types (issue, pr, comments, review) over the gh CLI.",
  "type": "module",
  "engines": { "node": ">=24" },
  "publishConfig": { "access": "public" },
  "exports": { ".": { "@plyflow/source": "./src/index.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": { "build": "tsdown", "test": "vitest run", "lint": "eslint src" },
  "dependencies": { "@plyflow/core": "workspace:*", "zod": "^4.4.3" },
  "devDependencies": { "@plyflow/testing": "workspace:*" }
}
```

`plugins/github/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist" }, "include": ["src"] }
```

`plugins/github/tsdown.config.ts`:
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

`plugins/github/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 2: Install the workspace**

Run: `pnpm install`
Expected: `@plyflow/github` linked.

- [ ] **Step 3: Write the failing test for the quoting helper**

`plugins/github/src/lib/sh.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { shQuote, shJoin } from './sh.js';

describe('shQuote', () => {
  it('leaves simple tokens unquoted', () => {
    expect(shQuote('gh')).toBe('gh');
    expect(shQuote('number,title,body')).toBe('number,title,body');
  });
  it('single-quotes tokens with spaces or newlines', () => {
    expect(shQuote('Fix the bug')).toBe("'Fix the bug'");
    expect(shQuote('## Summary\n- a')).toBe("'## Summary\n- a'");
  });
  it('escapes embedded single quotes', () => {
    expect(shQuote("don't")).toBe("'don'\\''t'");
  });
  it('quotes the empty string', () => {
    expect(shQuote('')).toBe("''");
  });
});

describe('shJoin', () => {
  it('joins quoted parts', () => {
    expect(shJoin(['gh', 'pr', 'comment', '5', '--body', 'hi there'])).toBe("gh pr comment 5 --body 'hi there'");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @plyflow/github test`
Expected: FAIL — cannot find module `./sh.js`.

- [ ] **Step 5: Implement the helper**

`plugins/github/src/lib/sh.ts`:
```ts
/**
 * Build shell command strings for core's `ShellExec` (runs via
 * `spawn(cmd, { shell: true })`). Quote each argument so titles, bodies, and
 * GraphQL queries containing spaces/newlines/metacharacters survive intact.
 */
const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shQuote(arg: string): string {
  if (arg.length > 0 && SAFE.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function shJoin(parts: string[]): string {
  return parts.map(shQuote).join(' ');
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/github test`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add plugins/github pnpm-lock.yaml
git commit -m "feat(github): scaffold @plyflow/github package + shell-quoting helper"
```

---

## Task B2.2: `github.issue` step + output schemas module

**Files:**
- Create: `plugins/github/src/schemas.ts`
- Create: `plugins/github/src/issue.ts`
- Test: `plugins/github/src/issue.test.ts`

**Interfaces:**
- Consumes: `shJoin`, core step types.
- Produces:
  - `schemas.ts` exports `IssueOutput`, `PrOutput`, `CommentsOutput`, `ReviewOutput`. `IssueOutput` = `{ number: number, title: string, body: string }`.
  - `issue.ts` exports `makeGithubIssueStep(exec?: ShellExec): StepType`, `name: 'github.issue'`. Inputs: `number` (number-coercible), `repo?` (string). Runs `gh issue view <number> --json number,title,body [--repo <repo>]`. Output: `IssueOutput`.

- [ ] **Step 1: Write the failing test**

`plugins/github/src/issue.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubIssueStep } from './issue.js';
import type { StepContext } from '@plyflow/core';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {}, env: {}, steps: {}, with: {}, bindings: {},
    provider: {} as never, registry: {} as never, baseDir: '/wf', runDir: '/run',
    isTty: false, dryRun: false, provided: [],
    resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    ...over,
  } as StepContext;
}

describe('github.issue', () => {
  it('views the issue with pinned --json fields and parses the result', async () => {
    const calls: string[] = [];
    const exec = mockExec({
      'gh issue view': { stdout: JSON.stringify({ number: 12, title: 'A bug', body: 'details' }) },
    });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubIssueStep(traced);
    const res = await step.run(step.parse({ id: 'i', step: 'github.issue' }), ctx({ with: { number: 12 } }));
    expect(res.output).toEqual({ number: 12, title: 'A bug', body: 'details' });
    expect(calls[0]).toBe('gh issue view 12 --json number,title,body');
  });

  it('appends --repo when given', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh issue view': { stdout: JSON.stringify({ number: 1, title: 't', body: 'b' }) } });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubIssueStep(traced);
    await step.run(step.parse({ id: 'i', step: 'github.issue' }), ctx({ with: { number: 1, repo: 'owner/repo' } }));
    expect(calls[0]).toContain('--repo owner/repo');
  });

  it('under dryRun returns synthetic output without calling exec', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '', code: 0 }; };
    const step = makeGithubIssueStep(exec);
    const res = await step.run(step.parse({ id: 'i', step: 'github.issue' }), ctx({ with: { number: 7 }, dryRun: true }));
    expect(called).toBe(false);
    expect(res.output).toMatchObject({ number: 7 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @plyflow/github test issue`
Expected: FAIL — cannot find module `./issue.js`.

- [ ] **Step 3: Implement the schemas module and the step**

`plugins/github/src/schemas.ts`:
```ts
import { z } from 'zod';

export const IssueOutput = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
});

export const PrOutput = z.object({
  number: z.number(),
  url: z.string(),
  created: z.boolean(),
});

// Passthrough so the raw pinned `gh pr view` fields (headRefName, reviewThreads,
// reviews, url, title, baseRefName) remain available to consumers that need
// them (e.g. mission's comms workflow pushes `headRefName`).
export const CommentsOutput = z
  .object({
    comments: z.array(z.unknown()),
    ci: z.object({ passing: z.boolean() }),
    merged: z.boolean(),
    headRefName: z.string().optional(),
  })
  .passthrough();

export const ReviewOutput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comment'), body: z.string() }),
  z.object({ action: z.literal('reRequest'), reviewers: z.array(z.string()) }),
  z.object({ action: z.literal('resolveThread'), resolved: z.boolean() }),
]);
```

`plugins/github/src/issue.ts`:
```ts
import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { IssueOutput } from './schemas.js';

const Input = z.object({ number: z.coerce.number().int(), repo: z.string().optional() });
const ISSUE_FIELDS = 'number,title,body';

/** Read a GitHub issue via `gh issue view --json number,title,body`. */
export function makeGithubIssueStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.issue',
    match: (def) => def.step === 'github.issue',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { number, repo } = Input.parse(ctx.with);

      if (ctx.dryRun) {
        return { output: IssueOutput.parse({ number, title: 'dry-run issue', body: 'dry-run placeholder body' }) };
      }

      const args = ['gh', 'issue', 'view', String(number), '--json', ISSUE_FIELDS];
      if (repo) args.push('--repo', repo);
      const r = await exec(shJoin(args));
      if (r.code !== 0) throw new Error(`gh issue view failed (code ${r.code}): ${r.stderr.trim()}`);

      const data = JSON.parse(r.stdout) as { number: number; title: string; body: string };
      return { output: IssueOutput.parse({ number: data.number, title: data.title, body: data.body }) };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/github test issue`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/github/src/schemas.ts plugins/github/src/issue.ts plugins/github/src/issue.test.ts
git commit -m "feat(github): add github.issue step + output schemas"
```

---

## Task B2.3: `github.pr` step (create-or-reuse)

**Files:**
- Create: `plugins/github/src/pr.ts`
- Test: `plugins/github/src/pr.test.ts`

**Interfaces:**
- Consumes: `shJoin`, `PrOutput`, core step types.
- Produces: `makeGithubPrStep(exec?: ShellExec): StepType`, `name: 'github.pr'`. Inputs: `title` (string), `body` (string), `head` (string), `base?` (string, default `'main'`), `repo?` (string). Lists open PRs for `head` (`gh pr list --head <head> --json number,url`); if one exists returns it with `created: false`; otherwise `gh pr create --title ... --body ... --base ... --head ...`, parses the printed URL for the PR number, returns `created: true`. Output: `PrOutput` = `{ number, url, created }`.

- [ ] **Step 1: Write the failing test**

`plugins/github/src/pr.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubPrStep } from './pr.js';
import type { StepContext } from '@plyflow/core';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {}, env: {}, steps: {}, with: {}, bindings: {},
    provider: {} as never, registry: {} as never, baseDir: '/wf', runDir: '/run',
    isTty: false, dryRun: false, provided: [],
    resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    ...over,
  } as StepContext;
}

const withInput = { title: 'My PR', body: '## Summary\n- x', head: 'feature-x', base: 'main' };

describe('github.pr', () => {
  it('reuses an existing open PR (created:false)', async () => {
    const exec = mockExec({ 'gh pr list': { stdout: JSON.stringify([{ number: 42, url: 'https://github.com/o/r/pull/42' }]) } });
    const step = makeGithubPrStep(exec);
    const res = await step.run(step.parse({ id: 'p', step: 'github.pr' }), ctx({ with: withInput }));
    expect(res.output).toEqual({ number: 42, url: 'https://github.com/o/r/pull/42', created: false });
  });

  it('creates a new PR and parses the number from the printed URL', async () => {
    const calls: string[] = [];
    const exec = mockExec({
      'gh pr list': { stdout: '[]' },
      'gh pr create': { stdout: 'https://github.com/o/r/pull/43\n' },
    });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubPrStep(traced);
    const res = await step.run(step.parse({ id: 'p', step: 'github.pr' }), ctx({ with: withInput }));
    expect(res.output).toEqual({ number: 43, url: 'https://github.com/o/r/pull/43', created: true });
    const create = calls.find((c) => c.includes('gh pr create'))!;
    expect(create).toContain("--title 'My PR'");
    expect(create).toContain('--head feature-x');
    expect(create).toContain('--base main');
  });

  it('under dryRun returns a synthetic PR without calling exec', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '', code: 0 }; };
    const step = makeGithubPrStep(exec);
    const res = await step.run(step.parse({ id: 'p', step: 'github.pr' }), ctx({ with: withInput, dryRun: true }));
    expect(called).toBe(false);
    expect(res.output).toMatchObject({ created: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @plyflow/github test pr`
Expected: FAIL — cannot find module `./pr.js`.

- [ ] **Step 3: Implement the step**

`plugins/github/src/pr.ts`:
```ts
import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { PrOutput } from './schemas.js';

const Input = z.object({
  title: z.string(),
  body: z.string(),
  head: z.string(),
  base: z.string().default('main'),
  repo: z.string().optional(),
});

/** Create a PR for `head`, or reuse the open one if it already exists. */
export function makeGithubPrStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.pr',
    match: (def) => def.step === 'github.pr',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { title, body, head, base, repo } = Input.parse(ctx.with);

      if (ctx.dryRun) {
        return { output: PrOutput.parse({ number: 0, url: 'https://github.com/dry-run/pull/0', created: false }) };
      }

      const listArgs = ['gh', 'pr', 'list', '--head', head, '--json', 'number,url'];
      if (repo) listArgs.push('--repo', repo);
      const list = await exec(shJoin(listArgs));
      if (list.code !== 0) throw new Error(`gh pr list failed (code ${list.code}): ${list.stderr.trim()}`);

      const existing = JSON.parse(list.stdout) as Array<{ number: number; url: string }>;
      if (existing.length > 0) {
        const pr = existing[0]!;
        return { output: PrOutput.parse({ number: pr.number, url: pr.url, created: false }) };
      }

      const createArgs = ['gh', 'pr', 'create', '--title', title, '--body', body, '--base', base, '--head', head];
      if (repo) createArgs.push('--repo', repo);
      const create = await exec(shJoin(createArgs));
      if (create.code !== 0) throw new Error(`gh pr create failed (code ${create.code}): ${create.stderr.trim()}`);

      const url = create.stdout.trim();
      const m = url.match(/\/pull\/(\d+)\b/);
      if (!m) throw new Error(`could not parse PR number from gh pr create output: ${url}`);
      return { output: PrOutput.parse({ number: parseInt(m[1]!, 10), url, created: true }) };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/github test pr`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/github/src/pr.ts plugins/github/src/pr.test.ts
git commit -m "feat(github): add github.pr step (create-or-reuse)"
```

---

## Task B2.4: `github.comments` step

**Files:**
- Create: `plugins/github/src/comments.ts`
- Test: `plugins/github/src/comments.test.ts`

**Interfaces:**
- Consumes: `shJoin`, `CommentsOutput`, core step types.
- Produces: `makeGithubCommentsStep(exec?: ShellExec): StepType`, `name: 'github.comments'`. Inputs: `pr` (number-coercible), `repo?` (string), `since?` (ISO string). Runs `gh pr view <pr> --json <PR_FIELDS>`; derives `ci.passing` from `statusCheckRollup` (true when empty or every check `SUCCESS`); filters `comments` by `createdAt > since` when `since` is given. Output: `CommentsOutput` = `{ comments: unknown[], ci: { passing: boolean }, merged: boolean, ... }` — a **passthrough** object that also carries the raw pinned `gh pr view` fields (`headRefName`, `reviewThreads`, `reviews`, `url`, `title`, `baseRefName`) so consumers like mission's comms workflow can read `headRefName`.

- [ ] **Step 1: Write the failing test**

`plugins/github/src/comments.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubCommentsStep } from './comments.js';
import type { StepContext } from '@plyflow/core';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {}, env: {}, steps: {}, with: {}, bindings: {},
    provider: {} as never, registry: {} as never, baseDir: '/wf', runDir: '/run',
    isTty: false, dryRun: false, provided: [],
    resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    ...over,
  } as StepContext;
}

describe('github.comments', () => {
  it('returns comments, merged, and ci.passing from statusCheckRollup', async () => {
    const payload = {
      merged: false,
      statusCheckRollup: [{ state: 'SUCCESS' }, { state: 'SUCCESS' }],
      comments: [{ body: 'hi', createdAt: '2026-06-01T00:00:00Z' }],
    };
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify(payload) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({ with: { pr: 5 } }));
    // toMatchObject (not toEqual): the passthrough output also carries raw fields like statusCheckRollup.
    expect(res.output).toMatchObject({
      comments: [{ body: 'hi', createdAt: '2026-06-01T00:00:00Z' }],
      ci: { passing: true },
      merged: false,
    });
  });

  it('marks ci.passing false when any check is not SUCCESS', async () => {
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify({ statusCheckRollup: [{ state: 'FAILURE' }], comments: [] }) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({ with: { pr: 5 } }));
    expect(res.output).toMatchObject({ ci: { passing: false } });
  });

  it('passes through raw pinned fields like headRefName', async () => {
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify({ statusCheckRollup: [], comments: [], headRefName: 'feature-x', url: 'u' }) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({ with: { pr: 5 } }));
    expect(res.output).toMatchObject({ headRefName: 'feature-x', url: 'u' });
  });

  it('filters comments by since', async () => {
    const payload = {
      statusCheckRollup: [],
      comments: [
        { body: 'old', createdAt: '2026-06-01T00:00:00Z' },
        { body: 'new', createdAt: '2026-06-10T00:00:00Z' },
      ],
    };
    const exec = mockExec({ 'gh pr view': { stdout: JSON.stringify(payload) } });
    const step = makeGithubCommentsStep(exec);
    const res = await step.run(step.parse({ id: 'c', step: 'github.comments' }), ctx({
      with: { pr: 5, since: '2026-06-05T00:00:00Z' },
    }));
    expect((res.output as { comments: unknown[] }).comments).toEqual([{ body: 'new', createdAt: '2026-06-10T00:00:00Z' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @plyflow/github test comments`
Expected: FAIL — cannot find module `./comments.js`.

- [ ] **Step 3: Implement the step**

`plugins/github/src/comments.ts`:
```ts
import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { CommentsOutput } from './schemas.js';

const Input = z.object({
  pr: z.coerce.number().int(),
  repo: z.string().optional(),
  since: z.string().optional(),
});

// Pinned so output shape is stable across gh versions.
const PR_FIELDS = ['number', 'merged', 'statusCheckRollup', 'reviewThreads', 'comments', 'reviews', 'url', 'headRefName', 'baseRefName', 'title'].join(',');

/** Fetch PR comments + CI status via `gh pr view --json`. */
export function makeGithubCommentsStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.comments',
    match: (def) => def.step === 'github.comments',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { pr, repo, since } = Input.parse(ctx.with);

      if (ctx.dryRun) {
        return { output: CommentsOutput.parse({ comments: [], ci: { passing: true }, merged: false }) };
      }

      const args = ['gh', 'pr', 'view', String(pr), '--json', PR_FIELDS];
      if (repo) args.push('--repo', repo);
      const r = await exec(shJoin(args));
      if (r.code !== 0) throw new Error(`gh pr view failed (code ${r.code}): ${r.stderr.trim()}`);

      const data = JSON.parse(r.stdout) as Record<string, unknown>;
      const checks = (data['statusCheckRollup'] as Array<{ state: string }> | undefined) ?? [];
      const passing = checks.length === 0 || checks.every((c) => c.state === 'SUCCESS');

      let comments = (data['comments'] as Array<{ createdAt?: string }> | undefined) ?? [];
      if (since) {
        const cutoff = new Date(since).getTime();
        comments = comments.filter((c) => (c.createdAt ? new Date(c.createdAt).getTime() > cutoff : true));
      }

      // Spread the raw pinned fields first, then override the derived ones, so
      // headRefName/reviewThreads/etc. pass through to consumers.
      return {
        output: CommentsOutput.parse({ ...data, comments, ci: { passing }, merged: Boolean(data['merged']) }),
      };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/github test comments`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/github/src/comments.ts plugins/github/src/comments.test.ts
git commit -m "feat(github): add github.comments step"
```

---

## Task B2.5: `github.review` step

**Files:**
- Create: `plugins/github/src/review.ts`
- Test: `plugins/github/src/review.test.ts`

**Interfaces:**
- Consumes: `shJoin`, `ReviewOutput`, core step types.
- Produces: `makeGithubReviewStep(exec?: ShellExec): StepType`, `name: 'github.review'`. Inputs: `pr` (number-coercible), `repo?` (string), and exactly one action of: `comment` (string body) → `gh pr comment <pr> --body <comment>`; `reRequest` (string[] reviewers) → `gh pr request-reviews <pr> --reviewer <r>…`; `resolveThread` (string threadId) → `gh api graphql -f query=<mutation>`. Throws if zero or more than one action is supplied. Output: `ReviewOutput` discriminated on `action`.

- [ ] **Step 1: Write the failing test**

`plugins/github/src/review.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mockExec } from '@plyflow/testing';
import { makeGithubReviewStep } from './review.js';
import type { StepContext } from '@plyflow/core';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {}, env: {}, steps: {}, with: {}, bindings: {},
    provider: {} as never, registry: {} as never, baseDir: '/wf', runDir: '/run',
    isTty: false, dryRun: false, provided: [],
    resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    ...over,
  } as StepContext;
}

describe('github.review', () => {
  it('posts a comment', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh pr comment': { stdout: '' } });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubReviewStep(traced);
    const res = await step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, comment: 'looks good' } }));
    expect(res.output).toEqual({ action: 'comment', body: 'looks good' });
    expect(calls[0]).toBe("gh pr comment 5 --body 'looks good'");
  });

  it('re-requests reviewers', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh pr request-reviews': { stdout: '' } });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubReviewStep(traced);
    const res = await step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, reRequest: ['alice', 'bob'] } }));
    expect(res.output).toEqual({ action: 'reRequest', reviewers: ['alice', 'bob'] });
    expect(calls[0]).toContain('--reviewer alice');
    expect(calls[0]).toContain('--reviewer bob');
  });

  it('resolves a review thread via graphql', async () => {
    const calls: string[] = [];
    const exec = mockExec({ 'gh api graphql': { stdout: '' } });
    const traced = async (cmd: string) => { calls.push(cmd); return exec(cmd); };
    const step = makeGithubReviewStep(traced);
    const res = await step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, resolveThread: 'PRT_123' } }));
    expect(res.output).toEqual({ action: 'resolveThread', resolved: true });
    expect(calls[0]).toContain('resolveReviewThread');
    expect(calls[0]).toContain('PRT_123');
  });

  it('throws when no action is given', async () => {
    const step = makeGithubReviewStep(mockExec({}));
    await expect(step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5 } }))).rejects.toThrow(/exactly one/);
  });

  it('throws when more than one action is given', async () => {
    const step = makeGithubReviewStep(mockExec({}));
    await expect(
      step.run(step.parse({ id: 'r', step: 'github.review' }), ctx({ with: { pr: 5, comment: 'x', resolveThread: 'y' } })),
    ).rejects.toThrow(/exactly one/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @plyflow/github test review`
Expected: FAIL — cannot find module `./review.js`.

- [ ] **Step 3: Implement the step**

`plugins/github/src/review.ts`:
```ts
import { defaultShellExec, type ShellExec, type StepType, type StepContext, type StepResult } from '@plyflow/core';
import { z } from 'zod';
import { shJoin } from './lib/sh.js';
import { ReviewOutput } from './schemas.js';

const Input = z.object({
  pr: z.coerce.number().int(),
  repo: z.string().optional(),
  comment: z.string().optional(),
  reRequest: z.array(z.string()).optional(),
  resolveThread: z.string().optional(),
});

/** Perform exactly one PR review action: comment | reRequest | resolveThread. */
export function makeGithubReviewStep(exec: ShellExec = defaultShellExec): StepType {
  return {
    name: 'github.review',
    match: (def) => def.step === 'github.review',
    parse: () => ({}),
    run: async (_cfg, ctx: StepContext): Promise<StepResult> => {
      const { pr, repo, comment, reRequest, resolveThread } = Input.parse(ctx.with);
      const chosen = [comment !== undefined, reRequest !== undefined, resolveThread !== undefined].filter(Boolean).length;
      if (chosen !== 1) {
        throw new Error('github.review requires exactly one of: comment | reRequest | resolveThread');
      }

      const repoArgs = repo ? ['--repo', repo] : [];

      if (ctx.dryRun) {
        if (comment !== undefined) return { output: ReviewOutput.parse({ action: 'comment', body: comment }) };
        if (reRequest !== undefined) return { output: ReviewOutput.parse({ action: 'reRequest', reviewers: reRequest }) };
        return { output: ReviewOutput.parse({ action: 'resolveThread', resolved: true }) };
      }

      if (comment !== undefined) {
        const r = await exec(shJoin(['gh', 'pr', 'comment', String(pr), '--body', comment, ...repoArgs]));
        if (r.code !== 0) throw new Error(`gh pr comment failed (code ${r.code}): ${r.stderr.trim()}`);
        return { output: ReviewOutput.parse({ action: 'comment', body: comment }) };
      }

      if (reRequest !== undefined) {
        const args = ['gh', 'pr', 'request-reviews', String(pr), ...repoArgs];
        for (const reviewer of reRequest) args.push('--reviewer', reviewer);
        const r = await exec(shJoin(args));
        if (r.code !== 0) throw new Error(`gh pr request-reviews failed (code ${r.code}): ${r.stderr.trim()}`);
        return { output: ReviewOutput.parse({ action: 'reRequest', reviewers: reRequest }) };
      }

      const mutation = `mutation { resolveReviewThread(input: { threadId: "${resolveThread!}" }) { thread { id isResolved } } }`;
      const r = await exec(shJoin(['gh', 'api', 'graphql', '-f', `query=${mutation}`]));
      if (r.code !== 0) throw new Error(`gh api resolveReviewThread failed (code ${r.code}): ${r.stderr.trim()}`);
      return { output: ReviewOutput.parse({ action: 'resolveThread', resolved: true }) };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/github test review`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/github/src/review.ts plugins/github/src/review.test.ts
git commit -m "feat(github): add github.review step"
```

---

## Task B2.6: Register function + integration test

**Files:**
- Create: `plugins/github/src/index.ts`
- Test: `plugins/github/src/index.test.ts`

**Interfaces:**
- Consumes: the four `makeGithub*Step` factories; `StepRegistry`, `defaultShellExec`, `ShellExec` from `@plyflow/core`.
- Produces: `registerWith(registry, exec): void` and `default register(registry): void` (calls `registerWith(registry, defaultShellExec)`).

- [ ] **Step 1: Write the failing integration test**

`plugins/github/src/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { StepRegistry } from '@plyflow/core';
import { mockExec } from '@plyflow/testing';
import register, { registerWith } from './index.js';

describe('@plyflow/github register', () => {
  it('default export registers all four github.* steps', () => {
    const registry = new StepRegistry();
    register(registry);
    for (const name of ['github.issue', 'github.pr', 'github.comments', 'github.review']) {
      // StepRegistry.select(def) returns the matching StepType or throws if none.
      expect(registry.select({ id: 's', step: name }).name).toBe(name);
    }
  });

  it('registerWith injects a mock exec so a registered step runs end-to-end', async () => {
    const registry = new StepRegistry();
    registerWith(registry, mockExec({ 'gh issue view': { stdout: JSON.stringify({ number: 9, title: 't', body: 'b' }) } }));
    const step = registry.select({ id: 'i', step: 'github.issue' });
    const res = await step.run(step.parse({ id: 'i', step: 'github.issue' }), {
      inputs: {}, env: {}, steps: {}, with: { number: 9 }, bindings: {},
      provider: {} as never, registry, baseDir: '/wf', runDir: '/run',
      isTty: false, dryRun: false, provided: [],
      resolve: (v) => v, emit: () => {}, prompt: async () => undefined, loadModule: async () => ({}),
    } as never);
    expect(res.output).toEqual({ number: 9, title: 't', body: 'b' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @plyflow/github test index`
Expected: FAIL — cannot find module `./index.js`.

- [ ] **Step 3: Implement the register module**

`plugins/github/src/index.ts`:
```ts
import { defaultShellExec, type ShellExec, type StepRegistry } from '@plyflow/core';
import { makeGithubIssueStep } from './issue.js';
import { makeGithubPrStep } from './pr.js';
import { makeGithubCommentsStep } from './comments.js';
import { makeGithubReviewStep } from './review.js';

/** Register all github.* steps wired to a specific ShellExec (tests inject mockExec). */
export function registerWith(registry: StepRegistry, exec: ShellExec): void {
  registry.register(makeGithubIssueStep(exec));
  registry.register(makeGithubPrStep(exec));
  registry.register(makeGithubCommentsStep(exec));
  registry.register(makeGithubReviewStep(exec));
}

/** Plugin entry: plyflow calls this with the run's step registry. */
export default function register(registry: StepRegistry): void {
  registerWith(registry, defaultShellExec);
}
```

- [ ] **Step 4: Run the full test suite**

Run: `pnpm --filter @plyflow/github test`
Expected: PASS (all files).

- [ ] **Step 5: Build + lint**

Run: `pnpm --filter @plyflow/github build && npx eslint plugins/github/src`
Expected: `dist/index.js` + `dist/index.d.ts` emitted; lint clean.

- [ ] **Step 6: Commit + changeset**

```bash
git add plugins/github/src/index.ts plugins/github/src/index.test.ts
git commit -m "feat(github): register function + integration test for @plyflow/github"
pnpm changeset   # minor bump for @plyflow/github (new package)
git add .changeset
git commit -m "chore: changeset for @plyflow/github"
```

---

## Self-Review

- **Spec coverage:** `github.issue` (B2.2), `github.pr` (B2.3, create-or-reuse with both branches tested), `github.comments` (B2.4, CI + since filtering), `github.review` (B2.5, all three actions + the exactly-one guard) — all four `@plyflow/github` rows. Zod schemas (B2.2 `schemas.ts`). Pinned `--json` fields per step (issue `number,title,body`; pr `number,url`; comments `PR_FIELDS`). `gh`-missing/non-zero exit surfaces stderr. Register-by-specifier entry (B2.6). `mockExec` everywhere; no live `gh`. ✅
- **Output field names** match the spec table: issue `{ number, title, body }`, pr `{ number, url, created }`, comments `{ comments, ci?, ... }`, review action-specific. ✅
- **Type consistency:** every step is `makeGithub<Name>Step(exec?: ShellExec): StepType`; `index.ts` imports those exact names; schemas from one `schemas.ts`; `ReviewOutput` discriminated union matches the three returned shapes. ✅
- **Risk noted in spec — create-or-reuse races:** both the reuse and create branches of `github.pr` are tested (B2.3). **Schema drift:** `--json` fields pinned per step. **`gh` availability:** documented as a runtime requirement in B3 (docs task) and surfaced via stderr on failure. ✅

## Execution Handoff

B2 is independent of B1 and can be built in parallel. B3 (mission migration + docs) depends on **both** B1 and B2 being merged.
