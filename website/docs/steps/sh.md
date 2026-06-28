---
sidebar_position: 10
---

# `sh` Steps

A `sh:` step runs a shell command and captures its output. It is the lowest-level primitive for integrating any external tool, script, or system command into a workflow.

## Basic syntax

```yaml
- id: build
  sh: pnpm -r build
```

The `sh:` value is the command string, executed through the system shell (`/bin/sh` on Unix, `cmd.exe` on Windows). The full `PATH` is inherited from the parent process.

## Output shape

A `sh:` step always produces a structured output object:

```typescript
{
  stdout: string;   // captured standard output
  stderr: string;   // captured standard error
  code: number;     // exit code (0 = success)
  json?: unknown;   // parsed JSON (only when json: true)
}
```

Access these fields in later steps via `ctx.steps.<id>.output.stdout` (in `run:`) or `${{ steps.<id>.output.stdout }}` (in expressions).

## Fields

### `sh:` (required)

The command to run. Supports expression interpolation:

```yaml
- id: greet
  sh: 'echo "Hello, ${{ inputs.name }}!"'
```

### `json: true`

Parse `stdout` as JSON and expose it on the `json` field:

```yaml
- id: info
  sh: node -e "console.log(JSON.stringify({version: process.version}))"
  json: true

- id: use
  needs: [info]
  run: return ctx.steps.info.output.json;
```

### `cwd`

Override the working directory for the command. Supports expression interpolation. Defaults to the process's current working directory at runtime (the directory from which the `plyflow` command was invoked).

```yaml
- id: test
  sh: pnpm test
  cwd: ./packages/core
```

### `env`

Layer extra environment variables over the inherited process environment (`process.env`). Listed keys override their inherited values; all other environment variables (including `PATH`, `HOME`, etc.) are inherited unchanged. Values support expression interpolation.

```yaml
- id: deploy
  sh: ./scripts/deploy.sh
  env:
    NODE_ENV: production
    API_KEY: "${{ inputs.apiKey }}"
```

### `dryRun`

Declare a mock result to return when the engine is in dry-run mode. Use this for steps whose real commands have side effects.

```yaml
- id: publish
  sh: npm publish
  dryRun:
    stdout: "(dry-run: publish skipped)"
    code: 0
```

When `dryRun:` is omitted and the engine is running in dry-run mode, the step returns `{ stdout: '', stderr: '', code: 0 }` without executing the command.

## Non-zero exit codes

A non-zero exit code causes the step to **throw an error** by default. The error message includes the exit code and the last line of stderr (or stdout if stderr is empty).

This integrates uniformly with the standard `continueOnError` and `retry` step fields:

```yaml
- id: lint
  sh: pnpm lint
  continueOnError: true   # workflow continues even if lint fails

- id: flaky
  sh: ./scripts/network-op.sh
  retry:
    maxAttempts: 3
    delay: 2000
```

## Accessing output in later steps

```yaml
- id: version
  sh: node -e "process.stdout.write(process.version)"

- id: report
  needs: [version]
  run: return `Node version is ${ctx.steps.version.output.stdout}`;
```

## Dry-run mode

The `sh:` step honors the engine's dry-run mode. When dry-run is active:

1. If the step has a `dryRun:` declaration, that mock result is returned immediately — the real command is never spawned.
2. If there is no `dryRun:` declaration, the step returns `{ stdout: '', stderr: '', code: 0 }` without spawning a process.

This means a workflow with destructive shell commands can be previewed safely when the engine runs in dry-run mode.

## Programmatic use

The `sh:` step is exported from `@plyflow/core` so you can inject a custom executor for testing:

```typescript
import { makeShStep, defaultShellExec } from '@plyflow/core';
import type { ShellExec, ShellResult } from '@plyflow/core';

// Use a fake executor in tests
const fakeExec: ShellExec = async () => ({ stdout: 'mocked', stderr: '', code: 0 });
const shStep = makeShStep(fakeExec);
```
