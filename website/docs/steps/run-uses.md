---
sidebar_position: 2
---

# `run` and `uses` Steps

Both step types execute TypeScript/JavaScript code. Use `run:` for short inline logic and `uses:` for larger, reusable modules.

## `run:` — inline code

```yaml
- id: greet
  run: |
    return `Hello, ${ctx.inputs.name}!`;
```

The `run:` value is a JavaScript function body (passed to `new Function`). It has access to `ctx` (the step context) and must `return` a value. The returned value becomes the step's output.

```yaml
- id: transform
  run: |
    const { text } = ctx.inputs;
    const words = text.split(' ');
    return { wordCount: words.length, upper: text.toUpperCase() };
```

The `run:` body can be async:

```yaml
- id: fetch-data
  run: |
    const res = await fetch('https://api.example.com/data');
    const json = await res.json();
    return json.items;
```

## `uses:` — external module

For more complex logic, point `uses:` at a `.ts` file. plyflow loads it with [jiti](https://github.com/unjs/jiti) so TypeScript is executed directly — no compilation step needed for workflow modules.

```yaml
- id: process
  uses: ./lib/process-data.ts
  with:
    input: "${{ steps.fetch.output }}"
    limit: 50
```

The module must `export default` an async function that receives `(cfg, ctx)`:

```typescript
// lib/process-data.ts
import { z } from 'zod';

export default async function processData(
  cfg: { input: unknown[]; limit: number },
  ctx: any,
) {
  const items = cfg.input.slice(0, cfg.limit);
  return { items, count: items.length };
}
```

### Module context

`ctx` passed to a `uses:` module is the full `StepContext`:

```typescript
export default async function myModule(cfg: any, ctx: any) {
  // ctx.inputs — workflow inputs
  // ctx.steps  — prior step outputs
  // ctx.env    — process.env
  // ctx.loadModule(path) — load another module
  return { done: true };
}
```

### Library imports

Workflow modules can import any npm package. Host-provided packages (`zod`, `react`, `ink`) resolve to plyflow's own copies automatically — no install needed. For other packages, declare them in a `package.json` in the workflow directory (see [Workflow Dependencies](../extensibility/workflow-dependencies.md)).

```typescript
// lib/transform.ts — zod is host-provided, no install needed
import { z } from 'zod';
import _ from 'lodash'; // declared in workflow's package.json

export default async function transform(cfg: any) {
  return { sorted: _.sortBy(cfg.items, 'name') };
}
```

## `with:` parameters

Both `run:` and `uses:` accept `with:` to pass named parameters. In `run:`, the `with:` data is passed as the first argument (named `input` in the function body) and is also available on `ctx.with`. It is separate from `ctx.inputs`, which holds workflow-level inputs. In `uses:`, the `with:` data is the first argument `cfg`.

```yaml
- id: calc
  uses: ./lib/calculator.ts
  with:
    a: "${{ steps.first.output.value }}"
    b: 42
    operation: multiply
```

```typescript
// lib/calculator.ts
export default async function calculator(cfg: { a: number; b: number; operation: string }) {
  if (cfg.operation === 'multiply') return cfg.a * cfg.b;
  return cfg.a + cfg.b;
}
```

## Accessing the result

The return value of `run:` or `uses:` becomes the step's `output`. Access it in subsequent steps via `${{ steps.<id>.output }}` or `ctx.steps.<id>.output`.

```yaml
- id: double
  run: return ctx.inputs.value * 2;

- id: show
  needs: [double]
  run: return `Result: ${ctx.steps.double.output}`;
```
