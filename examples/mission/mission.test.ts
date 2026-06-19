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

  it('has a Review phase', async () => {
    const wf = await loadWorkflow(missionYaml);
    const phaseNames = wf.phases.map((p) => p.name);
    expect(phaseNames).toContain('Review');
  });

  it('review step is a loop with maxIterations:3 and until referencing filter.output.actionable', async () => {
    const wf = await loadWorkflow(missionYaml);
    const review = wf.phases.find((p) => p.name === 'Review')!;
    const reviewStep = review.steps.find((s) => s.id === 'review')!;
    expect(reviewStep).toBeDefined();
    expect(reviewStep.loop).toBeDefined();
    expect(reviewStep.loop!.maxIterations).toBe(3);
    expect(reviewStep.loop!.until).toContain('steps.filter.output.actionable');
    expect(reviewStep.needs).toContain('build');
    expect(reviewStep.needs).toContain('worktree');
    expect(reviewStep.needs).toContain('models');
  });

  it('review loop has inspect foreach referencing steps.scout.output.buckets with needs:[scout]', async () => {
    const wf = await loadWorkflow(missionYaml);
    const review = wf.phases.find((p) => p.name === 'Review')!;
    const reviewStep = review.steps.find((s) => s.id === 'review')!;
    const inspect = reviewStep.steps?.find((s: any) => s.id === 'inspect');
    expect(inspect).toBeDefined();
    expect(inspect.foreach).toContain('steps.scout.output.buckets');
    expect(inspect.needs).toContain('scout');
  });

  it('review loop has repair foreach with if guard and needs:[filter]', async () => {
    const wf = await loadWorkflow(missionYaml);
    const review = wf.phases.find((p) => p.name === 'Review')!;
    const reviewStep = review.steps.find((s) => s.id === 'review')!;
    const repair = reviewStep.steps?.find((s: any) => s.id === 'repair');
    expect(repair).toBeDefined();
    expect(repair['if']).toBeDefined();
    expect(repair['if']).toContain('steps.filter.output.actionable.length');
    expect(repair.needs).toContain('filter');
    expect(repair.foreach).toContain('steps.filter.output.actionable');
  });

  it('repair foreach has commit-fix child with if referencing verify-fix verdict', async () => {
    const wf = await loadWorkflow(missionYaml);
    const review = wf.phases.find((p) => p.name === 'Review')!;
    const reviewStep = review.steps.find((s) => s.id === 'review')!;
    const repair = reviewStep.steps?.find((s: any) => s.id === 'repair');
    const commitFix = repair?.steps?.find((s: any) => s.id === 'commit-fix');
    expect(commitFix).toBeDefined();
    expect(commitFix['if']).toContain('steps.verify-fix.output.verdict');
    expect(commitFix.needs).toContain('verify-fix');
  });
});
