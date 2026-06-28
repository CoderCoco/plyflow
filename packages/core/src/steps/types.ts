import type { StepDef } from '../core/types.js';
import type { AIProvider } from '../providers/types.js';

export type StepEvent =
  | { type: 'log'; message: string }
  | { type: 'output'; chunk: string };

export type UiRequest =
  | { kind: 'prompt'; type: 'confirm' | 'text' | 'select'; message: string; choices?: string[] }
  | { kind: 'widget'; module: string; baseDir: string; props: unknown; provided?: string[] };

/**
 * Type alias for the prompt-kind shape of UiRequest.
 * Kept for backward compatibility with callers that reference PromptRequest.
 */
export type PromptRequest = Extract<UiRequest, { kind: 'prompt' }>;

export interface StepContext {
  inputs: Record<string, unknown>;
  env: Record<string, string | undefined>;
  steps: Record<string, { output: unknown }>;
  with: Record<string, unknown>;
  /** Active bindings from the current scope (e.g. `item`, `iteration`). */
  bindings?: Record<string, unknown>;
  provider: AIProvider;
  /** Directory of the workflow file; used to resolve relative paths. */
  baseDir: string;
  /** Whether the process is running in an interactive TTY. */
  isTty: boolean;
  /** True when the run is in dry-run mode; side-effecting steps must not execute. */
  dryRun: boolean;
  /** Bare specifiers whose modules are shared with plyflow's own copies (from workflow's package.json plyflow.provided). */
  provided: string[];
  resolve?(value: unknown): unknown;
  emit(event: StepEvent): void;
  prompt(req: UiRequest): Promise<unknown>;
  /**
   * Load a user module via the run's shared module loader.
   * Relative paths are resolved from the workflow's baseDir.
   * Returns the full module namespace object.
   */
  loadModule(path: string): Promise<unknown>;
  /**
   * Run a child sub-pipeline and return its outputs map.
   * Composite step types (loop, foreach, etc.) use this to recurse into
   * the engine so child steps get proper journal tracking, caching, and
   * expression evaluation.
   */
  runChildren?(
    steps: StepDef[],
    extraBindings: Record<string, unknown>,
    subPath: string,
  ): Promise<Record<string, unknown>>;
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
