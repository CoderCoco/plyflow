import { describe, it, expect } from 'vitest';
import { messageToChunk } from './agent-sdk-chunks.js';
import { ClaudeProvider } from './claude.js';

describe('messageToChunk', () => {
  it('maps an assistant tool_use block to a tool_use chunk', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/scheduler.ts' } }] } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'tool_use', name: 'Edit', summary: 'src/scheduler.ts' });
  });

  it('maps assistant text to an assistant chunk', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'text', text: 'fixed the bug' }] } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'assistant', text: 'fixed the bug' });
  });

  it('maps a user tool_result block to a tool_result chunk', () => {
    const msg = { type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: '41 passed' }] } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'tool_result', ok: true, summary: '41 passed' });
  });

  it('maps a result message to a result chunk with tokens', () => {
    const msg = { type: 'result', usage: { output_tokens: 1240 } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'result', tokens: 1240 });
  });

  it('returns null for system/unknown messages', () => {
    expect(messageToChunk({ type: 'system' } as never)).toBeNull();
  });

  it('truncates a tool_result content string longer than 120 chars', () => {
    const longContent = 'a'.repeat(121);
    const msg = { type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: longContent }] } };
    const chunk = messageToChunk(msg as never) as { t: string; ok: boolean; summary: string };
    expect(chunk.t).toBe('tool_result');
    expect(chunk.summary.length).toBeLessThanOrEqual(120);
    expect(chunk.summary.endsWith('…')).toBe(true);
  });
});

describe('ClaudeProvider onChunk (agent-sdk mode)', () => {
  it('calls onChunk for each streamed message that maps to a chunk', async () => {
    async function* fakeQuery() {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } } as never;
      yield { type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: '41 passed' }] } } as never;
      yield { type: 'result', result: 'done', usage: { output_tokens: 7 } } as never;
    }
    const provider = new ClaudeProvider({ mode: 'agent-sdk', agentQuery: fakeQuery as never });
    const chunks: unknown[] = [];
    const res = await provider.complete({
      system: 's', prompt: 'p', model: 'm',
      onChunk: (c) => chunks.push(c),
    });
    expect(chunks).toEqual([
      { t: 'tool_use', name: 'Bash', summary: 'npm test' },
      { t: 'tool_result', ok: true, summary: '41 passed' },
      { t: 'result', tokens: 7 },
    ]);
    expect(res.text).toBe('done');
  });
});
