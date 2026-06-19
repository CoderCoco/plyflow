export type RoleMap = {
  director: string;
  astronaut: string;
  controller: string;
  inspector: string;
  capcom: string;
  docking: string;
  utility: string;
};

const DEFAULTS: RoleMap = {
  director: 'fable',
  astronaut: 'sonnet',
  controller: 'sonnet',
  inspector: 'fable',
  capcom: 'sonnet',
  docking: 'sonnet',
  utility: 'haiku',
};

export interface ResolveModelsInput {
  overrides?: string | Record<string, string>;
  fableAvailable?: boolean;
}

function parseStringOverrides(s: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of s.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (key && value) map[key] = value;
  }
  return map;
}

export default function resolveModels(
  input: ResolveModelsInput,
  _ctx?: unknown,
): RoleMap {
  const { overrides, fableAvailable } = input;

  // Start from defaults
  const resolved: RoleMap = { ...DEFAULTS };

  // Apply overrides
  if (overrides) {
    const overrideMap: Record<string, string> =
      typeof overrides === 'string' ? parseStringOverrides(overrides) : overrides;

    for (const [role, model] of Object.entries(overrideMap)) {
      if (role in resolved) {
        (resolved as Record<string, string>)[role] = model;
      }
    }
  }

  // Fable fallback: if fableAvailable is explicitly false, replace any 'fable' values
  if (fableAvailable === false) {
    for (const role of Object.keys(resolved) as (keyof RoleMap)[]) {
      if (resolved[role] === 'fable') {
        if (role === 'director') {
          resolved[role] = 'opus';
        } else if (role === 'inspector') {
          resolved[role] = 'sonnet';
        } else {
          // any other role still set to 'fable' → sonnet
          resolved[role] = 'sonnet';
        }
      }
    }
  }

  return resolved;
}
