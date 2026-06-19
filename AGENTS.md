# AGENTS.md

Guidance for working in the **plyflow** repository. This is the canonical
instructions file for AI coding agents (Codex, Cursor, Gemini CLI, Zed, etc.).
`CLAUDE.md` is a symlink to this file so Claude Code reads the same content.

## What this is

plyflow runs AI-agent workflows defined in YAML — "GitHub Actions for AI agents."
A workflow is a YAML file with `phases` (run sequentially) containing `steps`
(run in parallel within a phase unless constrained by `needs`). Steps dispatch by
exactly one type key: `run` | `uses` | `agent` | `input` | `parallel` | `loop` |
`foreach` | `widget` | `step`. It ships as a CLI (`plyflow run <file>`) with an
interactive Ink/React TUI, and is also usable as a library.

## Commands

| Task | Command |
|------|---------|
| Run all tests | `npm test` (vitest) |
| Run one test file | `npx vitest run <path>` |
| Watch tests | `npm run test:watch` |
| Build | `npm run build` (tsup → `dist/`) |
| Lint | `npm run lint` (eslint) |
| Run the CLI from source | `npm run dev -- run <file.yaml> --input k=v` |

## Conventions (follow these)

- **TypeScript, ESM, Node ≥24.** Relative imports MUST use the `.js` extension
  even in `.ts` source (e.g. `import { x } from './ref.js'`). This is required by
  the ESM module resolution — omitting it breaks the build.
- **TDD.** Write the failing test first, watch it fail, implement minimally, watch
  it pass, commit. Tests live beside source as `*.test.ts`; fixtures in a sibling
  `__fixtures__/` directory.
- **Inject side effects for testability.** Network/clock/filesystem-root
  dependencies are passed as optional params with real defaults
  (`fetchImpl = globalThis.fetch`, `now = () => Date.now()`, `cacheRoot = …`), so
  unit tests never touch the real network or wall clock. See `src/core/remote/`
  for the pattern.
- **Small, single-responsibility files** with well-defined interfaces.
- **Hand-rolled CLI parsing** in `src/cli/args.ts` — no commander/yargs. Add flags
  there directly.
- **Conventional Commits** for commit messages.

## Architecture map

- `src/cli/` — entrypoint (`index.ts`), arg parsing (`args.ts`), trust prompt
  (`trust-prompt.ts`). TTY renders the Ink `App`; non-TTY uses `LineLogger`.
- `src/core/` — the engine. `engine.ts` (`runWorkflow`), `exec.ts` (step
  execution), `scheduler.ts` (DAG → waves), `loader.ts` (YAML/agent loading),
  `format-schema.ts` (Zod validation), `expression.ts` (`${{ }}` evaluation),
  `journal.ts` (resume), `module-loader.ts` (jiti runtime TS loading),
  `workflow-env.ts` (per-workflow `package.json` deps).
- `src/core/remote/` — run workflows from GitHub. `ref.ts` parses references,
  `fetch.ts` downloads+extracts the repo tarball, `cache.ts` is the cache policy,
  `trust.ts` is the content-hash trust store, `resolve.ts` orchestrates, `index.ts`
  is the barrel. The resolver returns a local path so the engine runs unchanged.
- `src/steps/` — step type implementations + the registry.
- `src/providers/` — AI provider abstraction (Claude first; pluggable).
- `src/tui/` — Ink/React terminal UI.
- `examples/` — runnable workflows (`summarize.yaml`, `mission/`, `plugins/`,
  `widgets/`).
- `website/` — Docusaurus docs site (`website/docs/`, ordered by
  `website/sidebars.ts`). Update docs here when changing user-facing behavior.

## Gotchas

- **`tsc --noEmit` is NOT a clean gate.** The repo has pre-existing type errors
  (in `src/cli/index.ts` and several `*.test.ts` files). The build uses `tsup` and
  the test gate is `vitest`. Use `npm test` to gate changes; only worry about NEW
  tsc errors your change introduces, not the pre-existing ones.
- `npm run lint` may report an error in gitignored scratch under `.remember/tmp/`
  that is unrelated to your change; lint your specific files with
  `npx eslint <path>` to confirm they are clean.
- Run state lives in `.plyflow/runs/<runId>.json` (gitignored). Remote-workflow
  cache lives in `~/.plyflow/cache/`; the trust store in `~/.plyflow/trust.json`.
