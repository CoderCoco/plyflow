import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadWorkflow } from '@plyflow/core';

const commsYaml = fileURLToPath(new URL('./comms.yaml', import.meta.url));

describe('comms.yaml', () => {
  it('parses and validates successfully', async () => {
    const wf = await loadWorkflow(commsYaml);
    expect(wf.name).toBe('mission-comms');
  });

  it('has name === mission-comms', async () => {
    const wf = await loadWorkflow(commsYaml);
    expect(wf.name).toBe('mission-comms');
  });

  it('has Fetch, Triage, Fix, and Downlink phases', async () => {
    const wf = await loadWorkflow(commsYaml);
    const phaseNames = wf.phases.map((p) => p.name);
    expect(phaseNames).toContain('Fetch');
    expect(phaseNames).toContain('Triage');
    expect(phaseNames).toContain('Fix');
    expect(phaseNames).toContain('Downlink');
  });

  it('Fetch phase has models and fetch steps', async () => {
    const wf = await loadWorkflow(commsYaml);
    const fetch = wf.phases.find((p) => p.name === 'Fetch')!;
    expect(fetch).toBeDefined();
    const stepIds = fetch.steps.map((s) => s.id);
    expect(stepIds).toContain('models');
    expect(stepIds).toContain('fetch');
  });

  it('fetch step uses github.comments plugin step', async () => {
    const wf = await loadWorkflow(commsYaml);
    const fetch = wf.phases.find((p) => p.name === 'Fetch')!;
    const fetchStep = fetch.steps.find((s) => s.id === 'fetch')!;
    expect(fetchStep.step).toContain('github.comments');
  });

  it('Triage phase has a triage step that is an agent referencing capcom', async () => {
    const wf = await loadWorkflow(commsYaml);
    const triage = wf.phases.find((p) => p.name === 'Triage')!;
    expect(triage).toBeDefined();
    const triageStep = triage.steps.find((s) => s.id === 'triage')!;
    expect(triageStep).toBeDefined();
    expect(triageStep.agent).toContain('capcom');
  });

  it('triage agent step references CapcomTriage output schema', async () => {
    const wf = await loadWorkflow(commsYaml);
    const triage = wf.phases.find((p) => p.name === 'Triage')!;
    const triageStep = triage.steps.find((s) => s.id === 'triage')!;
    expect(triageStep.output).toBeDefined();
    expect(triageStep.output).toContain('CapcomTriage');
  });

  it('triage step needs fetch and models', async () => {
    const wf = await loadWorkflow(commsYaml);
    const triage = wf.phases.find((p) => p.name === 'Triage')!;
    const triageStep = triage.steps.find((s) => s.id === 'triage')!;
    expect(triageStep.needs).toContain('fetch');
    expect(triageStep.needs).toContain('models');
  });

  it('Fix phase has a fix-comments foreach step with needs and if guard', async () => {
    const wf = await loadWorkflow(commsYaml);
    const fix = wf.phases.find((p) => p.name === 'Fix')!;
    expect(fix).toBeDefined();
    const fixComments = fix.steps.find((s) => s.id === 'fix-comments')!;
    expect(fixComments).toBeDefined();
    expect(fixComments.foreach).toBeDefined();
    expect(fixComments['if']).toBeDefined();
    expect(fixComments.needs).toBeDefined();
    expect(fixComments.needs!.length).toBeGreaterThan(0);
  });

  it('fix-comments foreach iterates over actionable comments', async () => {
    const wf = await loadWorkflow(commsYaml);
    const fix = wf.phases.find((p) => p.name === 'Fix')!;
    const fixComments = fix.steps.find((s) => s.id === 'fix-comments')!;
    expect(fixComments.foreach).toContain('actionable');
  });

  it('fix-comments has child steps for fix, verify, and commit', async () => {
    const wf = await loadWorkflow(commsYaml);
    const fix = wf.phases.find((p) => p.name === 'Fix')!;
    const fixComments = fix.steps.find((s) => s.id === 'fix-comments')!;
    const childIds = fixComments.steps?.map((s: any) => s.id) ?? [];
    expect(childIds).toContain('fix');
    expect(childIds).toContain('verify');
    expect(childIds).toContain('commit');
  });

  it('Downlink phase has push and notify steps', async () => {
    const wf = await loadWorkflow(commsYaml);
    const downlink = wf.phases.find((p) => p.name === 'Downlink')!;
    expect(downlink).toBeDefined();
    const stepIds = downlink.steps.map((s) => s.id);
    expect(stepIds).toContain('push');
    expect(stepIds).toContain('notify');
  });
});

// ---------------------------------------------------------------------------
// actionable-comments helper unit test
// ---------------------------------------------------------------------------

describe('actionable-comments helper', () => {
  it('filters to only actionable category comments', async () => {
    const { default: actionableComments } = await import('./lib/actionable-comments.js');

    const triage = {
      comments: [
        { id: 'c1', category: 'actionable' as const, fix_hint: 'Remove unused var' },
        { id: 'c2', category: 'question' as const, reply_draft: 'Good question' },
        { id: 'c3', category: 'actionable' as const, fix_hint: 'Add null check' },
        { id: 'c4', category: 'ignore' as const },
        { id: 'c5', category: 'acknowledge' as const, reply_draft: 'Already handled' },
      ],
    };

    const result = actionableComments({ triage });

    expect(result.actionable).toHaveLength(2);
    expect(result.actionable.every((c) => c.category === 'actionable')).toBe(true);
    expect(result.actionable.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('returns empty array when no actionable comments', async () => {
    const { default: actionableComments } = await import('./lib/actionable-comments.js');

    const triage = {
      comments: [
        { id: 'c1', category: 'ignore' as const },
        { id: 'c2', category: 'question' as const, reply_draft: 'reply' },
      ],
    };

    const result = actionableComments({ triage });

    expect(result.actionable).toHaveLength(0);
  });

  it('returns empty array for empty comments', async () => {
    const { default: actionableComments } = await import('./lib/actionable-comments.js');

    const result = actionableComments({ triage: { comments: [] } });

    expect(result.actionable).toHaveLength(0);
  });
});
