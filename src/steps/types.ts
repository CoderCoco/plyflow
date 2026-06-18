import type { StepDef } from '../core/types.js';
import type { AIProvider } from '../providers/types.js';

export type StepEvent =
  | { type: 'log'; message: string }
  | { type: 'output'; chunk: string };

export interface PromptRequest {
  type: 'confirm' | 'text' | 'select';
  message: string;
  choices?: string[];
}

export interface StepContext {
  inputs: Record<string, unknown>;
  env: Record<string, string | undefined>;
  steps: Record<string, { output: unknown }>;
  with: Record<string, unknown>;
  provider: AIProvider;
  /** Directory of the workflow file; used to resolve relative paths. */
  baseDir: string;
  resolve?(value: unknown): unknown;
  emit(event: StepEvent): void;
  prompt(req: PromptRequest): Promise<unknown>;
}

export interface StepResult {
  output: unknown;
}

export interface StepType<Cfg = unknown> {
  name: string;
  match(def: StepDef): boolean;
  parse(def: StepDef): Cfg;
  run(cfg: Cfg, ctx: StepContext): Promise<StepResult>;
}
