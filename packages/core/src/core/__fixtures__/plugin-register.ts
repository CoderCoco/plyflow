import type { StepRegistry } from '../../steps/registry.js';
import type { StepDef } from '../types.js';

// Fixture: a register-function plugin.
// The register-fn form owns its own match. This fixture writes the conventional
// match so 'twice' is invocable via { step: 'twice' }.
export default function register(registry: StepRegistry): void {
  registry.register({
    name: 'twice',
    match: (def: StepDef) => def.step === 'twice',
    parse: (def: StepDef) => ({ n: (def.with as Record<string, unknown> | undefined)?.['n'] as number }),
    run: async (cfg: { n: number }) => ({ output: cfg.n * 2 }),
  });
}
