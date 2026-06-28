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
const NAMED_PARAMS = new Set(['inputs', 'steps', 'env', '__b']);

function evalExpr(src: string, ctx: ExprContext): unknown {
  // Trusted local workflows: evaluate a single JS expression against the context.
  // Bindings (e.g. item, iteration) are passed as a single __b object to avoid
  // duplicate-parameter errors under strict mode when a binding key collides with
  // a named param (inputs, steps, env).  Keys that match named params are skipped
  // from the const-declaration list — the named param takes precedence in that case.
  const bindings = ctx.bindings ?? {};
  const decls = Object.keys(bindings)
    .filter((k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !NAMED_PARAMS.has(k))
    .map((k) => `const ${k} = __b[${JSON.stringify(k)}];`)
    .join('');
  const fn = new Function('inputs', 'steps', 'env', '__b', `"use strict"; ${decls} return (${src});`);
  return fn(ctx.inputs, ctx.steps, ctx.env, bindings);
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
