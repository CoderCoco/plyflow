/**
 * Example plugin: uppercase step type.
 *
 * This is a StepType plugin. Export a default StepType object with `name`,
 * `match`, `parse`, and `run`. The plyflow plugin loader wraps `match` so
 * that steps resolve via `step: uppercase` in the workflow YAML — you only
 * need to set a unique `name`.
 *
 * Usage in a workflow:
 *   plugins: ['./steps/uppercase.ts']
 *   ...
 *   - id: shout
 *     step: uppercase
 *     with:
 *       text: 'hello'
 *   # => output: 'HELLO'
 */

import type { StepType } from 'plyflow/steps/types.js';

interface UppercaseConfig {
  text: string;
}

const uppercaseStep: StepType<UppercaseConfig> = {
  name: 'uppercase',
  // The loader wraps this: the effective match becomes (def) => def.step === 'uppercase'.
  // You may leave match as a no-op stub — the plugin loader overrides it.
  match: () => false,
  parse: (def) => ({
    text: String((def.with as Record<string, unknown> | undefined)?.['text'] ?? ''),
  }),
  run: async (cfg) => ({
    output: cfg.text.toUpperCase(),
  }),
};

export default uppercaseStep;
