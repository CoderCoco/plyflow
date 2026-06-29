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
| `type` | `string` \| `number` \| `boolean` \| `object` \| `json` \| `array` | The value type |
| `required` | boolean | Whether the input must be provided at runtime |
| `default` | any | Default value when not provided |

### Scalar input types

Scalar inputs are provided on the command line with `--input key=value`:

```bash
plyflow run ./wf.yaml --input text="hello" --input max_items=5
```

Access them in expressions as `${{ inputs.text }}` and `${{ inputs.max_items }}`.

### Structured input types (`object`, `json`, `array`)

For structured data, declare the type and pass JSON on the command line:

```yaml
inputs:
  roles:
    type: object       # plain JS object; keys/values accessible normally
  tasks:
    type: array        # a JSON array
  config:
    type: json         # any JSON value (object, array, string, number, …)
```

Pass the value as a JSON string on the CLI — wrap in single quotes to avoid shell expansion:

```bash
plyflow run ./wf.yaml --input 'roles={"planner":"opus","worker":"sonnet"}'
plyflow run ./wf.yaml --input 'tasks=["write","review","test"]'
```

To read structured input from a file, prefix the path with `@`:

```bash
plyflow run ./wf.yaml --input roles=@./config/roles.json
```

Access structured inputs in expressions exactly like any other input:

```yaml
- id: role-keys
  run: return ctx.with.keys
  with:
    keys: "${{ keys(inputs.roles) }}"  # ['planner', 'worker']
```

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

The following identifiers are available in `${{ }}` expressions:

| Identifier | Scope | Description |
|-----------|-------|-------------|
| `inputs` | Always | Map of all workflow inputs |
| `steps` | Always | Map of step id → `{ output }` for all completed steps visible in this scope |
| `env` | Always | `process.env` |
| `item` | `foreach:` only | Current element binding (or whatever `as:` names it) — only inside a `foreach:` step |
| `iteration` | `loop:` only | Current iteration index (0-based) — only inside a `loop:` step |

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

### Expression helpers

The following helper functions are available as bare identifiers in every `${{ }}` expression. If a binding has the same name as a helper, the binding wins and the helper is shadowed. Workflow inputs are accessed via `inputs.*` and never collide with bare helper identifiers.

| Helper | Signature | Example |
|--------|-----------|---------|
| `map` | `map(arr, fn)` | `${{ map(steps.items.output, x => x.name) }}` |
| `filter` | `filter(arr, fn)` | `${{ filter(steps.list.output, x => x.active) }}` |
| `flatMap` | `flatMap(arr, fn)` | `${{ flatMap(steps.groups.output, g => g.members) }}` |
| `find` | `find(arr, fn)` | `${{ find(steps.list.output, x => x.id === inputs.id) }}` |
| `some` | `some(arr, fn)` | `${{ some(steps.checks.output, c => c.failed) }}` |
| `every` | `every(arr, fn)` | `${{ every(steps.checks.output, c => c.passed) }}` |
| `unique` | `unique(arr)` | `${{ unique(steps.tags.output) }}` |
| `groupBy` | `groupBy(arr, fn)` | `${{ groupBy(steps.items.output, x => x.type) }}` |
| `keys` | `keys(obj)` | `${{ keys(inputs.roles) }}` |
| `values` | `values(obj)` | `${{ values(inputs.config) }}` |
| `entries` | `entries(obj)` | `${{ entries(inputs.mapping) }}` |
| `len` | `len(arr \| str \| obj)` | `${{ len(steps.results.output) }}` |
| `flat` | `flat(arr, depth?)` | `${{ flat(steps.nested.output) }}` |
| `sort` | `sort(arr, fn?)` | `${{ sort(steps.scores.output, (a, b) => b - a) }}` |

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
