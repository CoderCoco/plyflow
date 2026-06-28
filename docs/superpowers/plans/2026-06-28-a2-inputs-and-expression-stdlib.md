# A2 — Object/JSON Inputs + Expression Stdlib Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two coupled additions that let workflows pass structured config and reshape data in YAML instead of hand-rolled TypeScript: (1) new input types `object` / `json` / `array` with CLI coercion (incl. `@file.json`), and (2) a frozen **expression stdlib** of array/object helpers injected into `${{ }}` (`map`, `filter`, `flatMap`, `find`, `some`, `every`, `unique`, `groupBy`, `keys`, `values`, `entries`, `len`, `flat`, `sort`). Together these delete mission's `resolve-models.ts`, `flatten-findings.ts`, and `actionable-comments.ts`.

**Architecture:** Input-type acceptance is a `@plyflow/core` schema change; coercion of `--input k=v` strings to JSON values is `@plyflow/cli` only (the engine already passes inputs through untyped, and programmatic callers pass real values). The stdlib is injected in `core/expression.ts` by passing a frozen helpers object as an extra `Function` parameter and declaring each helper as a bare `const`, with workflow bindings taking precedence on name collisions.

**Tech Stack:** TypeScript ESM (Node ≥24), Zod, vitest. pnpm monorepo; work spans `packages/core` and `packages/cli`.

## Global Constraints

- **Node ≥24, ESM.** Relative imports keep `.js` extensions. `node -v` must be v24.x (`source "$HOME/.nvm/nvm.sh" && nvm use 24.18.0` if it shows v20).
- **Test gate is vitest** (`pnpm --filter @plyflow/core test`, `pnpm --filter @plyflow/cli test`), not tsc. CI runs `pnpm -r lint` with `no-unused-vars: error` — **no unused imports**.
- **TDD:** failing test first, watch fail, minimal impl, watch pass, commit.
- **Expression helpers are pure, frozen, side-effect-free.** They add no new risk surface — `evalExpr` already runs arbitrary JS via `new Function`. Helpers must be `Object.freeze`d.
- **Binding precedence:** a workflow binding (e.g. a `foreach` `as: map`) must take precedence over a same-named helper — never emit a double `const` declaration (it throws). Named params (`inputs`/`steps`/`env`) still win over both.
- **`coerceInputs` must move out of `cli/index.ts`** before it can be unit-tested: `index.ts` self-executes the CLI on import, so a test importing from it would run the CLI. Extract to `packages/cli/src/coerce.ts`.

---

## File Structure

```
packages/core/src/
  core/
    types.ts            # MODIFY: InputDef.type adds 'object' | 'json' | 'array'
    format-schema.ts    # MODIFY: inputDef type enum adds object/json/array
    expression.ts       # MODIFY: inject frozen EXPRESSION_HELPERS into ${{ }} scope
    expression.test.ts  # MODIFY: add stdlib + precedence tests
  index.ts              # MODIFY: export EXPRESSION_HELPERS
packages/cli/src/
  coerce.ts             # NEW: coerceInputs (moved + extended: object/json/array, @file.json)
  coerce.test.ts        # NEW
  index.ts              # MODIFY: import coerceInputs from ./coerce.js (remove the inline copy)
website/docs/           # MODIFY: input-types reference + expression-helpers reference
```

**Interfaces produced (used across tasks):**

```ts
// core/types.ts
interface InputDef { type: 'string' | 'number' | 'boolean' | 'object' | 'json' | 'array'; required?: boolean; default?: unknown; }

// core/expression.ts
export const EXPRESSION_HELPERS: Readonly<Record<string, (...args: any[]) => unknown>>;
// names: map, filter, flatMap, find, some, every, unique, groupBy, keys, values, entries, len, flat, sort

// cli/coerce.ts
export function coerceInputs(
  raw: Record<string, string>,
  defs: Record<string, { type: string }> | undefined,
  readFile?: (path: string) => string,   // injectable for tests; defaults to fs.readFileSync utf8
): Record<string, unknown>;
```

---

## Task 1: Accept `object`/`json`/`array` input types (core schema)

**Files:**
- Modify: `packages/core/src/core/types.ts` (InputDef.type union)
- Modify: `packages/core/src/core/format-schema.ts` (inputDef enum)
- Test: `packages/core/src/core/format-schema.test.ts` (add cases)

**Interfaces:**
- Produces: a workflow declaring `inputs: { x: { type: object } }` parses; the engine's existing default/required handling is unchanged.

- [ ] **Step 1: Write the failing test** (append to `format-schema.test.ts`)

```ts
describe('structured input types', () => {
  it('accepts object/json/array input types', () => {
    const wf = parseWorkflow({
      name: 'w',
      inputs: {
        cfg: { type: 'object', default: { a: 1 } },
        raw: { type: 'json' },
        items: { type: 'array', required: true },
      },
      phases: [{ name: 'p', steps: [{ id: 's', run: 'return 1' }] }],
    });
    expect(wf.inputs!.cfg!.type).toBe('object');
    expect(wf.inputs!.items!.type).toBe('array');
  });

  it('still rejects an unknown input type', () => {
    expect(() =>
      parseWorkflow({
        name: 'w',
        inputs: { x: { type: 'banana' } },
        phases: [{ name: 'p', steps: [{ id: 's', run: 'return 1' }] }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm --filter @plyflow/core test -- format-schema`
Expected: FAIL (`object` not in the input type enum).

- [ ] **Step 3: Widen `InputDef.type`** in `packages/core/src/core/types.ts`:

```ts
  type: 'string' | 'number' | 'boolean' | 'object' | 'json' | 'array';
```

- [ ] **Step 4: Widen the Zod enum** in `packages/core/src/core/format-schema.ts` (the `inputDef` schema):

```ts
const inputDef = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'json', 'array']),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});
```

- [ ] **Step 5: Run it, watch it pass**

Run: `pnpm --filter @plyflow/core test -- format-schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core/types.ts packages/core/src/core/format-schema.ts packages/core/src/core/format-schema.test.ts
git commit -m "feat(core): accept object/json/array input types"
```

---

## Task 2: CLI coercion for structured inputs (`coerce.ts`)

**Files:**
- Create: `packages/cli/src/coerce.ts` (moved from `index.ts` + extended)
- Create: `packages/cli/src/coerce.test.ts`
- Modify: `packages/cli/src/index.ts` (delete inline `coerceInputs`, import from `./coerce.js`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `coerceInputs(raw, defs, readFile?)` handling `number`/`boolean` as before, and `object`/`json`/`array` by parsing JSON (with `@file.json` support and type assertions).

- [ ] **Step 1: Write the failing test** — `packages/cli/src/coerce.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { coerceInputs } from './coerce.js';

const defs = (d: Record<string, string>) =>
  Object.fromEntries(Object.entries(d).map(([k, t]) => [k, { type: t }]));

describe('coerceInputs', () => {
  it('coerces number and boolean (unchanged behaviour)', () => {
    const out = coerceInputs({ n: '3', b: 'true', s: 'hi' }, defs({ n: 'number', b: 'boolean', s: 'string' }));
    expect(out).toEqual({ n: 3, b: true, s: 'hi' });
  });

  it('parses json/object/array from a JSON string', () => {
    const out = coerceInputs(
      { j: '{"a":1}', o: '{"x":true}', a: '[1,2,3]' },
      defs({ j: 'json', o: 'object', a: 'array' }),
    );
    expect(out).toEqual({ j: { a: 1 }, o: { x: true }, a: [1, 2, 3] });
  });

  it('asserts object is a non-array object and array is an array', () => {
    expect(() => coerceInputs({ o: '[1]' }, defs({ o: 'object' }))).toThrow(/object/i);
    expect(() => coerceInputs({ a: '{}' }, defs({ a: 'array' }))).toThrow(/array/i);
  });

  it('reads @file.json via the injected readFile', () => {
    const readFile = (p: string) => (p === '/cfg.json' ? '{"k":42}' : (() => { throw new Error('no'); })());
    const out = coerceInputs({ c: '@/cfg.json' }, defs({ c: 'object' }), readFile);
    expect(out).toEqual({ c: { k: 42 } });
  });

  it('throws a clear error on invalid JSON', () => {
    expect(() => coerceInputs({ j: 'not json' }, defs({ j: 'json' }))).toThrow(/json/i);
  });

  it('leaves unknown/declared-less keys as raw strings', () => {
    expect(coerceInputs({ x: 'v' }, undefined)).toEqual({ x: 'v' });
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm --filter @plyflow/cli test -- coerce`
Expected: FAIL (`./coerce.js` not found).

- [ ] **Step 3: Implement** `packages/cli/src/coerce.ts`

```ts
import { readFileSync } from 'node:fs';

const STRUCTURED = new Set(['object', 'json', 'array']);

function parseStructured(key: string, type: string, source: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`input "${key}" (type ${type}) is not valid JSON: ${source}`);
  }
  if (type === 'array' && !Array.isArray(value)) {
    throw new Error(`input "${key}" must be a JSON array`);
  }
  if (type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`input "${key}" must be a JSON object`);
  }
  return value;
}

export function coerceInputs(
  raw: Record<string, string>,
  defs: Record<string, { type: string }> | undefined,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const t = defs?.[k]?.type;
    if (t === 'number') {
      out[k] = Number(v);
    } else if (t === 'boolean') {
      out[k] = v === 'true';
    } else if (t && STRUCTURED.has(t)) {
      const source = v.startsWith('@') ? readFile(v.slice(1)) : v;
      out[k] = parseStructured(k, t, source);
    } else {
      out[k] = v;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm --filter @plyflow/cli test -- coerce`
Expected: PASS (6 tests).

- [ ] **Step 5: Replace the inline copy in `index.ts`.** In `packages/cli/src/index.ts`, delete the local `function coerceInputs(...) { ... }` (lines ~11–21) and add an import near the top:

```ts
import { coerceInputs } from './coerce.js';
```
Leave the `const inputs = coerceInputs(args.inputs, wf.inputs);` call as-is.

- [ ] **Step 6: Full cli build + test + lint**

Run: `pnpm --filter @plyflow/cli build && pnpm --filter @plyflow/cli test && pnpm --filter @plyflow/cli lint`
Expected: build exit 0; all cli tests pass; lint clean (no unused imports left behind).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/coerce.ts packages/cli/src/coerce.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): coerce object/json/array inputs (JSON + @file.json)"
```

---

## Task 3: Expression stdlib (`expression.ts`)

**Files:**
- Modify: `packages/core/src/core/expression.ts`
- Test: `packages/core/src/core/expression.test.ts`

**Interfaces:**
- Produces: `EXPRESSION_HELPERS` (frozen) exported from `expression.ts`; the 14 helpers available as bare identifiers inside `${{ }}`.

- [ ] **Step 1: Write the failing tests** (append to `expression.test.ts`)

```ts
import { resolve, EXPRESSION_HELPERS } from './expression.js';

const ctx = (over: Partial<Parameters<typeof resolve>[1]> = {}) => ({
  inputs: {}, steps: {}, env: {}, bindings: {}, ...over,
});

describe('expression stdlib', () => {
  it('exposes a frozen helper namespace', () => {
    expect(Object.isFrozen(EXPRESSION_HELPERS)).toBe(true);
    expect(typeof EXPRESSION_HELPERS.map).toBe('function');
  });

  it('map/filter/flatMap as bare identifiers', () => {
    expect(resolve('${{ map([1,2,3], x => x * 2) }}', ctx())).toEqual([2, 4, 6]);
    expect(resolve('${{ filter([1,2,3,4], x => x % 2 === 0) }}', ctx())).toEqual([2, 4]);
    expect(resolve('${{ flatMap([[1],[2,3]], x => x) }}', ctx())).toEqual([1, 2, 3]);
  });

  it('unique/groupBy/len/flat/sort', () => {
    expect(resolve('${{ unique([1,1,2,3,3]) }}', ctx())).toEqual([1, 2, 3]);
    expect(resolve('${{ groupBy([1,2,3,4], x => x % 2 === 0 ? "even" : "odd") }}', ctx())).toEqual({
      odd: [1, 3], even: [2, 4],
    });
    expect(resolve('${{ len([1,2,3]) }}', ctx())).toBe(3);
    expect(resolve('${{ flat([[1],[2,[3]]]) }}', ctx())).toEqual([1, 2, [3]]);
    expect(resolve('${{ sort([3,1,2]) }}', ctx())).toEqual([1, 2, 3]);
  });

  it('keys/values/entries over an object', () => {
    expect(resolve('${{ keys({a:1,b:2}) }}', ctx())).toEqual(['a', 'b']);
    expect(resolve('${{ values({a:1,b:2}) }}', ctx())).toEqual([1, 2]);
    expect(resolve('${{ entries({a:1}) }}', ctx())).toEqual([['a', 1]]);
  });

  it('helpers compose with inputs/steps', () => {
    const c = ctx({ steps: { f: { output: { items: [{ n: 1 }, { n: 2 }] } } } });
    expect(resolve('${{ map(steps.f.output.items, i => i.n) }}', c)).toEqual([1, 2]);
  });

  it('a workflow binding takes precedence over a same-named helper', () => {
    // `map` is also a helper; a binding named `map` must win (no double-const crash).
    const c = ctx({ bindings: { map: 'I am a binding' } });
    expect(resolve('${{ map }}', c)).toBe('I am a binding');
  });
});
```

- [ ] **Step 2: Run them, watch them fail**

Run: `pnpm --filter @plyflow/core test -- expression`
Expected: FAIL (`EXPRESSION_HELPERS` not exported; helpers undefined in scope).

- [ ] **Step 3: Implement the stdlib + injection** in `packages/core/src/core/expression.ts`. Add the frozen helpers object (after the `WHOLE` regex), then inject it in `evalExpr`.

```ts
export const EXPRESSION_HELPERS = Object.freeze({
  map: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.map(fn),
  filter: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.filter(fn),
  flatMap: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.flatMap(fn),
  find: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.find(fn),
  some: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.some(fn),
  every: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.every(fn),
  unique: (arr: unknown[]) => [...new Set(arr)],
  groupBy: (arr: unknown[], fn: (x: unknown) => string) => {
    const out: Record<string, unknown[]> = {};
    for (const x of arr) {
      const k = String(fn(x));
      (out[k] ??= []).push(x);
    }
    return out;
  },
  keys: (o: object) => Object.keys(o),
  values: (o: object) => Object.values(o),
  entries: (o: object) => Object.entries(o),
  len: (x: unknown) =>
    Array.isArray(x) || typeof x === 'string' ? x.length : Object.keys(x as object).length,
  flat: (arr: unknown[], depth = 1) => arr.flat(depth),
  sort: (arr: unknown[], fn?: (a: unknown, b: unknown) => number) => [...arr].sort(fn),
});
```

Then update `evalExpr` to declare helpers as bare consts (helpers that are NOT shadowed by a binding and not a named param), and pass the helpers object as a new `__h` parameter:

```ts
function evalExpr(src: string, ctx: ExprContext): unknown {
  const bindings = ctx.bindings ?? {};
  const bindingNames = Object.keys(bindings).filter(
    (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !NAMED_PARAMS.has(k),
  );
  const bindingSet = new Set(bindingNames);
  const bindingDecls = bindingNames.map((k) => `const ${k} = __b[${JSON.stringify(k)}];`).join('');
  const helperDecls = Object.keys(EXPRESSION_HELPERS)
    .filter((h) => !NAMED_PARAMS.has(h) && !bindingSet.has(h))
    .map((h) => `const ${h} = __h[${JSON.stringify(h)}];`)
    .join('');
  // Helpers first, bindings second: a binding of the same name is simply not
  // declared as a helper above, so the binding's const wins (no double-declare).
  const fn = new Function('inputs', 'steps', 'env', '__b', '__h', `"use strict"; ${helperDecls}${bindingDecls} return (${src});`);
  return fn(ctx.inputs, ctx.steps, ctx.env, bindings, EXPRESSION_HELPERS);
}
```

- [ ] **Step 4: Run them, watch them pass**

Run: `pnpm --filter @plyflow/core test -- expression`
Expected: PASS.

- [ ] **Step 5: Full core suite (no regression — every existing expression keeps working)**

Run: `pnpm --filter @plyflow/core test && pnpm --filter @plyflow/core lint`
Expected: all pass; lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core/expression.ts packages/core/src/core/expression.test.ts
git commit -m "feat(core): expression stdlib (map/filter/groupBy/... as bare helpers)"
```

---

## Task 4: Barrel export, end-to-end, and docs

**Files:**
- Modify: `packages/core/src/index.ts` (export `EXPRESSION_HELPERS`)
- Test: `packages/core/src/core/inputs-stdlib.e2e.test.ts` (object input + helper through `runWorkflow`)
- Modify: `website/docs/` (input-types reference page + a new expression-helpers reference page or section) and `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: public `EXPRESSION_HELPERS` export; a green end-to-end proof.

- [ ] **Step 1: Write the failing e2e test** — `packages/core/src/core/inputs-stdlib.e2e.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('an object input flows through a stdlib helper to a step output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-a2-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(
    wf,
    [
      'name: w',
      'inputs:',
      '  roles: { type: object }',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: names',
      `        run: return ctx.with.v`,
      '        with: { v: "${{ keys(inputs.roles) }}" }',
    ].join('\n'),
  );
  const { outputs } = await runWorkflow(wf, {
    provider: new FakeProvider([]),
    isTty: false,
    inputs: { roles: { planner: 'opus', worker: 'sonnet' } },
  });
  expect(outputs.names).toEqual(['planner', 'worker']);
});
```

- [ ] **Step 2: Run it, watch it pass (or adjust the expression)**

Run: `pnpm --filter @plyflow/core test -- inputs-stdlib`
Expected: PASS. If the `with:`/`run:` wiring reads differently in this codebase, adjust the expression to match how a `run:` step receives `with` (`ctx.with`) — verify against `steps/run.ts` and fix before locking.

- [ ] **Step 3: Add the barrel export** in `packages/core/src/index.ts`:

```ts
// Expression stdlib (helpers available inside ${{ }})
export { EXPRESSION_HELPERS } from './core/expression.js';
```

- [ ] **Step 4: Run it, watch it pass**

Run: `pnpm --filter @plyflow/core test -- inputs-stdlib`
Expected: PASS.

- [ ] **Step 5: Docs.**
  - Find the inputs reference page (`grep -rl "inputs:" website/docs`; likely `website/docs/workflow-files.md`). Document the new `object` / `json` / `array` types, the `--input k=v` JSON form, and the `@file.json` form.
  - Find the expression docs (`grep -rl '\${{' website/docs`; likely a `workflow-files.md` or an `expressions` page). Add an **Expression helpers** section listing all 14 helpers with a one-line signature + example each, and a note that a workflow binding of the same name shadows a helper.
  - In `AGENTS.md`, where inputs / expressions are described, mention the structured input types and the expression stdlib in one line each.

- [ ] **Step 6: Full monorepo gate**

Run: `pnpm -r build && pnpm -r lint && pnpm test`
Expected: build exit 0; lint clean; all tests pass (core + cli + examples).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/core/inputs-stdlib.e2e.test.ts website/docs AGENTS.md
git commit -m "feat: export EXPRESSION_HELPERS; e2e; docs for inputs + stdlib"
```

---

## Self-Review

**Spec coverage (Spec A §A2):**
- Object/JSON/array input types → Task 1 (schema) + Task 2 (CLI coercion incl. `@file.json`). Replaces `resolve-models.ts` CSV parsing. ✅
- Expression stdlib (map/filter/flatMap/find/some/every/unique/groupBy/keys/values/entries/len/flat/sort) injected as bare identifiers, frozen, no new risk → Task 3. Replaces `flatten-findings.ts`/`actionable-comments.ts`. ✅
- Binding-precedence safety (no double-const crash; binding wins) → Task 3 (impl + dedicated test). ✅

**Placeholder scan:** every step has concrete code/commands + expected output; no TBD. ✅

**Type/name consistency:** `EXPRESSION_HELPERS` defined in Task 3, exported in Task 4, asserted frozen in Task 3's test. `coerceInputs(raw, defs, readFile?)` signature defined in Task 2 and consumed by `index.ts` (Task 2 Step 5). The 14 helper names are identical in the impl (Task 3), the tests (Task 3), and the docs (Task 4). InputDef union (Task 1) matches the Zod enum (Task 1) and the CLI's `STRUCTURED` set (Task 2). ✅

**Adjust-at-implementation note:** Task 4 Step 2 — verify the `with:`/`run:` access pattern (`ctx.with.v`) against `steps/run.ts` before locking the e2e; fix the expression if the real context shape differs.

**Engine scope note (deliberate):** the engine does NOT type-validate provided input values against their declared type (parity with current behaviour — it only applies defaults/required). Coercion is a CLI concern; programmatic callers pass real values. This is intentional, not a gap.
```
