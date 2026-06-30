import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import type { AIProvider, AICompleteRequest, AIResult } from './types.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { messageToChunk } from './agent-sdk-chunks.js';

export type AnthropicLike = { messages: { create(body: any): Promise<any> } };

/**
 * Function type matching the `query` export from `@anthropic-ai/claude-agent-sdk`.
 * Signature: query({ prompt, options? }) => AsyncGenerator<SDKMessage, void>
 */
export type AgentQueryFn = (params: {
  prompt: string;
  options?: {
    model?: string;
    cwd?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
    permissionMode?: string;
    [key: string]: unknown;
  };
}) => AsyncGenerator<SDKMessage, void>;

export interface ClaudeOptions {
  mode?: 'api' | 'cli' | 'agent-sdk';
  client?: AnthropicLike;
  apiKey?: string;
  /** Injected for tests; defaults to spawning `claude -p`. */
  runCli?: (prompt: string, system: string, model: string) => Promise<string>;
  maxTokens?: number;
  /** Injected for tests; defaults to the real `query` from `@anthropic-ai/claude-agent-sdk`. */
  agentQuery?: AgentQueryFn;
}

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private readonly mode: 'api' | 'cli' | 'agent-sdk';
  private readonly client: AnthropicLike;
  private readonly maxTokens: number;
  private readonly runCli?: ClaudeOptions['runCli'];
  /** Exposed as a public readonly so tests can reference the type via `ClaudeProvider['agentQuery']`. */
  readonly agentQuery?: AgentQueryFn;

  constructor(opts: ClaudeOptions = {}) {
    this.mode = opts.mode ?? 'api';
    this.client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike);
    this.maxTokens = opts.maxTokens ?? 4096;
    this.runCli = opts.runCli;
    this.agentQuery = opts.agentQuery;
  }

  async complete(req: AICompleteRequest): Promise<AIResult> {
    const effectiveMode = req.mode ?? this.mode;
    if (effectiveMode === 'cli') return this.completeCli(req);
    if (effectiveMode === 'agent-sdk') return this.completeAgentSdk(req);
    return this.completeApi(req);
  }

  private async completeApi(req: AICompleteRequest): Promise<AIResult> {
    const body: any = {
      model: req.model,
      max_tokens: this.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      ...(req.params?.temperature !== undefined ? { temperature: req.params.temperature } : {}),
    };
    if (req.outputSchema) {
      body.tools = [{ name: 'respond', description: 'Respond with the required structured output.', input_schema: req.outputSchema }];
      body.tool_choice = { type: 'tool', name: 'respond' };
    }
    const res = await this.client.messages.create(body);
    const usage = res.usage ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } : undefined;
    if (req.outputSchema) {
      const tool = (res.content as any[]).find((b) => b.type === 'tool_use');
      if (!tool) throw new Error('Claude did not return the forced tool call');
      return { structured: tool.input, usage };
    }
    const text = (res.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, usage };
  }

  private async completeCli(req: AICompleteRequest): Promise<AIResult> {
    if (!this.runCli) throw new Error('cli mode requires a runCli implementation');
    const text = await this.runCli(req.prompt, req.system, req.model);
    return { text };
  }

  private async completeAgentSdk(req: AICompleteRequest): Promise<AIResult> {
    // Lazily import the real SDK query if no injected one is provided
    const queryFn: AgentQueryFn =
      this.agentQuery ??
      (await import('@anthropic-ai/claude-agent-sdk').then((m) => m.query as unknown as AgentQueryFn));

    const cwd = typeof req.params?.cwd === 'string' ? req.params.cwd : process.cwd();
    const maxTurns = typeof req.params?.maxTurns === 'number' ? req.params.maxTurns : 50;
    const allowedTools = Array.isArray(req.params?.allowedTools)
      ? (req.params.allowedTools as string[])
      : ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'];
    const permissionMode =
      typeof req.params?.permissionMode === 'string' ? req.params.permissionMode : 'bypassPermissions';

    const options: Parameters<AgentQueryFn>[0]['options'] = {
      model: req.model,
      cwd,
      systemPrompt: req.system,
      allowedTools,
      maxTurns,
      permissionMode,
    };

    // When a schema is provided, use the SDK's native outputFormat for structured output
    if (req.outputSchema) {
      options.outputFormat = {
        type: 'json_schema',
        schema: req.outputSchema as Record<string, unknown>,
      };
    }

    const stream = queryFn({ prompt: req.prompt, options });

    // Collect messages, tracking the last assistant message and result message
    let lastAssistantMessage: SDKMessage | null = null;
    let resultMessage: (SDKMessage & { type: 'result' }) | null = null;

    for await (const message of stream) {
      if (req.onChunk) {
        const chunk = messageToChunk(message);
        if (chunk) req.onChunk(chunk);
      }
      if (message.type === 'assistant') {
        lastAssistantMessage = message;
      } else if (message.type === 'result') {
        resultMessage = message as SDKMessage & { type: 'result' };
      }
    }

    // Extract structured output
    if (req.outputSchema) {
      // Prefer the result message's structured_output field (set by SDK when outputFormat is used)
      const resultMsg = resultMessage as any;
      if (resultMsg?.structured_output !== undefined) {
        return { structured: resultMsg.structured_output };
      }

      // Fallback: look for a 'submit' tool_use in the last assistant message
      const assistantMsg = lastAssistantMessage as any;
      if (assistantMsg?.message?.content) {
        const submitTool = (assistantMsg.message.content as any[]).find(
          (b: any) => b.type === 'tool_use' && b.name === 'submit',
        );
        if (submitTool) {
          return { structured: submitTool.input };
        }
      }

      // Last resort: parse final assistant text as JSON
      if (assistantMsg?.message?.content) {
        const textContent = (assistantMsg.message.content as any[])
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text as string)
          .join('');
        if (textContent) {
          return { structured: JSON.parse(textContent) };
        }
      }

      throw new Error('agent-sdk: could not extract structured output from agent response');
    }

    // Text mode: use result.result field, or extract text from last assistant message
    const resultMsg = resultMessage as any;
    if (resultMsg?.result && typeof resultMsg.result === 'string' && resultMsg.result.length > 0) {
      return { text: resultMsg.result };
    }

    const assistantMsg = lastAssistantMessage as any;
    if (assistantMsg?.message?.content) {
      const text = (assistantMsg.message.content as any[])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string)
        .join('');
      return { text };
    }

    return { text: '' };
  }
}

export function defaultRunCli(prompt: string, system: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--model', model];
    if (system) args.push('--append-system-prompt', system);
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`claude exited ${code}: ${err}`))));
  });
}
