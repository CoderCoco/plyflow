import { describe, it, expect } from 'vitest';
import { parseWorkflow, parseAgentConfig } from './format-schema.js';

describe('parseWorkflow', () => {
  it('accepts a minimal valid workflow', () => {
    const wf = parseWorkflow({ name: 'demo', phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }] });
    expect(wf.name).toBe('demo');
  });

  it('rejects a workflow missing phases', () => {
    expect(() => parseWorkflow({ name: 'demo' })).toThrow();
  });

  it('rejects a step with no type key', () => {
    expect(() => parseWorkflow({ name: 'd', phases: [{ name: 'P', steps: [{ id: 's' }] }] })).toThrow();
  });
});

describe('parseAgentConfig', () => {
  it('defaults provider and mode', () => {
    const cfg = parseAgentConfig({ model: 'claude-opus-4-8' });
    expect(cfg.provider).toBe('claude');
    expect(cfg.mode).toBe('api');
  });
});

// ── Fix E: loop step with no steps array fails validation ─────────────────────

describe('Fix E — loop step requires non-empty steps', () => {
  it('rejects a loop step with no steps array', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 'l', loop: { maxIterations: 3 } }] }],
      }),
    ).toThrow();
  });

  it('rejects a loop step with an empty steps array', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 'l', loop: { maxIterations: 3 }, steps: [] }] }],
      }),
    ).toThrow();
  });

  it('accepts a loop step with a non-empty steps array', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [
          {
            name: 'P',
            steps: [
              { id: 'l', loop: { maxIterations: 3 }, steps: [{ id: 'inner', run: 'return 1;' }] },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });
});

// ── Fix F: step id must not contain '/' ──────────────────────────────────────

describe('Fix F — step id must not contain "/"', () => {
  it('rejects a step id containing "/"', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 'bad/id', run: 'return 1;' }] }],
      }),
    ).toThrow();
  });

  it('accepts a step id without "/"', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 'good-id', run: 'return 1;' }] }],
      }),
    ).not.toThrow();
  });
});

// ── A1: widget + default fields ──────────────────────────────────────────────

describe('A1 — widget and default fields', () => {
  it('accepts a step with widget type key', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', widget: './MyWidget.tsx' }] }],
      }),
    ).not.toThrow();
  });

  it('accepts a step with widget and default', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', widget: './MyWidget.tsx', default: 'fallback' }] }],
      }),
    ).not.toThrow();
  });

  it('accepts an input step with a default value', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [
          {
            name: 'P',
            steps: [{ id: 's', input: { type: 'text', message: 'name?' }, default: 'alice' }],
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a step with both widget and run (two type keys)', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', widget: './W.tsx', run: 'return 1;' }] }],
      }),
    ).toThrow();
  });

  it('rejects a step with no type key (widget is now in the set)', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', default: 'x' }] }],
      }),
    ).toThrow();
  });
});

// ── B1: step: type key + plugins: field ─────────────────────────────────────

describe('B1 — step: type key and plugins: field', () => {
  it('accepts a workflow with plugins field', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        plugins: ['./p.ts'],
        phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }],
      }),
    ).not.toThrow();
  });

  it('accepts a workflow without plugins field', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', run: 'x' }] }],
      }),
    ).not.toThrow();
  });

  it('accepts a step with step: type key', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', step: 'my', with: {} }] }],
      }),
    ).not.toThrow();
  });

  it('rejects a step with both step and run (two type keys)', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', step: 'my', run: 'return 1;' }] }],
      }),
    ).toThrow();
  });

  it('regression: widget is still a valid type key', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', widget: './W.tsx' }] }],
      }),
    ).not.toThrow();
  });
});

// ── A1: sh step schema ───────────────────────────────────────────────────────

const wrap = (step: Record<string, unknown>) => ({
  name: 'w',
  phases: [{ name: 'p', steps: [{ id: 's', ...step }] }],
});

describe('sh step schema', () => {
  it('accepts a sh step with its optional fields', () => {
    const wf = parseWorkflow(
      wrap({ sh: 'echo hi', json: true, cwd: '/tmp', env: { A: 'b' }, dryRun: { stdout: 'x', code: 0 } }),
    );
    expect(wf.phases[0]!.steps[0]!.sh).toBe('echo hi');
  });

  it('rejects a step with both sh and run (exactly-one-type-key)', () => {
    expect(() => parseWorkflow(wrap({ sh: 'echo hi', run: 'return 1' }))).toThrow();
  });
});

// ── Fix 2: bare if/until rejected at schema load time ──────────────────────

describe('Fix 2 — bare if/until rejected at load', () => {
  it('rejects a step with bare if: "true" (no ${{ }})', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', run: 'x', if: 'true' }] }],
      }),
    ).toThrow(/if\/until must be a \$\{\{/);
  });

  it('accepts a step with if: "${{ true }}"', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [{ name: 'P', steps: [{ id: 's', run: 'x', if: '${{ true }}' }] }],
      }),
    ).not.toThrow();
  });

  it('rejects a loop step with bare until (no ${{ }})', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [
          {
            name: 'P',
            steps: [
              {
                id: 'l',
                loop: { maxIterations: 3, until: "steps.x.output.done == true" },
                steps: [{ id: 'inner', run: 'return 1;' }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/if\/until must be a \$\{\{/);
  });

  it('accepts a loop step with until: "${{ steps.x.output.done == true }}"', () => {
    expect(() =>
      parseWorkflow({
        name: 'test',
        phases: [
          {
            name: 'P',
            steps: [
              {
                id: 'l',
                loop: { maxIterations: 3, until: '${{ steps.x.output.done == true }}' },
                steps: [{ id: 'inner', run: 'return 1;' }],
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });
});
