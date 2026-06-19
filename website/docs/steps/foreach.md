---
sidebar_position: 7
---

# `foreach` Steps

A `foreach:` step fans out over a runtime array, running a child pipeline for each element. Elements can form a DAG (via `dependsOn:`) and run concurrently up to a `concurrency:` cap.

## Basic syntax

```yaml
- id: process
  foreach: "${{ steps.plan.output.tasks }}"
  as: task
  steps:
    - id: run-task
      agent: ./agents/worker.md
      prompt: "Do task: ${{ task.name }}"
```

## `foreach` fields

| Field | Type | Description |
|-------|------|-------------|
| `foreach` | string | Expression resolving to an array |
| `as` | string | Binding name for the current element (default: `item`) |
| `key` | string | Expression for the element's identity key (default: array index as string) |
| `dependsOn` | string | Expression resolving to an array of keys this element depends on |
| `concurrency` | number | Max simultaneous elements (default: unlimited) |
| `steps` | StepDef[] | Child pipeline run for each element |

## Element binding

The current array element is bound to `as:` (default `item`). Inside child steps, reference it in expressions:

```yaml
- id: inspect
  foreach: "${{ steps.scout.output.buckets }}"
  as: bucket
  steps:
    - id: review
      agent: ./agents/inspector.md
      prompt: "Review the ${{ bucket }} bucket."
```

## Stable keys

Use `key:` to assign a stable string key to each element. Keys are used in journaling (so resume works across runs) and as identifiers in the output map.

```yaml
- id: build
  foreach: "${{ steps.plan.output.tasks }}"
  as: task
  key: "${{ task.name }}"
  steps:
    - id: implement
      agent: ./agents/astronaut.md
      prompt: "Implement: ${{ task.title }}"
```

:::note Key uniqueness
Keys must be unique within the foreach. Duplicate keys throw an error immediately.
:::

## DAG fan-out with `dependsOn:`

`dependsOn:` turns the elements themselves into a DAG. Elements can depend on other elements by key, and the engine topologically sorts them into waves:

```yaml
- id: build
  foreach: "${{ steps.plan.output.tasks }}"
  as: task
  key: "${{ task.name }}"
  dependsOn: "${{ task.depends_on }}"     # each task declares its own deps
  concurrency: 5
  steps:
    - id: implement
      agent: ./agents/astronaut.md
      prompt: "Implement: ${{ task.title }}"
```

The engine runs the elements in dependency order: all elements with no dependencies form wave 1, elements whose dependencies are in wave 1 form wave 2, etc. Within each wave, elements run concurrently (up to `concurrency`).

## Output

The `foreach:` step's output is a map of key → child step output map:

```yaml
# After: foreach as task, key: "${{ task.name }}", child id: implement
- id: show
  needs: [build]
  run: |
    const outputs = ctx.steps.build.output;
    // outputs = { "task-name-1": { implement: "..." }, "task-name-2": { implement: "..." } }
    return Object.keys(outputs).length;
```

## Concurrency

Cap the number of simultaneously running elements:

```yaml
- id: repair
  foreach: "${{ steps.filter.output.actionable }}"
  as: finding
  key: "${{ finding.file + '::' + finding.summary }}"
  concurrency: 5
  steps:
    - id: fix
      agent: ./agents/astronaut.md
      prompt: "Fix: ${{ finding.summary }} in ${{ finding.file }}"
```

## Full real-world example

From `examples/mission/mission.yaml` — the Review phase:

```yaml
- id: inspect
  needs: [scout]
  foreach: "${{ steps.scout.output.buckets }}"
  as: bucket
  key: "${{ bucket }}"
  steps:
    - id: review-bucket
      agent: ./agents/systems-inspector.md
      model: "${{ steps.models.output.inspector }}"
      params:
        cwd: "${{ steps.worktree.output.worktree_path }}"
        allowedTools: ["Read", "Grep", "Glob", "Bash"]
      prompt: |
        Bucket: ${{ bucket }}
        Changed files: ${{ steps.scout.output.changed_files }}
        Review all files in the ${{ bucket }} bucket against the rubric.
      output: ./schemas/InspectorFindings.ts
```

## Journaling and resume

Each element is journaled with a path like `build/foreach:task-name-1`, `build/foreach:task-name-2`. On resume, completed elements are replayed; only incomplete elements re-run. If a key contains `/`, it is percent-encoded to `%2F` to avoid path ambiguity.
