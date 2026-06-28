import type { StepDef } from '../core/types.js';
import type { StepType } from './types.js';

export class StepRegistry {
  private readonly types: StepType[] = [];

  register(t: StepType): void {
    this.types.push(t);
  }

  /**
   * Return a new StepRegistry seeded with the same types as this one.
   * Used by runWorkflow to isolate per-run registries from a caller-provided
   * shared registry.
   */
  clone(): StepRegistry {
    const copy = new StepRegistry();
    for (const t of this.types) {
      copy.types.push(t);
    }
    return copy;
  }

  /**
   * Returns the names of all registered custom step types — those that are
   * invoked via the `step:` key, i.e. types whose `match` returns true when
   * called with `{ id: '', step: type.name }`. Built-in step types (run,
   * agent, etc.) match on their own key (e.g. `def.run`, `def.agent`) and
   * therefore return false for the `step:` probe, so they are naturally
   * excluded. This is computed dynamically from the registry's actual types,
   * with no hardcoded list of built-in names. Useful for error messages.
   */
  customStepNames(): string[] {
    return this.types
      .filter((t) => t.match({ id: '', step: t.name }))
      .map((t) => t.name);
  }

  select(def: StepDef): StepType {
    const matches = this.types.filter((t) => t.match(def));
    if (matches.length === 0) {
      // Provide a clear error when a step: <name> key was set but unmatched
      if (def.step !== undefined) {
        const customs = this.customStepNames();
        const hint =
          customs.length > 0
            ? ` Available custom step types: ${customs.map((n) => `"${n}"`).join(', ')}.`
            : ' No custom step types are registered (did you declare a plugin in the workflow or package.json?).';
        throw new Error(
          `Unknown custom step type "${def.step}" for step "${def.id}".${hint}`,
        );
      }
      throw new Error(`no step type matches step "${def.id}"`);
    }
    if (matches.length > 1) {
      throw new Error(`ambiguous step "${def.id}" matched: ${matches.map((m) => m.name).join(', ')}`);
    }
    return matches[0]!;
  }
}
