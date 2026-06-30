import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentChunk } from '../core/engine.js';

/** Short, human-readable summary of a tool_use input (file path or first arg). */
function summarizeToolInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['file_path', 'path', 'command', 'pattern', 'query']) {
      if (typeof o[k] === 'string') return o[k] as string;
    }
  }
  return '';
}

/** Truncate multi-line/long tool results to a single short line. */
function summarizeResult(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const firstLine = text.split('\n', 1)[0] ?? '';
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
}

/**
 * Map one agent-sdk message to a single display chunk, or null when the message
 * carries nothing user-visible. Only the first relevant content block is mapped;
 * the SDK emits one logical action per assistant/user message in practice.
 */
export function messageToChunk(message: SDKMessage): AgentChunk | null {
  const m = message as unknown as { type: string; message?: { content?: unknown[] }; usage?: { output_tokens?: number } };

  if (m.type === 'assistant') {
    const blocks = m.message?.content ?? [];
    const tool = blocks.find((b) => (b as { type?: string }).type === 'tool_use') as { name?: string; input?: unknown } | undefined;
    if (tool) return { t: 'tool_use', name: tool.name ?? 'tool', summary: summarizeToolInput(tool.input) };
    const text = blocks.find((b) => (b as { type?: string }).type === 'text') as { text?: string } | undefined;
    if (text?.text) return { t: 'assistant', text: text.text };
    return null;
  }

  if (m.type === 'user') {
    const blocks = m.message?.content ?? [];
    const tr = blocks.find((b) => (b as { type?: string }).type === 'tool_result') as { is_error?: boolean; content?: unknown } | undefined;
    if (tr) return { t: 'tool_result', ok: !tr.is_error, summary: summarizeResult(tr.content) };
    return null;
  }

  if (m.type === 'result') {
    return { t: 'result', tokens: m.usage?.output_tokens };
  }

  return null;
}
