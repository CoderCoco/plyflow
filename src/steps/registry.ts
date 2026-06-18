import type { StepDef } from '../core/types.js';
import type { StepType } from './types.js';

export class StepRegistry {
  private readonly types: StepType[] = [];

  register(t: StepType): void {
    this.types.push(t);
  }

  select(def: StepDef): StepType {
    const matches = this.types.filter((t) => t.match(def));
    if (matches.length === 0) throw new Error(`no step type matches step "${def.id}"`);
    if (matches.length > 1) {
      throw new Error(`ambiguous step "${def.id}" matched: ${matches.map((m) => m.name).join(', ')}`);
    }
    return matches[0]!;
  }
}
