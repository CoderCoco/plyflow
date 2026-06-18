/**
 * Generic topological wave planner.
 *
 * Takes a list of nodes each with an `id` and a list of dependency `needs` ids,
 * validates all references exist, and returns ordered waves where each wave
 * contains nodes whose dependencies are all satisfied by prior waves.
 *
 * Throws with /unknown/i if a needs id does not exist.
 * Throws with /cycle/i  if a dependency cycle is detected.
 */
export interface DagNode {
  id: string;
  needs: string[];
}

export function planWaves(nodes: DagNode[]): string[][] {
  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    for (const need of node.needs) {
      if (!ids.has(need)) {
        throw new Error(`unknown dependency "${need}" referenced by "${node.id}"`);
      }
    }
  }

  const done = new Set<string>();
  const waves: string[][] = [];
  let remaining = [...nodes];

  while (remaining.length > 0) {
    const ready = remaining.filter((n) => n.needs.every((dep) => done.has(dep)));
    if (ready.length === 0) {
      throw new Error(
        `dependency cycle detected among: ${remaining.map((n) => n.id).join(', ')}`,
      );
    }
    waves.push(ready.map((n) => n.id));
    for (const n of ready) done.add(n.id);
    remaining = remaining.filter((n) => !done.has(n.id));
  }

  return waves;
}
