---
sidebar_position: 9
---

# `step` Steps (Plugins)

The `step:` type key invokes a custom step type registered by a plugin. This lets you package reusable step logic and use it across workflows.

## Using a plugin step

First, declare the plugin in your workflow YAML:

```yaml
plugins:
  - ./steps/uppercase.ts

phases:
  - name: Transform
    steps:
      - id: shout
        step: uppercase
        with:
          text: "${{ inputs.message }}"
```

- `plugins:` — list of plugin module paths (relative to the workflow file)
- `step:` — the registered name of the custom step type
- `with:` — parameters passed to the plugin's `parse` function

See [Plugins](../extensibility/plugins.md) for how to write plugin modules.

## Example: uppercase plugin

The plugin from `examples/plugins/`:

```yaml
name: transform
plugins:
  - ./steps/uppercase.ts
phases:
  - name: Transform
    steps:
      - id: shout
        step: uppercase
        with:
          text: hello
```

```typescript
// steps/uppercase.ts
import type { StepType } from 'plyflow/steps/types.js';

const uppercaseStep: StepType<{ text: string }> = {
  name: 'uppercase',
  match: () => false,          // overridden by the plugin loader
  parse: (def) => ({ text: String(def.with?.text ?? '') }),
  run: async (cfg) => ({ output: cfg.text.toUpperCase() }),
};

export default uppercaseStep;
```

Running `plyflow run examples/plugins/transform.yaml` produces output `HELLO`.

## Output

The step's output is whatever the plugin's `run` function returns in `{ output: ... }`. Access it like any other step:

```yaml
- id: use-result
  needs: [shout]
  run: return ctx.steps.shout.output; // 'HELLO'
```

For a complete guide to writing plugins, see [Extensibility: Plugins](../extensibility/plugins.md).
