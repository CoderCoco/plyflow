export interface WorkflowFile {
  name: string;
  inputs?: Record<string, InputDef>;
  outputs?: Record<string, string>;
  phases: Phase[];
  /** Paths to plugin modules (relative to the workflow dir) to load before executing. */
  plugins?: string[];
}

export interface InputDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'json' | 'array';
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
  /** Path to a custom Ink/React widget component (.tsx). */
  widget?: string;
  /** Registered name of a custom step type (plugin) to invoke. */
  step?: string;
  /** Path to a sub-workflow file to run (the `use:` step). */
  use?: string;
  /** Default value returned when the step runs in non-TTY mode (no prompt available). */
  default?: unknown;
  /** Shell command to execute (the `sh:` step type). Expression-resolved. */
  sh?: string;
  /** Parse the command's stdout as JSON into the step output (`sh` step). */
  json?: boolean;
  /** Working directory for the `sh` command (expression-resolved). */
  cwd?: string;
  /** Environment overrides for the `sh` command (expression-resolved values). */
  env?: Record<string, string>;
  /** Declarative result returned for this `sh` step under engine dry-run. */
  dryRun?: { stdout?: string; stderr?: string; code?: number };
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
  /** Per-step model override (expression-resolved). */
  model?: string;
  /** Per-step mode override (expression-resolved). */
  mode?: string;
  /** Per-step params override merged into the provider request (expression-resolved). */
  params?: Record<string, unknown>;
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
