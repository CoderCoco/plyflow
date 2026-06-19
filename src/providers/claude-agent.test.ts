import { describe, it, expect, vi } from 'vitest';
import { ClaudeProvider } from './claude.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Helper to build a fake async generator from an array of messages
async function* makeStream(messages: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const m of messages) {
    yield m;
  }
}

describe('ClaudeProvider agent-sdk mode', () => {
  it('returns structured output when outputSchema is set and agent calls submit tool', async () => {
    const fakeQuery = vi.fn((_params: { prompt: string; options?: Record<string, unknown> }) =>
      makeStream([
        {
          type: 'assistant',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool_1',
                name: 'submit',
                input: { title: 'T' },
              },
            ],
            model: 'test-model',
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: 'sess_1',
        } as SDKMessage,
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 100,
          duration_api_ms: 80,
          is_error: false,
          num_turns: 1,
          result: '',
          stop_reason: 'tool_use',
          total_cost_usd: 0,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 0 },
          },
          modelUsage: {},
          permission_denials: [],
          structured_output: { title: 'T' },
          uuid: '00000000-0000-0000-0000-000000000002' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: 'sess_1',
        } as SDKMessage,
      ]),
    );

    const provider = new ClaudeProvider({
      mode: 'agent-sdk',
      agentQuery: fakeQuery as unknown as ClaudeProvider['agentQuery'],
    });

    const result = await provider.complete({
      system: 'you are a helper',
      prompt: 'do the thing',
      model: 'claude-sonnet-4-6',
      outputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    });

    expect(result.structured).toEqual({ title: 'T' });
  });

  it('returns text when no outputSchema is set and agent returns a final text message', async () => {
    const fakeQuery = vi.fn((_params: { prompt: string; options?: Record<string, unknown> }) =>
      makeStream([
        {
          type: 'assistant',
          message: {
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'done summary' }],
            model: 'test-model',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 5, output_tokens: 3 },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-0000-0000-000000000003' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: 'sess_2',
        } as SDKMessage,
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 50,
          duration_api_ms: 40,
          is_error: false,
          num_turns: 1,
          result: 'done summary',
          stop_reason: 'end_turn',
          total_cost_usd: 0,
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 0 },
          },
          modelUsage: {},
          permission_denials: [],
          uuid: '00000000-0000-0000-0000-000000000004' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: 'sess_2',
        } as SDKMessage,
      ]),
    );

    const provider = new ClaudeProvider({
      mode: 'agent-sdk',
      agentQuery: fakeQuery as unknown as ClaudeProvider['agentQuery'],
    });

    const result = await provider.complete({
      system: 'you are a helper',
      prompt: 'summarise the code',
      model: 'claude-sonnet-4-6',
    });

    expect(result.text).toBe('done summary');
  });

  it('passes model, system prompt, cwd, and prompt to the query function', async () => {
    let capturedParams: { prompt: string; options?: Record<string, unknown> } | undefined;

    const fakeQuery = vi.fn((params: { prompt: string; options?: Record<string, unknown> }) => {
      capturedParams = params;
      return makeStream([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 10,
          duration_api_ms: 8,
          is_error: false,
          num_turns: 1,
          result: 'ok',
          stop_reason: 'end_turn',
          total_cost_usd: 0,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 0 },
          },
          modelUsage: {},
          permission_denials: [],
          uuid: '00000000-0000-0000-0000-000000000005' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: 'sess_3',
        } as SDKMessage,
      ]);
    });

    const provider = new ClaudeProvider({
      mode: 'agent-sdk',
      agentQuery: fakeQuery as unknown as ClaudeProvider['agentQuery'],
    });

    await provider.complete({
      system: 'be helpful',
      prompt: 'what is 2+2',
      model: 'claude-opus-4-8',
      params: { cwd: '/tmp/test-dir', maxTurns: 10 },
    });

    expect(capturedParams).toBeDefined();
    expect(capturedParams!.prompt).toBe('what is 2+2');
    expect(capturedParams!.options).toMatchObject({
      model: 'claude-opus-4-8',
      systemPrompt: 'be helpful',
      cwd: '/tmp/test-dir',
      maxTurns: 10,
    });
  });
});
