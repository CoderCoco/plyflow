---
sidebar_position: 10
---

# Testing Workflows

plyflow ships a dedicated `@plyflow/testing` package with fakes for the AI provider and shell executor, so you can run real workflow files in unit tests without touching the network or a real shell.

## Installation

```bash
npm install --save-dev @plyflow/testing
```

## `fakeProvider(rules)`

Returns an `AIProvider` that matches each incoming request's `system` prompt against a set of rules and returns the scripted response — no API key or network required.

```typescript
import { fakeProvider } from '@plyflow/testing';
import type { AIProvider } from 'plyflow';

const provider: AIProvider = fakeProvider({
  // key = substring to match in the agent's system prompt
  // string value → { text: '...' }   (agent step output = the string)
  // object value → { structured: … } (only surfaced when the step has an output schema)
  'Flight Director': 'planned: a, b',
  'Summarizer': 'Here is the summary.',
});
```

Rules are matched in insertion order; the first key that appears as a substring of the system prompt wins. If no rule matches, `fakeProvider` throws so tests can't silently pass with an unmatched prompt.

### Agent step output shape

The agent step (`agent:` key in a workflow YAML) returns different shapes depending on whether an `output:` schema path is specified on the step:

- **With `output:`** — the step validates and returns `result.structured` through the schema.
- **Without `output:`** — the step returns `result.text ?? ''`. Supply a string rule to `fakeProvider` so the text is non-empty and assertable.

## `mockExec(rules)`

Returns a `ShellExec` that matches each `sh` step command against a set of rules and returns scripted `{ stdout, stderr, code }` — no real shell process is spawned.

```typescript
import { mockExec } from '@plyflow/testing';
import type { ShellExec } from 'plyflow';

const shellExec: ShellExec = mockExec({
  // key = substring to match in the shell command
  'gh issue view': { stdout: '{"title":"Bug"}', code: 0 },
  'npm run build': { stdout: '', stderr: 'build failed', code: 1 },
});
```

If no rule matches, `mockExec` throws so tests can't silently run real shell commands.

## Running a workflow in tests

Compose `fakeProvider` and `mockExec` directly with `runWorkflow`:

```typescript
import { runWorkflow } from 'plyflow';
import { fakeProvider, mockExec } from '@plyflow/testing';
import { it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('runs an agent + sh workflow with no network and no real shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-test-'));
  writeFileSync(
    join(dir, 'planner.md'),
    '---\nmodel: claude-opus-4-8\n---\nYou are the Flight Director. Produce a plan.',
  );
  writeFileSync(
    join(dir, 'w.yaml'),
    `name: w
phases:
  - name: p
    steps:
      - id: plan
        agent: ./planner.md
        prompt: go
      - id: fetch
        sh: gh issue view 7 --json title
        json: true`,
  );

  const res = await runWorkflow(join(dir, 'w.yaml'), {
    isTty: false,
    provider: fakeProvider({ 'Flight Director': 'planned: a, b' }),
    shellExec: mockExec({ 'gh issue view': { stdout: '{"title":"Bug"}', code: 0 } }),
  });

  expect(res.outputs.plan).toBe('planned: a, b');
  expect((res.outputs.fetch as { json: unknown }).json).toEqual({ title: 'Bug' });
});
```

## `--dry-run` CLI flag

The CLI supports a `--dry-run` flag that skips side-effecting steps (`sh`) and returns their configured `dryRun:` stub output instead:

```bash
plyflow run workflow.yaml --dry-run
```

In a workflow YAML, each `sh` step can declare a fallback `dryRun:` block:

```yaml
steps:
  - id: deploy
    sh: kubectl apply -f manifest.yaml
    dryRun:
      stdout: '[dry-run] would apply manifest'
      code: 0
```

When `--dry-run` is active, the step returns the stub without running any shell command.

## `runWorkflow` dry-run and shell injection options

| Option | Type | Description |
|--------|------|-------------|
| `dryRun` | `boolean` | Skip `sh` steps; return their `dryRun:` stub output. |
| `shellExec` | `ShellExec` | Replace the real shell with a custom function. Used by `mockExec` in tests. **Ignored when a custom `registry` is passed** — supply `shellExec` to `buildDefaultRegistry()` instead. |

```typescript
import { runWorkflow, buildDefaultRegistry } from 'plyflow';
import { mockExec } from '@plyflow/testing';

// Option A: let runWorkflow wire shellExec into the default registry automatically
const res = await runWorkflow('./w.yaml', {
  provider,
  shellExec: mockExec({ 'echo hello': { stdout: 'hello', code: 0 } }),
});

// Option B: custom registry — pass shellExec to buildDefaultRegistry() directly
const registry = buildDefaultRegistry(mockExec({ 'echo hello': { stdout: 'hello', code: 0 } }));
const res2 = await runWorkflow('./w.yaml', { provider, registry });
```
