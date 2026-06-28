# Monorepo Restructure + Core Engine Features — Design (Spec A)

**Date:** 2026-06-28
**Status:** Approved (design); implementation plan pending
**Related:** Spec B — `2026-06-28-git-github-plugin-packs-design.md` (depends on this)

## Summary

Two coupled changes, designed together because the second lands inside the first:

1. **Restructure** the single `plyflow` package into a pnpm + Changesets monorepo
   publishing scoped `@plyflow/*` packages, so the engine, CLI, TUI, and a new
   testing helper become independently consumable — and so plugin packs
   (Spec B) have a home.
2. **Add four core engine features** that let the `examples/mission/` workflows
   (and any plyflow user) express in YAML what they currently hand-roll in
   ~1,600 LoC of custom modules: a **native shell step**, **object/JSON inputs +
   an expression stdlib**, **callable sub-workflows**, and a real **dry-run mode
   backed by a `@plyflow/testing` package**.

The throughline: plyflow already has the hard primitives (DAG `foreach`, `loop`,
retry, structured agent output). What it lacks are the small, generic
primitives that force every serious workflow to drop into bespoke TypeScript.
This spec adds those primitives and gives them a place to live.

## Motivation

An audit of `examples/mission/` (the most advanced workflow) found that almost
none of its ~1,600 LoC of custom modules is mission-specific *mechanism* — it is
generic plumbing the engine should provide:

| Mission custom code | Why it exists | Replaced by |
|---|---|---|
| `lib/exec.ts` + `MISSION_DRYRUN=1` checks scattered in ~10 modules | No native shell-out; no dry-run mode | A1 shell step + A4 dry-run |
| `lib/git-*.ts`, `lib/gh-*.ts` (~700 LoC) | No shell step; no plugin packs | A1 (+ Spec B plugins) |
| `lib/resolve-models.ts` (76 LoC CSV parsing) | Inputs are only string/number/boolean | A2 object inputs |
| `lib/flatten-findings.ts`, `actionable-comments.ts`, most of `findings-filter.ts` | `${{ }}` has no array helpers | A2 expression stdlib |
| Duplicated Setup phase across `mission.yaml` + `comms.yaml` | No workflow composition | A3 sub-workflows |
| Hand-written `MissionFakeProvider` in tests | No shared test harness | A4 `@plyflow/testing` |

The agent personas (`agents/*.md`), the review rubric, and *policy* choices
(confidence thresholds, what counts as "actionable") correctly stay in the
example — those are domain knowledge, not framework gaps.

## Goals

- Ship `@plyflow/core`, `@plyflow/cli`, `@plyflow/tui`, `@plyflow/testing`, and a
  `plyflow` meta-package, plus a layout ready for `@plyflow/git` / `@plyflow/github`.
- Keep the existing `plyflow` install path and library import working (meta-package).
- Add a native `sh:` step with captured output and dry-run support.
- Add `object` / `json` / `array` input types and an expression stdlib of array helpers.
- Add callable sub-workflows with declared `inputs:` and `outputs:`.
- Add an engine-wide `--dry-run` and a `@plyflow/testing` package (`fakeProvider`, `mockExec`).
- Resolve plugins by bare package specifier (`@plyflow/git`), enabling Spec B.
- Preserve the ESM `.js`-extension convention, vitest gate, and TDD workflow.

## Non-Goals (this spec)

- The git/github plugin packs themselves (Spec B).
- Turborepo / Nx task-graph caching (revisit only if CI time hurts).
- TypeScript project references.
- octokit-based GitHub access (Spec B uses the `gh` CLI).
- New providers, new TUI features, or changes to the DAG scheduler/journal beyond
  what sub-workflows require.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Workspace manager | **pnpm workspaces** | 2026 de-facto for TS libs; strict non-hoisted deps catch phantom imports; supports `workspace:*` and rewrites on publish (npm doesn't support `workspace:` at all) |
| Versioning/publish | **Changesets** | Modern standard for independently-versioned scoped packages; intent-file changelogs; auto-bumps internal dependents. Replaces lerna |
| lerna | **Not used** | Maintained (Nx-owned, v9) but post-bootstrapping it's just a version layer; no advantage at 6 packages |
| Bundler | **tsdown** (migrate off tsup) | tsup is deprecated upstream ("use tsdown"); Rolldown-based successor; `npx tsdown-migrate`; one config per package |
| Task runner | **plain pnpm scripts** now; Turborepo later if needed | Caching payoff marginal at 6 packages; Turborepo is low-lock-in if CI drags |
| Publish auth | **npm OIDC trusted publishing**; granular token fallback | GA 2025, auto-provenance. Known `changesets/action` + OIDC friction for *scoped* pkgs → keep a granular npm token as fallback |
| TS project references | **Skip** | Not worth it at this scale |
| Repo layout | **`packages/` + `plugins/`** | `packages/` for framework; `plugins/` for packs. pnpm globs both |
| End-user surface | **Finer split** (core/cli/tui/testing) + `plyflow` meta | Clean boundaries, light installs; meta keeps existing install path |
| Shell step key | **`sh:`** | `run:` stays JS-only to avoid ambiguity |
| Expression stdlib | **Inject frozen helper namespace** | Evaluator already runs arbitrary JS — no new risk surface |
| Dry-run | **Engine-wide `--dry-run` + declarative per-step `dryRun:` mocks** | Replaces the `MISSION_DRYRUN` env hack; mocks live in YAML/tests, not module code |
| Sub-workflows | **Callable, with declared `inputs:`/`outputs:`** | Clean contract; only declared outputs visible to caller; resume-friendly |

---

## Part 1 — Monorepo Architecture

### Package set

```
packages/
  core/      → @plyflow/core      engine: loader, scheduler, exec, steps,
                                  expression, journal, providers, remote/
  cli/       → @plyflow/cli       arg parsing, entrypoint; depends on core (+ tui)
  tui/       → @plyflow/tui        Ink/React App + LineLogger; depends on core
  testing/   → @plyflow/testing   fakeProvider, mockExec, run helpers; depends on core
  meta/      → plyflow            thin meta-package: re-exports core API, bin → cli
plugins/
  (git/, github/  → Spec B)
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'plugins/*'
```

### Internal dependencies & publishing

- Internal deps use the `workspace:*` protocol; **publish via `pnpm publish`** so
  the protocol is rewritten to a concrete range. Never raw-`npm publish` a copied
  `dist/` (the rewrite wouldn't happen).
- All public packages set `"publishConfig": { "access": "public" }`.
- Independent versioning by default (Changesets). The `plyflow` meta-package pins
  `@plyflow/cli` (and transitively core/tui) so `npm i -g plyflow` always gets a
  coherent set.

### Build & dev ergonomics

- Each package builds with its own `tsdown` config to `dist/` (ESM, `.d.ts`).
- **Live cross-package types during dev** without a rebuild: each package exposes
  a private export condition pointing at source, alongside the published default:

  ```jsonc
  // packages/core/package.json
  "exports": {
    ".": {
      "@plyflow/source": "./src/index.ts",   // dev: live TS
      "default": "./dist/index.js"            // published
    }
  }
  ```

  with `customConditions: ["@plyflow/source"]` in the dev tsconfig. This keeps the
  published surface clean (no raw `src` in `exports`) while editors and vitest see
  live types across packages.
- ESM `.js` import extensions stay exactly as today — they are intra-package only;
  cross-package imports resolve through `exports`. Do **not** adopt
  `rewriteRelativeImportExtensions`.

### CI / release

- A `release` GitHub Actions workflow runs the Changesets action: it opens a
  "Version Packages" PR that bumps versions + writes changelogs; merging it
  publishes the changed packages.
- Publish auth prefers npm OIDC trusted publishing (auto-provenance, npm CLI
  ≥ 11.5.1). Because scoped-package + `changesets/action` + OIDC has reported
  E404 friction, the workflow keeps a granular npm automation token as a
  documented fallback path.

### Migration approach

1. Stand up pnpm workspace + Changesets + tsdown scaffolding with packages empty.
2. Move `src/core/**`, `src/providers/**`, `src/steps/**` → `packages/core/src`.
   Move `src/tui/**` → `packages/tui/src`. Move `src/cli/**` → `packages/cli/src`.
3. Fix cross-layer imports to cross-package imports (`@plyflow/core`) where they
   span packages; keep intra-package relative `.js` imports.
4. Create `@plyflow/testing` (new code, see A4) and the `plyflow` meta-package.
5. Port the test suite per package; `npm test` → `pnpm -r test` (vitest unchanged).
6. Update `examples/` and `website/` references. Cut a `0.x` release of all packages.

The pre-existing `tsc --noEmit` errors noted in `AGENTS.md` are not a gate; the
gate remains vitest. The migration must not *add* new type errors.

---

## Part 2 — Core Engine Features

### A1. Native shell step (`@plyflow/core`)

A new built-in step type keyed `sh:`, alongside `run`/`uses`/`agent`/etc. (the
exclusive-or step-type validation in `format-schema.ts` gains one arm).

```yaml
- id: issue
  sh: gh issue view ${{ inputs.issue }} --json title,body
  json: true            # parse stdout as JSON into output (default false)
  cwd: ${{ steps.setup.output.worktree_path }}
  env: { GH_TOKEN: ${{ env.GH_TOKEN }} }
  dryRun: { stdout: '{"title":"x","body":"y"}', code: 0 }
```

- **Output:** `{ stdout: string, stderr: string, code: number, json?: unknown }`.
- **Errors:** non-zero exit throws (message includes `code` + `stderr`), unless
  `continueOnError: true` — consistent with existing step error handling.
- **Expression interpolation** applies to the command string, `cwd`, `env`, and
  `dryRun` (same resolution as other steps).
- **Dry-run (see A4):** under dry-run mode the step returns its declared `dryRun:`
  result instead of executing; if none is declared it no-ops to `{ stdout: '',
  stderr: '', code: 0 }`.
- **Implementation:** wraps a single injectable `exec` function (default: Node
  `child_process`), so tests pass a `mockExec` (A4) instead of touching the shell.
  This injectable `exec` is the shared primitive Spec B's plugins also use.
- **Replaces** mission's `lib/exec.ts` outright and makes the git/gh wrappers
  either deletable (inline `sh:`) or thin (Spec B typed steps).

### A2. Object/JSON inputs + expression stdlib (`@plyflow/core`)

**Input types.** Extend the workflow `inputs:` schema (in `format-schema.ts`)
beyond `string|number|boolean` to add `object`, `json`, and `array`. CLI
`--input k=v` parsing accepts a JSON value for these types (and a `@file.json`
form for larger values). This removes the need to pass structured config as a
hand-parsed CSV string.

```yaml
inputs:
  models:
    type: object
    default: { planner: claude-opus-4-8, worker: claude-sonnet-4-6 }
```

`resolve-models.ts` (76 LoC) collapses to this input plus a one-line expression
for any per-role fallback.

**Expression stdlib.** Inject a single frozen helper namespace into the `${{ }}`
evaluation scope (`expression.ts`), available as bare identifiers:

`map, filter, flatMap, find, some, every, unique, groupBy, keys, values, entries, len, flat, sort`

```yaml
# was: uses: ./lib/flatten-findings.ts
flatten:    ${{ flatMap(values(steps.inspect.output), b => b['review-bucket'].findings) }}
# was: uses: ./lib/actionable-comments.ts
actionable: ${{ filter(steps.triage.output.comments, c => c.category == 'actionable') }}
```

- The evaluator already executes arbitrary JS via `new Function`, so injecting
  helpers adds **no new risk surface** — it only makes reshaping expressible inline.
- Helpers are pure, frozen, and side-effect free; documented as the supported set.
- **Deletes** `flatten-findings.ts`, `actionable-comments.ts`, and most of
  `findings-filter.ts` (the dedup/threshold *policy* that remains is a 1–2 line
  expression or a tiny `run:`).

### A3. Callable sub-workflows (`@plyflow/core`)

A workflow file gains an optional top-level `outputs:` block. A new step calls
another workflow via `use:` + `with:`:

```yaml
# shared/setup.yaml
name: setup
inputs:
  issue: { type: string, required: true }
outputs:
  worktree_path: ${{ steps.worktree.output.path }}
  models:        ${{ steps.models.output }}
phases: [ ... ]

# mission.yaml and comms.yaml both:
- id: setup
  use: ./shared/setup.yaml
  with: { issue: ${{ inputs.issue }} }
- id: build
  needs: [setup]
  foreach: ${{ ... }}
  # references ${{ steps.setup.output.worktree_path }}
```

**Semantics:**
- `with:` is validated against the child's `inputs:` schema (missing required →
  error; defaults applied).
- The child runs as a nested unit; **only its declared `outputs:` are visible** to
  the caller as `steps.<id>.output`. Internal child step outputs do not leak.
- **Journaling/resume:** child steps journal under a namespaced key
  (`…/use:<id>/<child-step>`), so caching and resume work across the boundary.
- Cycle detection: a workflow may not (transitively) `use:` itself.
- `use:` resolves relative paths against the calling workflow dir (and, once A5
  lands, could resolve a packaged workflow — out of scope here).
- **Deletes** the duplicated Setup phase shared by `mission.yaml` and `comms.yaml`.

### A4. Dry-run mode + `@plyflow/testing`

**Engine.** `runWorkflow(path, { dryRun: true })` and CLI `--dry-run`. A
`dryRun` flag is threaded through the step context. Side-effecting steps consult
it: `sh` (A1) returns its declared/empty mock; provider calls (agent steps) route
to the injected provider, which in tests is a fake.

**`@plyflow/testing`** (new package) exports:

```ts
// dispatch a fake AI provider by system-prompt substring → canned result
fakeProvider(rules: Record<string, unknown>): AIProvider
// e.g. fakeProvider({ 'Flight Director': FAKE_PLAN, 'Astronaut': FAKE_REPORT })

// scripted exec for sh-steps/plugins, matched by command substring
mockExec(rules: Record<string, { stdout?: string; code?: number }>): Exec

// convenience to run a workflow fully mocked
runWorkflowForTest(path, { inputs, provider, exec, dryRun }): Promise<RunResult>
```

- Replaces the hand-written `MissionFakeProvider` (prompt-keyword dispatch is now
  a library feature, robust to scheduler reordering) and the `MISSION_DRYRUN=1`
  checks across ~10 modules.
- The provider/exec injection points already exist in the engine via the
  side-effect-injection convention (`fetchImpl`, `now`, `cacheRoot`, provider
  factory); `@plyflow/testing` packages first-class fakes for them.

### A5. Plugin resolution by package specifier (`@plyflow/core`)

Small core change enabling Spec B: the plugin loader (`plugins.ts`) must resolve
**bare package specifiers** in a workflow's `plugins:` list / `package.json`
`plyflow.plugins`, not just relative paths:

```yaml
plugins:
  - '@plyflow/git'
  - '@plyflow/github'
```

The module loader already uses Node resolution, so this is a thin addition (treat
a non-`./`/`../` entry as a package specifier and resolve its export). Plugin
contract (`StepType` / register-function) is unchanged.

---

## Testing strategy

- **TDD throughout** (repo convention): failing test first, beside source as
  `*.test.ts`, fixtures in `__fixtures__/`.
- New step types (`sh`, `use:`) get parse + run unit tests and a dry-run test.
- Expression stdlib: table-driven tests per helper; an eval-scope test asserting
  helpers are present and frozen.
- `@plyflow/testing`: self-tests for `fakeProvider`/`mockExec`, plus an
  end-to-end "mission dry-run" test that exercises sub-workflows + sh + fakes with
  zero network/shell.
- Monorepo gate: `pnpm -r test` (vitest), `pnpm -r build` (tsdown). Lint per
  package with eslint.

## Risks & open questions

- **Changesets + OIDC for scoped packages** — reported E404 friction; mitigate
  with a granular npm token fallback and verify current `changesets/action` notes
  at implementation time.
- **tsdown migration** — low risk (designed migrator), but validate `.d.ts` output
  and ESM `.js` extension handling per package before cutting a release.
- **Sub-workflow resume keying** — must integrate cleanly with the existing
  journal nested-key scheme (`phase:/loop:/foreach:`); add `use:` as a sibling
  namespace and test resume explicitly.
- **Expression stdlib scope creep** — fix the helper set in this spec; resist
  growing it into a DSL. Anything beyond array reshaping belongs in `run:`/`sh:`.

## Out of scope (Spec B)

`@plyflow/git` and `@plyflow/github` plugin packs, and the migration of mission's
`git-*`/`gh-*` modules onto them. Spec B depends on A1 (shell primitive), A4
(dry-run), and A5 (plugin-by-specifier).
