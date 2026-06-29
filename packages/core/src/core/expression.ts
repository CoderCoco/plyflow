export interface ExprContext {
  inputs: Record<string, unknown>;
  steps: Record<string, { output: unknown }>;
  env: Record<string, string | undefined>;
  bindings?: Record<string, unknown>;
}

const EXPR = /\$\{\{\s*([\s\S]+?)\s*\}\}/g;
const WHOLE = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/;

// Named parameters of the evaluator function — binding keys that match these
// cannot be re-declared as `const` inside the function body in strict mode.
const NAMED_PARAMS = new Set(['inputs', 'steps', 'env', '__b', '__h']);

// JS reserved words that cannot be used as `const` identifiers.
const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return',
  'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'enum', 'await', 'implements', 'interface',
  'package', 'private', 'protected', 'public',
]);

export const EXPRESSION_HELPERS = Object.freeze({
  map: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.map(fn),
  filter: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.filter(fn),
  flatMap: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.flatMap(fn),
  find: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.find(fn),
  some: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.some(fn),
  every: (arr: unknown[], fn: (x: unknown, i: number) => unknown) => arr.every(fn),
  unique: (arr: unknown[]) => [...new Set(arr)],
  groupBy: (arr: unknown[], fn: (x: unknown) => string) => {
    if (arr == null) return {} as Record<string, unknown[]>;
    const out: Record<string, unknown[]> = Object.create(null);
    for (const x of arr) {
      const k = String(fn(x));
      (out[k] ??= []).push(x);
    }
    return out;
  },
  keys: (o: object | null | undefined) => (o == null ? [] : Object.keys(o)),
  values: (o: object | null | undefined) => (o == null ? [] : Object.values(o)),
  entries: (o: object | null | undefined) => (o == null ? [] : Object.entries(o)),
  len: (x: unknown) =>
    x == null
      ? 0
      : Array.isArray(x) || typeof x === 'string'
        ? x.length
        : Object.keys(x as object).length,
  flat: (arr: unknown[], depth = 1) => arr.flat(depth),
  sort: (arr: unknown[], fn?: (a: unknown, b: unknown) => number) => [...arr].sort(fn),
});

function evalExpr(src: string, ctx: ExprContext): unknown {
  // Trusted local workflows: evaluate a single JS expression against the context.
  // Bindings (e.g. item, iteration) are passed as a single __b object to avoid
  // duplicate-parameter errors under strict mode when a binding key collides with
  // a named param (inputs, steps, env).  Keys that match named params are skipped
  // from the const-declaration list — the named param takes precedence in that case.
  const bindings = ctx.bindings ?? {};
  const bindingNames = Object.keys(bindings).filter(
    (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !NAMED_PARAMS.has(k) && !JS_RESERVED.has(k),
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

export function resolve(value: unknown, ctx: ExprContext): unknown {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE);
    if (whole) return evalExpr(whole[1]!, ctx);
    return value.replace(EXPR, (_m, src: string) => String(evalExpr(src, ctx)));
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, ctx)]));
  }
  return value;
}
