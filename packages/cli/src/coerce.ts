import { readFileSync } from 'node:fs';

const STRUCTURED = new Set(['object', 'json', 'array']);

function parseStructured(key: string, type: string, source: string, origin: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`input "${key}" (type ${type}) is not valid JSON: ${origin}`);
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
      const isFile = v.startsWith('@');
      const source = isFile ? readFile(v.slice(1)) : v;
      const origin = isFile ? v.slice(1) : v.length > 60 ? `${v.slice(0, 60)}…` : v;
      out[k] = parseStructured(k, t, source, origin);
    } else {
      out[k] = v;
    }
  }
  return out;
}
