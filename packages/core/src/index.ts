// Public library API. Everything needed to run plyflow workflows
// programmatically and to author custom providers / plugins.

// Engine
export { runWorkflow, buildDefaultRegistry } from './core/engine.js';
export type { EngineEvent, RunOptions } from './core/engine.js';

// Loading
export { loadWorkflow, loadAgent } from './core/loader.js';

// Workflow/step types (useful for programmatic construction + plugin authors)
export type {
  WorkflowFile,
  Phase,
  StepDef,
  InputDef,
  InputStepDef,
  AgentFile,
  AgentConfig,
} from './core/types.js';

// Providers
export { FakeProvider } from './providers/fake.js';
export { ClaudeProvider, defaultRunCli } from './providers/claude.js';
export type { ClaudeOptions, AnthropicLike, AgentQueryFn } from './providers/claude.js';
export { makeProvider } from './providers/factory.js';
export type {
  AIProvider,
  AICompleteRequest,
  AIResult,
  JsonSchema,
} from './providers/types.js';

// Step type registry + contracts (for custom plugin step types)
export { StepRegistry } from './steps/registry.js';
export type {
  StepType,
  StepContext,
  StepResult,
  StepEvent,
  UiRequest,
  PromptRequest,
} from './steps/types.js';

// Sub-workflow step (use:) — factory for custom registries / testing
export { makeUseStep } from './steps/use.js';

// Shell step (sh:) — primitive + factory for custom registries / testing
export { makeShStep } from './steps/sh.js';
export { defaultShellExec } from './core/shell.js';
export type { ShellExec, ShellResult } from './core/shell.js';

// Expression stdlib (helpers available inside ${{ }})
export { EXPRESSION_HELPERS } from './core/expression.js';
