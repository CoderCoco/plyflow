---
sidebar_position: 11
---

# `use` Steps

A `use:` step runs another workflow file as a sub-workflow. It is the primary composition primitive in plyflow — you can factor repeated setup logic into a shared workflow and call it from multiple parent workflows.

## Basic syntax

```yaml
- id: setup
  use: ./setup.yaml
  with:
    issue: "${{ inputs.issue }}"
```

The `use:` value is a path to a workflow YAML file, resolved relative to the parent workflow's directory. The `with:` map becomes the child workflow's inputs.

## How it works

1. The engine resolves the `use:` path relative to the parent workflow's directory.
2. It passes the resolved `with:` values as the child workflow's `inputs`.
3. The child workflow runs to completion as a fresh `runWorkflow` call.
4. Only the outputs declared in the child's top-level `outputs:` block are exposed to the parent. Internal step outputs do not leak across the boundary.
5. The sub-workflow's declared outputs become the `use:` step's output object, accessible in later steps as `ctx.steps.<id>.output.<key>` (in `run:`) or `${{ steps.<id>.output.<key> }}` (in expressions).

## The `with:` map

`with:` is a key/value map that becomes the child workflow's inputs. Values support expression interpolation:

```yaml
- id: setup
  use: ./setup.yaml
  with:
    issue: "${{ inputs.issue }}"
    branch: main
```

The child's `inputs:` block validates the values — required inputs without a default will fail if not provided, and type checking applies.

## The workflow-level `outputs:` block

A workflow declares which of its step outputs to expose via a top-level `outputs:` block. This is a string-to-expression map:

```yaml
name: setup
inputs:
  issue:
    type: string
    required: true
outputs:
  branch: "${{ steps.b.output }}"
phases:
  - name: p
    steps:
      - id: b
        run: return "issue-" + ctx.inputs.issue
```

When another workflow calls this via `use:`, only `branch` is visible. The step `b`'s output is not directly accessible from the parent.

Only keys declared in `outputs:` are returned; undeclared step outputs stay private to the child workflow. If a workflow has no `outputs:` block, the `use:` step's output is an empty object (`{}`).

## Accessing sub-workflow outputs

In a later step, access the declared outputs via `ctx.steps.<id>.output`:

```yaml
- id: setup
  use: ./setup.yaml
  with:
    issue: "${{ inputs.issue }}"

- id: report
  needs: [setup]
  run: |
    return `Branch is ${ctx.steps.setup.output.branch}`;
```

Or in expressions:

```yaml
- id: deploy
  needs: [setup]
  sh: "git push origin ${{ steps.setup.output.branch }}"
```

## Mission-shaped example

Two workflows share one `setup.yaml` sub-workflow:

```yaml
# setup.yaml
name: setup
inputs:
  issue:
    type: string
    required: true
outputs:
  branch: "${{ steps.b.output }}"
phases:
  - name: p
    steps:
      - id: b
        run: return "issue-" + ctx.inputs.issue
```

```yaml
# mission.yaml
name: mission
inputs:
  issue:
    type: string
    required: true
phases:
  - name: p
    steps:
      - id: setup
        use: ./setup.yaml
        with:
          issue: "${{ inputs.issue }}"
      - id: work
        needs: [setup]
        run: return ctx.steps.setup.output.branch
```

```yaml
# comms.yaml — identical structure, same shared setup.yaml
name: comms
inputs:
  issue:
    type: string
    required: true
phases:
  - name: p
    steps:
      - id: setup
        use: ./setup.yaml
        with:
          issue: "${{ inputs.issue }}"
      - id: respond
        needs: [setup]
        run: return ctx.steps.setup.output.branch
```

## Cycle detection

The engine tracks the call chain of sub-workflow paths. If a workflow (directly or transitively) calls itself, the engine throws:

```text
sub-workflow cycle detected: /path/to/loop.yaml is already in the call chain
```

This check is enforced at runtime before the child workflow starts.

## Dry-run propagation

When the parent workflow runs in dry-run mode, the child workflow also runs in dry-run mode. The child's `dryRun:` declarations on individual steps are honoured, just as they would be in a top-level dry run.

## Resume limitation

In this version, the child workflow runs as a **fresh** `runWorkflow` invocation each time the `use:` step executes. Cross-boundary partial resume is not supported — if a parent workflow resumes from a journal, a `use:` step that was interrupted will re-run the child from the beginning. Resume operates on whole `use:` step invocations, not on individual steps within the child.

## Programmatic use

`makeUseStep` is exported from `@plyflow/core` so you can inject a custom `runWorkflow` implementation for testing:

```typescript
import { makeUseStep } from '@plyflow/core';

// Inject a mock runner for unit tests
const fakeRun = async () => ({ runId: 'test', outputs: {}, declaredOutputs: { branch: 'issue-42' } });
const useStep = makeUseStep(fakeRun);
```
