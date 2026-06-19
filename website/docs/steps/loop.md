---
sidebar_position: 6
---

# `loop` Steps

A `loop:` step repeats its child pipeline up to `maxIterations` times, stopping early when an `until:` expression becomes truthy.

## Basic syntax

```yaml
- id: attempt
  loop:
    maxIterations: 3
    until: "${{ steps.verify.output.verdict == 'PASS' }}"
  steps:
    - id: implement
      agent: ./agents/astronaut.md
      prompt: "Implement the task. Iteration: ${{ iteration }}"

    - id: verify
      needs: [implement]
      agent: ./agents/controller.md
      prompt: "Verify: ${{ steps.implement.output.summary }}"
      output: ./schemas/Verdict.ts
```

## `loop` fields

| Field | Type | Description |
|-------|------|-------------|
| `loop.maxIterations` | number | Hard cap — the loop always stops here even if `until` is never true |
| `loop.until` | string | Optional `${{ }}` expression; loop stops when truthy |
| `steps` | StepDef[] | The child pipeline to repeat |

## The `iteration` binding

Inside the loop body, `${{ iteration }}` is a 0-based counter:

```yaml
- id: retry
  loop:
    maxIterations: 5
  steps:
    - id: work
      run: |
        const attempt = ctx.bindings.iteration + 1;
        return `Attempt ${attempt}`;
```

## The `until:` expression

The `until:` expression is evaluated **after** each iteration with a merged step context: ancestor steps (`ctx.steps` from outside the loop) merged with the current iteration's child outputs (`steps.<childId>.output`).

```yaml
until: "${{ steps.verify.output.verdict == 'PASS' }}"
```

This references `verify` (a child step ID), not the loop step ID. After the loop, the **consumer** accesses the last iteration's outputs through the loop step:

```yaml
# After a loop step named `attempt` that has children `implement` and `verify`:
- id: commit
  needs: [attempt]
  if: "${{ steps.attempt.output.verify.verdict == 'PASS' }}"
  uses: ./lib/git-commit.ts
```

:::caution `until:` references child step IDs, not the loop ID
Inside `until:`, use `steps.<child_id>.output` — the child step IDs from inside the loop. Do **not** use the loop step's own ID.

After the loop, the loop's output is the last iteration's full output map: `steps.<loop_id>.output.<child_id>.<field>`.
:::

## Real-world example: implement → verify → repeat

From `examples/mission/mission.yaml` — the Build phase uses a loop to keep trying until the controller says PASS:

```yaml
- id: attempt
  loop:
    maxIterations: 3
    until: "${{ steps.verify.output.verdict == 'PASS' }}"
  steps:
    - id: implement
      agent: ./agents/astronaut.md
      model: "${{ steps.models.output.astronaut }}"
      params:
        cwd: "${{ steps.worktree.output.worktree_path }}"
      prompt: |
        Task: ${{ task.name }} — ${{ task.title }}
        Iteration: ${{ iteration }}
        Prior feedback: ${{ steps.verify && steps.verify.output ? steps.verify.output.fixes_needed : '' }}
      output: ./schemas/AstronautReport.ts

    - id: verify
      needs: [implement]
      agent: ./agents/flight-controller.md
      model: "${{ steps.models.output.controller }}"
      params:
        cwd: "${{ steps.worktree.output.worktree_path }}"
        allowedTools: ["Read", "Grep", "Glob", "Bash"]
      prompt: |
        Task: ${{ task.name }}
        Summary: ${{ steps.implement.output.summary }}
      output: ./schemas/ControllerVerdict.ts

# After the loop — commit only if the last verify passed
- id: commit
  needs: [attempt]
  if: "${{ steps.attempt.output.verify.verdict == 'PASS' }}"
  uses: ./lib/git-commit.ts
  with:
    message: "feat(${{ task.name }}): ${{ task.title }}"
```

## Journaling and resume

Each loop iteration is journaled with a path like `attempt/loop:0`, `attempt/loop:1`, etc. On resume, already-completed iterations are replayed from the journal. See [Resume & Journaling](../resume-journaling.md).
