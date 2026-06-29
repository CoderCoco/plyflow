import { it, expect } from 'vitest';
import { runWorkflow } from '@plyflow/core';
import { fakeProvider, mockExec } from './index.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Agent step shape note: when the provider returns { structured } and the step
// has no `output:` schema path, agent.ts returns `result.text ?? ''` — i.e.
// the structured value is NOT surfaced.  fakeProvider maps a non-string rule
// value to { structured }, so the step output for the 'Flight Director' rule is
// the empty string ''.  To get a non-empty text output we supply a string rule.
it('runs an agent + sh workflow with no network and no real shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-testing-'));
  writeFileSync(
    join(dir, 'planner.md'),
    '---\nmodel: claude-opus-4-8\n---\nYou are the Flight Director. Produce a plan.',
  );
  writeFileSync(
    join(dir, 'w.yaml'),
    [
      'name: w',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: plan',
      '        agent: ./planner.md',
      '        prompt: go',
      '      - id: fetch',
      '        sh: gh issue view 7 --json title',
      '        json: true',
    ].join('\n'),
  );

  // fakeProvider: 'Flight Director' matches the system prompt substring.
  // The rule value is a string → normalize() returns { text: '...' }.
  // agent.ts (no output schema): returns { output: result.text ?? '' }.
  // So res.outputs.plan === 'planned: a, b'.
  const res = await runWorkflow(join(dir, 'w.yaml'), {
    isTty: false,
    provider: fakeProvider({ 'Flight Director': 'planned: a, b' }),
    shellExec: mockExec({ 'gh issue view': { stdout: '{"title":"Bug"}', code: 0 } }),
  });

  // Agent step (no output schema): output is result.text from fakeProvider
  expect(res.outputs.plan).toBe('planned: a, b');

  // sh step with json: true: output is { stdout, stderr, code, json }
  expect((res.outputs.fetch as { json: unknown }).json).toEqual({ title: 'Bug' });
});
