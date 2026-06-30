import type { AgentChunk } from '../core/engine.js';

export type JsonSchema = Record<string, unknown>;

export interface AICompleteRequest {
  system: string;
  prompt: string;
  model: string;
  /** Per-request mode override; takes precedence over the provider's constructed mode. */
  mode?: string;
  params?: Record<string, unknown>;
  outputSchema?: JsonSchema;
  /** Optional live-streaming callback; called per agent message that maps to a chunk. */
  onChunk?: (chunk: AgentChunk) => void;
}

export interface AIResult {
  text?: string;
  structured?: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  name: string;
  complete(req: AICompleteRequest): Promise<AIResult>;
}
