import { planWaves } from './dag.js';
import type { Phase, StepDef } from './types.js';

export function planPhase(phase: Phase): StepDef[][] {
  const byId = new Map(phase.steps.map((s) => [s.id, s]));
  const nodes = phase.steps.map((s) => ({ id: s.id, needs: s.needs ?? [] }));

  // planWaves validates unknown deps and detects cycles.
  // Rethrow with the original scheduler error message format so existing tests pass.
  let waveIds: string[][];
  try {
    waveIds = planWaves(nodes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unknown dependency/i.test(msg)) {
      const m = msg.match(/"([^"]+)" referenced by "([^"]+)"/);
      if (m) throw new Error(`step "${m[2]}" needs unknown step "${m[1]}"`);
    }
    if (/cycle/i.test(msg)) {
      throw new Error(`dependency cycle among steps: ${phase.steps.map((s) => s.id).join(', ')}`);
    }
    throw err;
  }

  return waveIds.map((ids) => ids.map((id) => byId.get(id)!));
}
