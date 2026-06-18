import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import type { AIProvider, AICompleteRequest, AIResult } from './types.js';

export type AnthropicLike = { messages: { create(body: any): Promise<any> } };

export interface ClaudeOptions {
  mode?: 'api' | 'cli' | 'agent-sdk';
  client?: AnthropicLike;
  apiKey?: string;
  /** Injected for tests; defaults to spawning `claude -p`. */
  runCli?: (prompt: string, system: string, model: string) => Promise<string>;
  maxTokens?: number;
}

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private readonly mode: 'api' | 'cli' | 'agent-sdk';
  private readonly client: AnthropicLike;
  private readonly maxTokens: number;
  private readonly runCli?: ClaudeOptions['runCli'];

  constructor(opts: ClaudeOptions = {}) {
    this.mode = opts.mode ?? 'api';
    this.client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike);
    this.maxTokens = opts.maxTokens ?? 4096;
    this.runCli = opts.runCli;
  }

  async complete(req: AICompleteRequest): Promise<AIResult> {
    if (this.mode === 'cli') return this.completeCli(req);
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
