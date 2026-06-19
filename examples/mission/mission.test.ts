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

  it('has a Build phase', async () => {
    const wf = await loadWorkflow(missionYaml);
    const phaseNames = wf.phases.map((p) => p.name);
    expect(phaseNames).toContain('Build');
  });

  it('build step is a foreach over steps.plan.output.tasks', async () => {
    const wf = await loadWorkflow(missionYaml);
    const build = wf.phases.find((p) => p.name === 'Build')!;
    const buildStep = build.steps.find((s) => s.id === 'build')!;
    expect(buildStep).toBeDefined();
    expect(buildStep.foreach).toContain('steps.plan.output.tasks');
    expect(buildStep.needs).toContain('plan');
  });

  it('build step declares needs including plan, worktree, models', async () => {
    const wf = await loadWorkflow(missionYaml);
    const build = wf.phases.find((p) => p.name === 'Build')!;
    const buildStep = build.steps.find((s) => s.id === 'build')!;
    expect(buildStep.needs).toContain('plan');
    expect(buildStep.needs).toContain('worktree');
    expect(buildStep.needs).toContain('models');
  });

  it('build foreach has attempt loop child with until referencing verify verdict', async () => {
    const wf = await loadWorkflow(missionYaml);
    const build = wf.phases.find((p) => p.name === 'Build')!;
    const buildStep = build.steps.find((s) => s.id === 'build')!;
    const attempt = buildStep.steps?.find((s: any) => s.id === 'attempt');
    expect(attempt).toBeDefined();
    expect(attempt.loop).toBeDefined();
    expect(attempt.loop.until).toContain('steps.verify.output.verdict');
  });

  it('build foreach has commit child with if referencing attempt loop verdict', async () => {
    const wf = await loadWorkflow(missionYaml);
    const build = wf.phases.find((p) => p.name === 'Build')!;
    const buildStep = build.steps.find((s) => s.id === 'build')!;
    const commit = buildStep.steps?.find((s: any) => s.id === 'commit');
    expect(commit).toBeDefined();
    expect(commit['if']).toBeDefined();
    expect(commit['if']).toContain('steps.attempt.output.verify.verdict');
  });
});
