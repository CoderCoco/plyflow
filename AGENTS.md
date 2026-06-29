# AGENTS.md

Guidance for working in the **plyflow** repository. This is the canonical
instructions file for AI coding agents (Codex, Cursor, Gemini CLI, Zed, etc.).
`CLAUDE.md` is a symlink to this file so Claude Code reads the same content.

## What this is

plyflow runs AI-agent workflows defined in YAML — "GitHub Actions for AI agents."
A workflow is a YAML file with `phases` (run sequentially) containing `steps`
(run in parallel within a phase unless constrained by `needs`). Steps dispatch by
exactly one type key: `run` | `uses` | `agent` | `input` | `parallel` | `loop` |
`foreach` | `widget` | `step` | `sh` | `use`. It ships as a CLI (`plyflow run <file>`) with an
interactive Ink/React TUI, and is also usable as a library.

## Commands

| Task | Command |
|------|---------|
| Run all tests | `pnpm test` (vitest, all packages) |
| Test one package | `pnpm --filter @plyflow/core test` |
| Build all | `pnpm -r build` |
| Lint | `pnpm -r lint` (eslint) |
| Run the CLI from source | `pnpm dev -- run <file.yaml> --input k=v` |
| Add a changeset | `pnpm changeset` |
| Dry-run (no shell) | `pnpm dev -- run <file.yaml> --dry-run` |

## Conventions (follow these)

- **TypeScript, ESM, Node ≥24.** Relative imports MUST use the `.js` extension
  even in `.ts` source (e.g. `import { x } from './ref.js'`). This is required by
  the ESM module resolution — omitting it breaks the build.
- **TDD.** Write the failing test first, watch it fail, implement minimally, watch
  it pass, commit. Tests live beside source as `*.test.ts`; fixtures in a sibling
  `__fixtures__/` directory. Use `@plyflow/testing` (`fakeProvider`, `mockExec`) when writing
  tests that run full workflows — these eliminate real network/shell calls.
- **Inject side effects for testability.** Network/clock/filesystem-root
  dependencies are passed as optional params with real defaults
  (`fetchImpl = globalThis.fetch`, `now = () => Date.now()`, `cacheRoot = …`), so
  unit tests never touch the real network or wall clock. See `packages/core/src/core/remote/`
  for the pattern.
- **Small, single-responsibility files** with well-defined interfaces.
- **Hand-rolled CLI parsing** in `packages/cli/src/args.ts` — no commander/yargs. Add flags
  there directly.
- **Conventional Commits** for commit messages.

## Input types and expression stdlib

- **Structured inputs:** `inputs:` declarations accept `type: object | json | array` in addition to `string | number | boolean`; the CLI coerces `--input k='<json>'` or reads from file with `--input k=@path.json`.
- **Expression helpers:** 14 frozen helpers (`map`, `filter`, `flatMap`, `find`, `some`, `every`, `unique`, `groupBy`, `keys`, `values`, `entries`, `len`, `flat`, `sort`) are injected as bare identifiers into every `${{ }}` expression; a workflow binding with the same name shadows the helper.

## Architecture map

This is a pnpm workspace monorepo. Source lives under `packages/`:

- `packages/cli/src/` — entrypoint (`index.ts`), arg parsing (`args.ts`), trust prompt
  (`trust-prompt.ts`). TTY renders the Ink `App`; non-TTY uses `LineLogger`.
- `packages/core/src/` — the engine. `engine.ts` (`runWorkflow`), `exec.ts` (step
  execution), `scheduler.ts` (DAG → waves), `loader.ts` (YAML/agent loading),
  `format-schema.ts` (Zod validation), `expression.ts` (`${{ }}` evaluation),
  `journal.ts` (resume), `module-loader.ts` (jiti runtime TS loading),
  `workflow-env.ts` (per-workflow `package.json` deps).
- `packages/core/src/core/remote/` — run workflows from GitHub. `ref.ts` parses references,
  `fetch.ts` downloads+extracts the repo tarball, `cache.ts` is the cache policy,
  `trust.ts` is the content-hash trust store, `resolve.ts` orchestrates, `index.ts`
  is the barrel. The resolver returns a local path so the engine runs unchanged.
- `packages/core/src/steps/` — step type implementations + the registry.
- `packages/core/src/providers/` — AI provider abstraction (Claude first; pluggable).
- `packages/tui/src/` — Ink/React terminal UI.
- `packages/meta/` — the `plyflow` meta-package that re-exports `@plyflow/core` and
  wires the `plyflow` bin; preserves the existing npm install path and library import.
- `packages/testing/src/` — `@plyflow/testing`: `fakeProvider(rules)` (scripted `AIProvider`) and `mockExec(rules)` (scripted `ShellExec`) for testing workflows without network or shell; install as a dev dependency.
- `plugins/` — reserved for first-party plugin packs (Spec B feature plan).
- `examples/` — runnable workflows (`summarize.yaml`, `mission/`, `plugins/`,
  `widgets/`).
- `website/` — Docusaurus docs site (`website/docs/`, ordered by
  `website/sidebars.ts`). Update docs here when changing user-facing behavior.

## Gotchas

- **`tsc --noEmit` is NOT a clean gate.** The repo has pre-existing type errors
  (in `packages/cli/src/index.ts` and several `*.test.ts` files). The build uses `tsdown` and
  the test gate is `vitest`. Use `pnpm test` to gate changes; only worry about NEW
  tsc errors your change introduces, not the pre-existing ones.
- `pnpm -r lint` may report an error in gitignored scratch under `.remember/tmp/`
  that is unrelated to your change; lint your specific files with
  `npx eslint <path>` to confirm they are clean.
- Run state lives in `.plyflow/runs/<runId>.json` (gitignored). Remote-workflow
  cache lives in `~/.plyflow/cache/`; the trust store in `~/.plyflow/trust.json`.
