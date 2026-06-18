export type JsonSchema = Record<string, unknown>;

export interface AICompleteRequest {
  system: string;
  prompt: string;
  model: string;
  /** Per-request mode override; takes precedence over the provider's constructed mode. */
  mode?: string;
  params?: Record<string, unknown>;
  outputSchema?: JsonSchema;
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
