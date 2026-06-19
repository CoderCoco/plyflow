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
npm install
npm run build
```

`npm run build` runs [tsup](https://tsup.egoist.dev/) and emits compiled output to `dist/`. The CLI entry point is `dist/cli/index.js`.

## Available scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript with tsup |
| `npm run dev` | Run the CLI directly via tsx (no build step) |
| `npm test` | Run the full test suite with [Vitest](https://vitest.dev/) |
| `npm run test:watch` | Watch mode for tests |
| `npm run lint` | Lint with ESLint + typescript-eslint |

## Project layout

```
src/
  cli/          CLI entry point and command parsing
  core/         Engine, loader, journal, expression evaluator, exec utilities
  steps/        Built-in step type implementations
  providers/    AI provider implementations
  tui/          Ink/React terminal UI (live progress tree, input prompts)
  schema/       Zod schemas for workflow and agent YAML validation
```

### Key source files

| File | Purpose |
|------|---------|
| `src/index.ts` | Public library API — re-exports `runWorkflow`, `buildDefaultRegistry`, `loadWorkflow`, `loadAgent`, and their types |
| `src/core/engine.ts` | `runWorkflow` implementation; `RunOptions` and `EngineEvent` types |
| `src/core/exec.ts` | `runSteps` — the per-phase parallel scheduler that honours `needs:` |
| `src/core/loader.ts` | `loadWorkflow` and `loadAgent` — parse and validate YAML/Markdown |
| `src/core/journal.ts` | Resume journaling — write, read, and update run state |
| `src/core/module-loader.ts` | Module loader for workflow-local TypeScript (via jiti) |
| `src/core/workflow-env.ts` | `prepareEnv` — installs workflow npm deps before running |
| `src/core/plugins.ts` | Plugin loader — imports step-type plugin modules |
| `src/steps/registry.ts` | `StepRegistry` — register and look up step types |
| `src/steps/run.ts` | `run:` / `uses:` step type |
| `src/steps/agent.ts` | `agent:` step type |
| `src/steps/input.ts` | `input:` step type |
| `src/steps/widget.ts` | `widget:` step type |
| `src/steps/parallel.ts` | `parallel:` step type |
| `src/steps/loop.ts` | `loop:` step type |
| `src/steps/foreach.ts` | `foreach:` step type |
| `src/providers/claude.ts` | `ClaudeProvider` (api / cli / agent-sdk modes) |
| `src/providers/fake.ts` | `FakeProvider` for tests |
| `src/providers/factory.ts` | `makeProvider(name, mode)` convenience factory |
| `src/providers/types.ts` | `AIProvider`, `AICompleteRequest`, `AIResult` interfaces |
| `src/steps/types.ts` | `StepType`, `StepContext`, `UiRequest` interfaces |

## Adding a new step type

A step type implements the `StepType<Cfg>` interface from `src/steps/types.ts`:

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

Register it in `buildDefaultRegistry()` in `src/core/engine.ts` if it is a built-in step type, or export it from a plugin module for user-defined step types.

## Adding a new AI provider

Implement the `AIProvider` interface from `src/providers/types.ts`:

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

Tests use [Vitest](https://vitest.dev/) and are co-located with the source files they test (e.g. `src/core/engine.test.ts` next to `src/core/engine.ts`).

- Use `FakeProvider` from `src/providers/fake.ts` for all tests that involve agent steps — it accepts a queue of scripted `AIResult` objects and never makes real API calls.
- Set `isTty: false` in `RunOptions` for tests that run `input` or `widget` steps, and supply `default:` in the workflow YAML or a `prompt` handler in options.
- Set `exec: async () => {}` (a no-op) to skip real npm installs in tests that use workflows with `package.json`.

Run the suite:

```bash
npm test
```

Run a single file:

```bash
npx vitest run src/core/engine.test.ts
```

## Linting

```bash
npm run lint
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
2. Make your changes and ensure `npm test` and `npm run lint` pass.
3. If you changed the docs, ensure `cd website && npm run build` succeeds.
4. Open a pull request against `main` with a clear description of what changed and why.
