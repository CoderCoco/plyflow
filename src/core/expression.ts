export interface ExprContext {
  inputs: Record<string, unknown>;
  steps: Record<string, { output: unknown }>;
  env: Record<string, string | undefined>;
}

const EXPR = /\$\{\{\s*([\s\S]+?)\s*\}\}/g;
const WHOLE = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/;

function evalExpr(src: string, ctx: ExprContext): unknown {
  // Trusted local workflows: evaluate a single JS expression against the context.
  const fn = new Function('inputs', 'steps', 'env', `"use strict"; return (${src});`);
  return fn(ctx.inputs, ctx.steps, ctx.env);
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
