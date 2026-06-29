import type { AIProvider, AICompleteRequest, AIResult } from '@plyflow/core';

const AIRESULT_KEYS = new Set(['text', 'structured', 'usage']);

function isAIResult(value: unknown): value is AIResult {
  if (value === null || typeof value !== 'object') return false;
  const keys = Object.keys(value);
  // Treat the value as an AIResult only when it carries a payload field
  // (`text` or `structured`) and has no foreign keys. A bare `{ usage: … }`
  // (no text/structured) is a structured test fixture, not an AIResult.
  return (
    keys.length > 0 &&
    keys.every((k) => AIRESULT_KEYS.has(k)) &&
    ('text' in value || 'structured' in value)
  );
}

function normalize(value: unknown): AIResult {
  if (isAIResult(value)) return value;
  if (typeof value === 'string') return { text: value };
  return { structured: value };
}

/**
 * A fake AIProvider that returns a scripted result based on which rule key
 * appears as a substring of the request's `system` prompt. Robust to scheduler
 * reordering (unlike a positional queue). Rule values: an explicit AIResult is
 * used as-is; a string becomes `{ text }`; anything else becomes `{ structured }`.
 */
export function fakeProvider(rules: Record<string, unknown>): AIProvider {
  return {
    name: 'fake',
    async complete(req: AICompleteRequest): Promise<AIResult> {
      for (const [key, value] of Object.entries(rules)) {
        if (req.system.includes(key)) return normalize(value);
      }
      throw new Error(`no fakeProvider rule matched the system prompt: ${req.system.slice(0, 80)}`);
    },
  };
}
