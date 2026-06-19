---
sidebar_position: 9
---

# Programmatic Usage

plyflow is both a CLI and a Node.js/TypeScript library. You can import it directly to embed workflows in your own application, drive it from tests, or build custom tooling on top of the engine.

## Installation

```bash
npm install plyflow
```

Requires Node.js ≥24.

## Public API

The package exports the following from `plyflow` (i.e. `dist/index.js`):

| Export | Kind | Purpose |
|--------|------|---------|
| `runWorkflow` | function | Execute a workflow file end-to-end |
| `buildDefaultRegistry` | function | Create a step registry pre-loaded with all built-in step types |
| `loadWorkflow` | function | Parse and validate a workflow YAML file (without running it) |
| `loadAgent` | function | Parse and validate an agent Markdown file |
| `RunOptions` | type | Options object for `runWorkflow` |
| `EngineEvent` | type | Discriminated union of all events emitted during a run |
| `AIProvider` | type | Interface that a provider must implement |

## Running a workflow

```typescript
import { runWorkflow, buildDefaultRegistry } from 'plyflow';
import { ClaudeProvider } from 'plyflow/dist/providers/claude.js';

const provider = new ClaudeProvider({ mode: 'api' }); // reads ANTHROPIC_API_KEY

const { runId, outputs } = await runWorkflow('./workflows/summarize.yaml', {
  provider,
  inputs: { text: 'The quick brown fox…' },
  onEvent(event) {
    if (event.type === 'step-done') {
      console.log(`[${event.stepId}]`, event.output);
    }
  },
});

console.log('run id:', runId);
console.log('outputs:', outputs);
```

### `RunOptions` reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `AIProvider` | yes | AI provider instance (e.g. `ClaudeProvider`) |
| `inputs` | `Record<string, unknown>` | no | Values for the workflow's declared inputs |
| `runId` | `string` | no | Pass a previous run's ID to resume from where it left off |
| `runDir` | `string` | no | Where to write journal files (default: `.plyflow/runs`) |
| `registry` | `StepRegistry` | no | Custom step registry; defaults to `buildDefaultRegistry()` |
| `onEvent` | `(e: EngineEvent) => void` | no | Callback fired for every engine event |
| `prompt` | `(stepId, req) => Promise<unknown>` | no | Handler for `input` and `widget` steps in non-TTY environments |
| `isTty` | `boolean` | no | Override TTY detection; defaults to `process.stdout.isTTY` |
| `exec` | `Exec` | no | Override npm execution for workflow dependency installation (useful in tests) |

### `EngineEvent` union

```typescript
type EngineEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'step-start'; stepId: string }
  | { type: 'step-done'; stepId: string; output: unknown; cached: boolean }
  | { type: 'step-error'; stepId: string; error: string }
  | { type: 'step-log'; stepId: string; message: string }
  | { type: 'step-skipped'; stepId: string };
```

## Resuming an interrupted run

Pass the `runId` from a previous run back into `runWorkflow`. The engine loads the journal and skips already-completed steps:

```typescript
const first = await runWorkflow('./workflows/pipeline.yaml', { provider, inputs });
// Later, resume after an interruption:
const resumed = await runWorkflow('./workflows/pipeline.yaml', {
  provider,
  inputs,
  runId: first.runId,
});
```

## Handling `input` steps programmatically

When `isTty` is `false` (or the process is not a TTY), `input` and `widget` steps require either a `default:` value in the workflow YAML or a `prompt` handler:

```typescript
await runWorkflow('./workflows/confirm.yaml', {
  provider,
  isTty: false,
  prompt: async (stepId, req) => {
    if (req.kind === 'prompt' && req.type === 'confirm') {
      return true; // auto-approve
    }
    return 'default value';
  },
});
```

## Using a custom provider

Any object that implements `AIProvider` works:

```typescript
import type { AIProvider, AICompleteRequest, AIResult } from 'plyflow';

const loggingProvider: AIProvider = {
  name: 'logging',
  async complete(req: AICompleteRequest): Promise<AIResult> {
    console.log('Calling model:', req.model);
    // delegate to a real provider…
    return { text: 'response here' };
  },
};
```

## Using `FakeProvider` in tests

`FakeProvider` accepts a queue of scripted `AIResult` objects and returns them in order. Import it from the built package:

```typescript
import { runWorkflow, buildDefaultRegistry } from 'plyflow';
import { FakeProvider } from 'plyflow/dist/providers/fake.js';
import { describe, it, expect } from 'vitest';

describe('summarize workflow', () => {
  it('returns the agent output', async () => {
    const provider = new FakeProvider([
      { text: 'This is the summary.' },
    ]);

    const { outputs } = await runWorkflow('./workflows/summarize.yaml', {
      provider,
      isTty: false,
      inputs: { text: 'Some long text…' },
    });

    expect(outputs['summarise']).toBe('This is the summary.');
    expect(provider.calls).toHaveLength(1);
  });
});
```

`FakeProvider` exposes `calls: AICompleteRequest[]` so you can assert on what was sent to the model.

## Building a custom step registry

If you only need a subset of built-in steps, or want to add custom step types without using a workflow `plugins:` entry, build your own registry:

```typescript
import { buildDefaultRegistry, runWorkflow } from 'plyflow';
// Import StepType from the built package
import type { StepType } from 'plyflow/dist/steps/types.js';

const registry = buildDefaultRegistry();

const myStep: StepType<{ message: string }> = {
  name: 'greet',
  match: (def) => def.step === 'greet',
  parse: (def) => ({ message: String(def.with?.message ?? 'hello') }),
  run: async (cfg) => ({ output: cfg.message.toUpperCase() }),
};
registry.register(myStep);

await runWorkflow('./workflow.yaml', { provider, registry });
```

## Provider modes

`ClaudeProvider` supports three modes:

| Mode | Description | Requirement |
|------|-------------|-------------|
| `api` | Direct Anthropic API calls | `ANTHROPIC_API_KEY` env var |
| `cli` | Spawns the local `claude` CLI (`claude -p …`) | `claude` CLI installed |
| `agent-sdk` | Uses `@anthropic-ai/claude-agent-sdk` with full tool access | Claude Code creds; Node ≥22 (Node 24 recommended) |

```typescript
import { ClaudeProvider } from 'plyflow/dist/providers/claude.js';
import { makeProvider } from 'plyflow/dist/providers/factory.js';

// Explicit constructor:
const provider = new ClaudeProvider({ mode: 'cli' });

// Factory helper (name + mode):
const p2 = makeProvider('claude', 'agent-sdk');
```
