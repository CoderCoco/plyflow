---
sidebar_position: 1
---

# Step Types Overview

A step has exactly one **type key** that determines what it does. The type key and its value are combined with the common step fields (`id`, `needs`, `if`, `output`, etc.).

## Quick reference

| Type key | Description |
|----------|-------------|
| [`run`](./run-uses.md) | Inline JavaScript/TypeScript expression |
| [`uses`](./run-uses.md) | External `.ts` module |
| [`agent`](./agent.md) | AI agent call |
| [`input`](./input.md) | Pause for human input (confirm / text / select) |
| [`parallel`](./parallel.md) | Explicit fan-out over a list of child steps |
| [`loop`](./loop.md) | Repeat child steps up to N iterations or until a condition |
| [`foreach`](./foreach.md) | Dynamic fan-out over a runtime array |
| [`widget`](./widget.md) | Custom Ink/React terminal UI component |
| [`step`](./plugin-step.md) | Custom plugin step type |

## Choosing a step type

```
Do you need AI inference?           → agent:
Do you need user confirmation?      → input:
Do you need to run TypeScript?      → run: (inline) or uses: (module)
Do you need a custom TUI?           → widget:
Do you need to fan out over items?  → foreach:
Do you need to retry until done?    → loop:
Do you need a custom step type?     → step:
```

## Step execution model

Within a phase, steps that have no `needs:` (or whose dependencies are already satisfied) run concurrently. The engine forms a dependency wave and runs each wave in parallel.

```
Phase: Build
  ┌─────────┐   ┌─────────┐
  │  fetch  │   │ config  │   ← wave 1 (no deps)
  └────┬────┘   └────┬────┘
       │              │
       └──────┬───────┘
          ┌───┴───┐
          │ parse │              ← wave 2 (needs fetch + config)
          └───┬───┘
          ┌───┴───┐
          │  save │              ← wave 3 (needs parse)
          └───────┘
```

## Context inside `run:` steps

`run:` (and `uses:` modules) receive a `ctx` object:

```typescript
interface StepContext {
  inputs: Record<string, unknown>;    // workflow inputs
  steps: Record<string, { output: unknown }>; // prior step outputs
  env: Record<string, string | undefined>;    // process.env
  bindings: Record<string, unknown>;  // foreach item / loop iteration
  // ... plus provider, prompt, loadModule, runChildren
}
```

Access inputs: `ctx.inputs.myInput`
Access prior steps: `ctx.steps.myStep.output`
Access env: `ctx.env.MY_VAR`
Access foreach item: `ctx.bindings.item` (or whatever `as:` names it)
