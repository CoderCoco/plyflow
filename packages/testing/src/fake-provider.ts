import type { AIProvider, AICompleteRequest, AIResult } from '@plyflow/core';

function normalize(value: unknown): AIResult {
  if (value !== null && typeof value === 'object' && ('text' in value || 'structured' in value || 'usage' in value)) {
    return value as AIResult;
  }
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
