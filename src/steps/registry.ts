import type { StepDef } from '../core/types.js';
import type { StepType } from './types.js';

export class StepRegistry {
  private readonly types: StepType[] = [];

  register(t: StepType): void {
    this.types.push(t);
  }

  /**
   * Returns the names of all registered custom step types (those whose name
   * does not match any built-in type key). Useful for error messages.
   */
  customStepNames(): string[] {
    const builtins = new Set(['run', 'agent', 'input', 'widget', 'parallel', 'loop', 'foreach']);
    return this.types.filter((t) => !builtins.has(t.name)).map((t) => t.name);
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
