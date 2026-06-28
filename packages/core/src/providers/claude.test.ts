import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from './claude.js';

describe('ClaudeProvider api mode', () => {
  it('returns text content when no schema is given', async () => {
    const client = {
      messages: {
        create: async () => ({ content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 1, output_tokens: 2 } }),
      },
    };
    const p = new ClaudeProvider({ mode: 'api', client });
    const r = await p.complete({ system: 's', prompt: 'p', model: 'm' });
    expect(r.text).toBe('hello');
    expect(r.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('forces a tool call and returns structured input when a schema is given', async () => {
    let sentBody: any;
    const client = {
      messages: {
        create: async (body: any) => {
          sentBody = body;
          return { content: [{ type: 'tool_use', name: 'respond', input: { title: 'T' } }], usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    };
    const p = new ClaudeProvider({ mode: 'api', client });
    const r = await p.complete({ system: 's', prompt: 'p', model: 'm', outputSchema: { type: 'object', properties: { title: { type: 'string' } } } });
    expect(r.structured).toEqual({ title: 'T' });
    expect(sentBody.tool_choice).toEqual({ type: 'tool', name: 'respond' });
    expect(sentBody.tools[0].input_schema).toHaveProperty('properties.title');
  });
});
