export interface WorkflowFile {
  name: string;
  inputs?: Record<string, InputDef>;
  phases: Phase[];
}

export interface InputDef {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: unknown;
}

export interface Phase {
  name: string;
  steps: StepDef[];
}

export interface StepDef {
  id: string;
  needs?: string[];
  with?: Record<string, unknown>;
  /** Path to a `.ts` file exporting a Zod schema for structured output. */
  output?: string;
  retry?: { max: number; backoff?: number };
  continueOnError?: boolean;
  if?: string;
  // Exactly one of the following selects the step type:
  run?: string; // inline JS source, or a path ending .ts/.js
  uses?: string; // path to a code module
  agent?: string; // path to a `.md` agent file
  prompt?: string; // prompt passed to an agent step
  input?: InputStepDef;
  parallel?: StepDef[];
  loop?: { maxIterations: number; until?: string };
  /** Dynamic fan-out over a runtime array. */
  foreach?: string;
  /** Binding name for the current element (default: 'item'). */
  as?: string;
  /** Expression that produces the element's identity key (default: array index as string). */
  key?: string;
  /** Expression that produces an array of keys this element depends on (default: []). */
  dependsOn?: string;
  /** Maximum number of elements to run concurrently within a wave (default: unlimited). */
  concurrency?: number;
  /** Child sub-pipeline; used by composite step types such as loop and foreach. */
  steps?: StepDef[];
}

export interface InputStepDef {
  type: 'confirm' | 'text' | 'select';
  message: string;
  choices?: string[];
}

export interface AgentConfig {
  model: string;
  provider?: string;
  mode?: 'api' | 'agent-sdk' | 'cli';
  temperature?: number;
  [key: string]: unknown;
}

export interface AgentFile {
  config: AgentConfig;
  systemPrompt: string;
}
