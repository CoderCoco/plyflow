import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadWorkflow } from '../../src/core/loader.js';

const missionYaml = fileURLToPath(new URL('./mission.yaml', import.meta.url));

describe('mission.yaml', () => {
  it('parses and validates successfully', async () => {
    const wf = await loadWorkflow(missionYaml);
    expect(wf.name).toBe('mission');
  });

  it('has Setup and Plan phases', async () => {
    const wf = await loadWorkflow(missionYaml);
    const phaseNames = wf.phases.map((p) => p.name);
    expect(phaseNames).toContain('Setup');
    expect(phaseNames).toContain('Plan');
  });

  it('Setup phase has models, issue, and worktree steps', async () => {
    const wf = await loadWorkflow(missionYaml);
    const setup = wf.phases.find((p) => p.name === 'Setup')!;
    const stepIds = setup.steps.map((s) => s.id);
    expect(stepIds).toContain('models');
    expect(stepIds).toContain('issue');
    expect(stepIds).toContain('worktree');
  });

  it('worktree step declares needs:[issue]', async () => {
    const wf = await loadWorkflow(missionYaml);
    const setup = wf.phases.find((p) => p.name === 'Setup')!;
    const worktree = setup.steps.find((s) => s.id === 'worktree')!;
    expect(worktree.needs).toContain('issue');
  });

  it('plan step has agent, output referencing Plan.ts, model override, and needs [issue, worktree, models]', async () => {
    const wf = await loadWorkflow(missionYaml);
    const plan = wf.phases.find((p) => p.name === 'Plan')!;
    const planStep = plan.steps.find((s) => s.id === 'plan')!;
    expect(planStep.agent).toBeDefined();
    expect(planStep.agent).toContain('flight-director');
    expect(planStep.output).toBeDefined();
    expect(planStep.output).toContain('Plan.ts');
    expect(planStep.model).toBeDefined();
    expect(planStep.needs).toContain('issue');
    expect(planStep.needs).toContain('worktree');
    expect(planStep.needs).toContain('models');
  });

  it('ready step is an input confirm after plan', async () => {
    const wf = await loadWorkflow(missionYaml);
    const plan = wf.phases.find((p) => p.name === 'Plan')!;
    const ready = plan.steps.find((s) => s.id === 'ready')!;
    expect(ready).toBeDefined();
    expect(ready.input?.type).toBe('confirm');
    expect(ready.needs).toContain('plan');
  });
});
