---
sidebar_position: 2
---

# Plugins

Plugins let you add custom step types to plyflow. A plugin is a TypeScript module that registers one or more `StepType` implementations. Use them for reusable, domain-specific logic that doesn't fit the built-in step types.

## Declaring plugins

### In the workflow YAML

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

### In `package.json`

Alternatively, declare plugins in the workflow directory's `package.json`:

```json
{
  "name": "my-workflow",
  "plyflow": {
    "plugins": ["./steps/uppercase.ts"]
  }
}
```

Both sources are merged and deduplicated before loading.

### By package name (bare specifier)

Plugins can also be declared by **package name** — a bare specifier such as `@plyflow/git` or `shout-plugin` — in either `plugins:` in the YAML or `plyflow.plugins` in `package.json`:

```yaml
plugins:
  - @plyflow/git      # bare package specifier — resolved from node_modules
  - ./steps/local.ts  # relative path — loaded as a local file
```

```json
{
  "name": "my-workflow",
  "dependencies": {
    "@plyflow/git": "^1.0.0"
  },
  "plyflow": {
    "plugins": ["@plyflow/git"]
  }
}
```

When a plugin entry is a bare package specifier (no leading `./` or `../`, and no `.ts`/`.js` extension), plyflow resolves it from the workflow directory's `node_modules`. Declare the package in the workflow's `package.json` `dependencies` so it is installed before the workflow runs.

A plugin reference that starts with `./` or `../`, ends in `.ts`/`.js`/`.tsx`/`.jsx`, or is an absolute path is always treated as a local file path.

## Writing a plugin

A plugin module `export default`s either a **StepType object** or a **register function**.

### StepType object form

```typescript
// steps/uppercase.ts
import type { StepType } from 'plyflow/steps/types.js';

const uppercaseStep: StepType<{ text: string }> = {
  name: 'uppercase',

  // match() is overridden by the plugin loader to: (def) => def.step === 'uppercase'
  // You can leave it as () => false or implement custom matching logic.
  match: () => false,

  // parse: convert the raw StepDef to your config type
  parse: (def) => ({
    text: String(def.with?.text ?? ''),
  }),

  // run: execute the step and return { output }
  run: async (cfg) => ({
    output: cfg.text.toUpperCase(),
  }),
};

export default uppercaseStep;
```

When using the StepType object form, the loader automatically sets `match` to `(def) => def.step === name`, so the `match` you provide is not used.

### Register function form

For full control, export a register function:

```typescript
// steps/double.ts
export default function register(registry: any) {
  registry.register({
    name: 'double',
    match: (def: any) => def.step === 'double',
    parse: (def: any) => ({ value: Number(def.with?.value ?? 0) }),
    run: async (cfg: { value: number }) => ({ output: cfg.value * 2 }),
  });
}
```

The register function receives the `StepRegistry` and can call `registry.register(stepType)` one or more times.

## The `StepType` interface

```typescript
interface StepType<Cfg> {
  name: string;
  match: (def: StepDef) => boolean;
  parse: (def: StepDef) => Cfg;
  run: (cfg: Cfg, ctx: StepContext) => Promise<StepResult>;
}

interface StepResult {
  output: unknown;
}
```

The `run` function receives:
- `cfg` — the parsed config from `parse(def)`
- `ctx` — the full `StepContext` (inputs, prior steps, env, provider, prompt, etc.)

## Full example

From `examples/plugins/`:

```typescript
// steps/uppercase.ts
import type { StepType } from 'plyflow/steps/types.js';

const uppercaseStep: StepType<{ text: string }> = {
  name: 'uppercase',
  match: () => false,
  parse: (def) => ({ text: String(def.with?.text ?? '') }),
  run: async (cfg) => ({ output: cfg.text.toUpperCase() }),
};

export default uppercaseStep;
```

```yaml
# transform.yaml
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

Running this produces output `HELLO`.

## Plugin context

Plugins have access to the full `StepContext`, which means they can:

- Access workflow inputs: `ctx.inputs`
- Access prior step outputs: `ctx.steps`
- Call the AI provider: `ctx.provider.complete(...)`
- Prompt the user: `ctx.prompt(...)`
- Load modules: `ctx.loadModule(path)`
- Run child pipelines: `ctx.runChildren(steps, bindings, journalPath)`

This makes plugins as powerful as built-in step types.

## Error handling

If a plugin's `run` throws, the step fails and (unless `continueOnError: true`) the workflow fails. The error is journaled.

If a `step:` name isn't matched by any loaded plugin, the engine throws a clear error listing the known custom step names.
