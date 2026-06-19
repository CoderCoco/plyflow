---
sidebar_position: 3
---

# Workflow Files

A workflow is a YAML file with three top-level keys: `name`, optional `inputs`, and `phases`.

## Top-level shape

```yaml
name: my-workflow          # Human-readable name (required)
inputs:                    # Typed input declarations (optional)
  text:
    type: string
    required: true
  max_items:
    type: number
    required: false
    default: 10
plugins:                   # Custom step-type modules to load (optional)
  - ./steps/my-plugin.ts
phases:                    # Ordered list of phases (required)
  - name: Phase One
    steps:
      - id: step-a
        run: return 42;
```

## `inputs`

Inputs are declared as a map of name → `InputDef`:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` \| `number` \| `boolean` | The value type |
| `required` | boolean | Whether the input must be provided at runtime |
| `default` | any | Default value when not provided |

Inputs are provided on the command line with `--input key=value`:

```bash
plyflow run ./wf.yaml --input text="hello" --input max_items=5
```

Access them in expressions as `${{ inputs.text }}` and `${{ inputs.max_items }}`.

## `phases`

Phases run **sequentially** — Phase 2 does not start until all steps in Phase 1 complete. Each phase has a `name` and a list of `steps`.

:::important Cross-phase output
Step outputs from earlier phases are available in later phases **without** listing them in `needs:`. The engine inherits all prior step outputs automatically. `needs:` is only for declaring ordering constraints among steps **within the same phase (or loop/foreach scope)**.
:::

```yaml
phases:
  - name: Setup
    steps:
      - id: config
        uses: ./load-config.ts

  - name: Process
    steps:
      - id: work
        # config output is available here without needs: [config]
        run: |
          return ctx.steps.config.output.value * 2;
```

## `steps`

Steps within a phase run in **parallel** by default. Declare ordering constraints with `needs`:

```yaml
phases:
  - name: Example
    steps:
      - id: fetch        # runs immediately
        run: return fetch('https://example.com').then(r => r.text());

      - id: parse        # waits for fetch
        needs: [fetch]
        run: return ctx.steps.fetch.output.slice(0, 100);

      - id: log          # also waits for fetch (independent of parse)
        needs: [fetch]
        run: return `fetched ${ctx.steps.fetch.output.length} chars`;
```

### Common step fields

Every step, regardless of type, supports these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier within the workflow |
| `needs` | string[] | Step IDs that must complete first (same scope only) |
| `if` | string | Conditional — must be a `${{ }}` expression; step is skipped when falsy |
| `output` | string | Path to a `.ts` Zod schema for structured output |
| `with` | object | Input parameters passed to the step |
| `retry` | `{ max, backoff? }` | Retry on failure |
| `continueOnError` | boolean | Don't fail the workflow if this step errors |
| `model` | string | Per-step model override (expression-resolved) |
| `mode` | string | Per-step provider mode override |
| `params` | object | Extra parameters merged into the provider request |

The step **type** is set by exactly one of: `run`, `uses`, `agent`, `input`, `parallel`, `loop`, `foreach`, `widget`, or `step`.

## Expressions: `${{ }}`

Expressions are JavaScript evaluated at runtime. Wrap any expression in `${{ }}`:

```yaml
- id: greet
  run: return `Hello, ${ctx.inputs.name}!`;
  # The above is a run: body — ctx is the step context
  
- id: use-output
  needs: [greet]
  run: return ctx.steps.greet.output.toUpperCase();
```

In non-`run` fields (like `message`, `prompt`, `if`, `key`, `dependsOn`, `model`), use `${{ }}` directly:

```yaml
- id: check
  if: "${{ inputs.debug == true }}"
  
- id: confirm
  needs: [summary]
  input:
    type: confirm
    message: "Title: ${{ steps.summary.output.title }}"
```

### Expression scope

The following identifiers are available in all `${{ }}` expressions:

| Identifier | Description |
|-----------|-------------|
| `inputs` | Map of all workflow inputs |
| `steps` | Map of step id → `{ output }` for all completed steps visible in this scope |
| `env` | `process.env` |
| `item` | Current element binding in a `foreach:` step (or whatever `as:` names it) |
| `iteration` | Current iteration index (0-based) inside a `loop:` step |

### Accessing step outputs

```yaml
# Simple value
${{ steps.my-step.output }}

# Nested field
${{ steps.summarizer.output.title }}

# Array access
${{ steps.planner.output.tasks[0].name }}

# Null-safe access (use && pattern)
${{ steps.verify && steps.verify.output ? steps.verify.output.verdict : '' }}
```

### `if:` conditionals

```yaml
- id: repair
  if: "${{ steps.filter.output.actionable.length > 0 }}"
  foreach: "${{ steps.filter.output.actionable }}"
  as: finding
  steps:
    - id: fix
      agent: ./agents/astronaut.md
```

The `if:` value must be a `${{ }}` expression. The step is skipped (and its output is `undefined`) when the expression is falsy.

## `plugins`

Declare custom step types at the workflow level. See [Plugins](./extensibility/plugins.md) for the full authoring guide.

```yaml
plugins:
  - ./steps/uppercase.ts
  - ./steps/markdown-renderer.ts
phases:
  - name: Transform
    steps:
      - id: shout
        step: uppercase
        with:
          text: "${{ inputs.message }}"
```
