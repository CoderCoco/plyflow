---
sidebar_position: 15
---

# Contributing / Development

## Prerequisites

- **Node.js 24** — plyflow's `engines` field requires `>=24`. Use [nvm](https://github.com/nvm-sh/nvm) to manage versions:

```bash
nvm install 24
nvm use 24
node --version   # v24.x.x
```

- **Git** — clone the repository and create a branch.

## Getting started

```bash
git clone https://github.com/CoderCoco/plyflow.git
cd plyflow
pnpm install
pnpm -r build
```

`pnpm -r build` runs [tsdown](https://tsdown.dev/) in each package and emits compiled output to each package's `dist/`. The CLI entry point lives in `packages/cli/dist/index.js`.

## Available scripts

| Script | Description |
|--------|-------------|
| `pnpm -r build` | Compile TypeScript with tsdown in all packages |
| `npm run dev -- run <file>` | Run the CLI directly via tsx (no build step, from packages/cli) |
| `pnpm test` | Run the full test suite with [Vitest](https://vitest.dev/) |
| `npm run test:watch` | Watch mode for tests (run from a package directory) |
| `pnpm -r lint` | Lint with ESLint + typescript-eslint |

## Project layout

```
packages/
  cli/          CLI entry point and command parsing (packages/cli/src/)
  core/         Engine, loader, journal, expression evaluator, exec utilities (packages/core/src/)
  tui/          Ink/React terminal UI (live progress tree, input prompts) (packages/tui/src/)
  meta/         plyflow meta-package (re-exports core, wires up the bin) (packages/meta/)
```

### Key source files

| File | Purpose |
|------|---------|
| `packages/core/src/index.ts` | Public library API — re-exports `runWorkflow`, `buildDefaultRegistry`, `loadWorkflow`, `loadAgent`, and their types |
| `packages/core/src/core/engine.ts` | `runWorkflow` implementation; `RunOptions` and `EngineEvent` types |
| `packages/core/src/core/exec.ts` | `runSteps` — the per-phase parallel scheduler that honours `needs:` |
| `packages/core/src/core/loader.ts` | `loadWorkflow` and `loadAgent` — parse and validate YAML/Markdown |
| `packages/core/src/core/journal.ts` | Resume journaling — write, read, and update run state |
| `packages/core/src/core/module-loader.ts` | Module loader for workflow-local TypeScript (via jiti) |
| `packages/core/src/core/workflow-env.ts` | `prepareEnv` — installs workflow npm deps before running |
| `packages/core/src/core/plugins.ts` | Plugin loader — imports step-type plugin modules |
| `packages/core/src/steps/registry.ts` | `StepRegistry` — register and look up step types |
| `packages/core/src/steps/run.ts` | `run:` / `uses:` step type |
| `packages/core/src/steps/agent.ts` | `agent:` step type |
| `packages/core/src/steps/input.ts` | `input:` step type |
| `packages/core/src/steps/widget.ts` | `widget:` step type |
| `packages/core/src/steps/parallel.ts` | `parallel:` step type |
| `packages/core/src/steps/loop.ts` | `loop:` step type |
| `packages/core/src/steps/foreach.ts` | `foreach:` step type |
| `packages/core/src/providers/claude.ts` | `ClaudeProvider` (api / cli / agent-sdk modes) |
| `packages/core/src/providers/fake.ts` | `FakeProvider` for tests |
| `packages/core/src/providers/factory.ts` | `makeProvider(name, mode)` convenience factory |
| `packages/core/src/providers/types.ts` | `AIProvider`, `AICompleteRequest`, `AIResult` interfaces |
| `packages/core/src/steps/types.ts` | `StepType`, `StepContext`, `UiRequest` interfaces |

## Adding a new step type

A step type implements the `StepType<Cfg>` interface from `packages/core/src/steps/types.ts`:

```typescript
import type { StepType } from '../steps/types.js';

interface MyCfg {
  message: string;
}

export const myStep: StepType<MyCfg> = {
  name: 'my-step',
  // match returns true when this type should handle the step definition
  match: (def) => 'myKey' in def,
  // parse extracts and validates config from the raw YAML step definition
  parse: (def) => ({ message: String(def.with?.message ?? '') }),
  // run executes the step and returns { output }
  run: async (cfg, ctx) => {
    ctx.emit({ type: 'log', message: `Running: ${cfg.message}` });
    return { output: cfg.message.toUpperCase() };
  },
};
```

Register it in `buildDefaultRegistry()` in `packages/core/src/core/engine.ts` if it is a built-in step type, or export it from a plugin module for user-defined step types.

## Adding a new AI provider

Implement the `AIProvider` interface from `packages/core/src/providers/types.ts`:

```typescript
import type { AIProvider, AICompleteRequest, AIResult } from './types.js';

export class MyProvider implements AIProvider {
  name = 'my-provider';

  async complete(req: AICompleteRequest): Promise<AIResult> {
    // req.system — system prompt string
    // req.prompt — user prompt string
    // req.model  — model identifier
    // req.outputSchema — JSON Schema if structured output is requested
    const text = await callMyApi(req.system, req.prompt, req.model);
    return { text };
  }
}
```

Pass an instance to `runWorkflow` via `RunOptions.provider`.

## Test conventions

Tests use [Vitest](https://vitest.dev/) and are co-located with the source files they test (e.g. `packages/core/src/core/engine.test.ts` next to `packages/core/src/core/engine.ts`).

- Use `FakeProvider` from `packages/core/src/providers/fake.ts` for all tests that involve agent steps — it accepts a queue of scripted `AIResult` objects and never makes real API calls.
- Set `isTty: false` in `RunOptions` for tests that run `input` or `widget` steps, and supply `default:` in the workflow YAML or a `prompt` handler in options.
- Set `exec: async () => {}` (a no-op) to skip real npm installs in tests that use workflows with `package.json`.

Run the suite:

```bash
pnpm test
```

Run a single file:

```bash
npx vitest run packages/core/src/core/engine.test.ts
```

## Linting

```bash
pnpm -r lint
```

plyflow uses ESLint with `typescript-eslint`. Fix lint errors before opening a pull request.

## Docs site

The documentation site lives under `website/` and is built with [Docusaurus 3](https://docusaurus.io/).

```bash
cd website
npm install
npm run build   # must succeed with no broken links (onBrokenLinks: 'throw')
npm run start   # local dev server
```

When adding a new doc page, also add an entry to `website/sidebars.ts`.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your changes and ensure `pnpm test` and `pnpm -r lint` pass.
3. If you changed the docs, ensure `cd website && npm run build` succeeds.
4. Open a pull request against `main` with a clear description of what changed and why.
