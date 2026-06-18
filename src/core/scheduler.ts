import type { Phase, StepDef } from './types.js';

export function planPhase(phase: Phase): StepDef[][] {
  const byId = new Map(phase.steps.map((s) => [s.id, s]));
  for (const s of phase.steps) {
    for (const need of s.needs ?? []) {
      if (!byId.has(need)) throw new Error(`step "${s.id}" needs unknown step "${need}"`);
    }
  }

  const done = new Set<string>();
  const waves: StepDef[][] = [];
  let remaining = [...phase.steps];

  while (remaining.length > 0) {
    const ready = remaining.filter((s) => (s.needs ?? []).every((n) => done.has(n)));
    if (ready.length === 0) {
      throw new Error(`dependency cycle among steps: ${remaining.map((s) => s.id).join(', ')}`);
    }
    waves.push(ready);
    for (const s of ready) done.add(s.id);
    remaining = remaining.filter((s) => !done.has(s.id));
  }
  return waves;
}
