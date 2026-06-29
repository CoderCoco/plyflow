import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// findingsFilter tests
// ---------------------------------------------------------------------------

describe('findingsFilter', () => {
  it('dedupes identical file+summary', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/foo.ts', severity: 'major', confidence: 80, summary: 'Unused var', suggestion: 'Remove it' },
      { file: 'src/foo.ts', severity: 'major', confidence: 80, summary: 'Unused var', suggestion: 'Remove it' },
      { file: 'src/foo.ts', severity: 'minor', confidence: 60, summary: 'Missing semicolon', suggestion: 'Add it' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/foo.ts'],
    });

    // Should dedupe the two identical findings into one
    const allFindings = [...result.actionable, ...result.deferred];
    const unusedVarMatches = allFindings.filter(
      (f) => f.file === 'src/foo.ts' && f.summary === 'Unused var',
    );
    expect(unusedVarMatches).toHaveLength(1);
  });

  it('drops a finding on a file NOT in changed_files (cascade guard)', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/changed.ts', severity: 'major', confidence: 80, summary: 'Issue in changed', suggestion: 'Fix it' },
      { file: 'src/unchanged.ts', severity: 'blocker', confidence: 95, summary: 'Issue in unchanged', suggestion: 'Fix it' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/changed.ts'],
    });

    const allFindings = [...result.actionable, ...result.deferred];
    expect(allFindings.every((f) => f.file !== 'src/unchanged.ts')).toBe(true);
    expect(allFindings.some((f) => f.file === 'src/changed.ts')).toBe(true);
  });

  it('puts confidence 80 in actionable and confidence 30 in deferred with default threshold (50)', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/a.ts', severity: 'major', confidence: 80, summary: 'High confidence', suggestion: 'Fix' },
      { file: 'src/a.ts', severity: 'minor', confidence: 30, summary: 'Low confidence', suggestion: 'Maybe' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/a.ts'],
    });

    expect(result.actionable).toHaveLength(1);
    expect(result.actionable[0].summary).toBe('High confidence');
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0].summary).toBe('Low confidence');
  });

  it('respects a custom confidence_threshold', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/a.ts', severity: 'major', confidence: 70, summary: 'Above custom threshold', suggestion: 'Fix' },
      { file: 'src/a.ts', severity: 'minor', confidence: 55, summary: 'Below custom threshold', suggestion: 'Maybe' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/a.ts'],
      confidence_threshold: 60,
    });

    // confidence > 60 → actionable; confidence <= 60 → deferred
    expect(result.actionable).toHaveLength(1);
    expect(result.actionable[0].summary).toBe('Above custom threshold');
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0].summary).toBe('Below custom threshold');
  });

  it('returns empty arrays when no findings remain after cascade guard', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/other.ts', severity: 'major', confidence: 90, summary: 'Dropped', suggestion: 'Fix' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/changed.ts'],
    });

    expect(result.actionable).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveModels tests
// ---------------------------------------------------------------------------

describe('resolveModels', () => {
  it('returns defaults when no overrides provided', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({});

    expect(result.director).toBe('fable');
    expect(result.astronaut).toBe('sonnet');
    expect(result.controller).toBe('sonnet');
    expect(result.inspector).toBe('fable');
    expect(result.capcom).toBe('sonnet');
    expect(result.docking).toBe('sonnet');
    expect(result.utility).toBe('haiku');
  });

  it('parses string overrides "director=opus,inspector=sonnet" and applies them', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({ overrides: 'director=opus,inspector=sonnet' });

    expect(result.director).toBe('opus');
    expect(result.inspector).toBe('sonnet');
    // Others remain at defaults
    expect(result.astronaut).toBe('sonnet');
    expect(result.utility).toBe('haiku');
  });

  it('accepts object overrides and applies them', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({ overrides: { director: 'haiku', utility: 'opus' } });

    expect(result.director).toBe('haiku');
    expect(result.utility).toBe('opus');
    // Others remain at defaults
    expect(result.controller).toBe('sonnet');
  });

  it('applies fable fallback when fableAvailable is false: director→opus, inspector→sonnet', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({ fableAvailable: false });

    // director defaults to fable → should become opus
    expect(result.director).toBe('opus');
    // inspector defaults to fable → should become sonnet
    expect(result.inspector).toBe('sonnet');
    // roles that were already sonnet/haiku should be unchanged
    expect(result.astronaut).toBe('sonnet');
    expect(result.utility).toBe('haiku');
  });

  it('fable fallback applies after overrides: explicitly set fable→opus/sonnet', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    // Set all to fable via overrides, then apply fallback
    const result = resolveModels({
      overrides: { director: 'fable', astronaut: 'fable', capcom: 'fable' },
      fableAvailable: false,
    });

    // director fable → opus
    expect(result.director).toBe('opus');
    // non-director/inspector fable → sonnet
    expect(result.astronaut).toBe('sonnet');
    expect(result.capcom).toBe('sonnet');
  });
});

