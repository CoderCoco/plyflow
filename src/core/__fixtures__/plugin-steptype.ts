import type { StepType } from '../../steps/types.js';

// Fixture: a StepType-shaped plugin for 'echo'.
// The loader wraps this so its effective match is (d) => d.step === 'echo'.
// The plugin author does NOT need to write a specific match — the loader handles it.
const echoStep: StepType<{ value: unknown }> = {
  name: 'echo',
  // The loader will overwrite this match with (d) => d.step === 'echo'
  match: () => false,
  parse: (def) => ({ value: (def.with as Record<string, unknown> | undefined)?.['value'] }),
  run: async (cfg) => ({ output: cfg.value }),
};

export default echoStep;
