import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadWorkflow } from '@plyflow/core';

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

  it('plan step has agent, output referencing Plan.ts, and model override (no cross-phase needs)', async () => {
    const wf = await loadWorkflow(missionYaml);
    const plan = wf.phases.find((p) => p.name === 'Plan')!;
    const planStep = plan.steps.find((s) => s.id === 'plan')!;
    expect(planStep.agent).toBeDefined();
    expect(planStep.agent).toContain('flight-director');
    expect(planStep.output).toBeDefined();
    expect(planStep.output).toContain('Plan.ts');
    expect(planStep.model).toBeDefined();
    // issue, worktree, models are from Setup (inherited cross-phase — no needs required)
    expect(planStep.needs ?? []).not.toContain('issue');
    expect(planStep.needs ?? []).not.toContain('worktree');
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

  it('build step is a foreach over steps.plan.output.tasks (no cross-phase needs)', async () => {
    const wf = await loadWorkflow(missionYaml);
    const build = wf.phases.find((p) => p.name === 'Build')!;
    const buildStep = build.steps.find((s) => s.id === 'build')!;
    expect(buildStep).toBeDefined();
    expect(buildStep.foreach).toContain('steps.plan.output.tasks');
    // plan, ready, worktree, models are from prior phases — inherited, no needs required
    expect(buildStep.needs ?? []).not.toContain('plan');
    expect(buildStep.needs ?? []).not.toContain('worktree');
  });

  it('build step has no cross-phase needs (cross-phase data flows via inheritedSteps)', async () => {
    const wf = await loadWorkflow(missionYaml);
    const build = wf.phases.find((p) => p.name === 'Build')!;
    const buildStep = build.steps.find((s) => s.id === 'build')!;
    // Cross-phase steps (plan, worktree, models, ready) must NOT appear in needs —
    // the scheduler only resolves within-phase/within-scope deps.
    const crossPhaseIds = ['plan', 'worktree', 'models', 'ready'];
    for (const id of crossPhaseIds) {
      expect(buildStep.needs ?? []).not.toContain(id);
    }
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

  it('review step is a loop with maxIterations:3 and until referencing filter.output.actionable (no cross-phase needs)', async () => {
    const wf = await loadWorkflow(missionYaml);
    const review = wf.phases.find((p) => p.name === 'Review')!;
    const reviewStep = review.steps.find((s) => s.id === 'review')!;
    expect(reviewStep).toBeDefined();
    expect(reviewStep.loop).toBeDefined();
    expect(reviewStep.loop!.maxIterations).toBe(3);
    expect(reviewStep.loop!.until).toContain('steps.filter.output.actionable');
    // build, worktree, models are from prior phases — inherited, no needs required
    expect(reviewStep.needs ?? []).not.toContain('build');
    expect(reviewStep.needs ?? []).not.toContain('worktree');
    expect(reviewStep.needs ?? []).not.toContain('models');
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
    expect(commitFix['if']).toContain("verify-fix");
    expect(commitFix.needs).toContain('verify-fix');
  });

  // -------------------------------------------------------------------------
  // Docking phase assertions
  // -------------------------------------------------------------------------

  it('has a Docking phase', async () => {
    const wf = await loadWorkflow(missionYaml);
    const phaseNames = wf.phases.map((p) => p.name);
    expect(phaseNames).toContain('Docking');
  });

  it('Docking phase has push and pr steps', async () => {
    const wf = await loadWorkflow(missionYaml);
    const docking = wf.phases.find((p) => p.name === 'Docking')!;
    expect(docking).toBeDefined();
    const stepIds = docking.steps.map((s) => s.id);
    expect(stepIds).toContain('push');
    expect(stepIds).toContain('pr');
  });

  it('Docking push step uses git.push plugin step (no cross-phase needs — worktree and plan are inherited)', async () => {
    const wf = await loadWorkflow(missionYaml);
    const docking = wf.phases.find((p) => p.name === 'Docking')!;
    const push = docking.steps.find((s) => s.id === 'push')!;
    expect(push).toBeDefined();
    expect(push.step).toContain('git.push');
    // worktree and plan are from prior phases (inherited) — no needs required
    expect(push.needs ?? []).not.toContain('worktree');
    expect(push.needs ?? []).not.toContain('plan');
  });

  it('Docking pr step needs only push (same-phase); plan/worktree/models are inherited', async () => {
    const wf = await loadWorkflow(missionYaml);
    const docking = wf.phases.find((p) => p.name === 'Docking')!;
    const pr = docking.steps.find((s) => s.id === 'pr')!;
    expect(pr).toBeDefined();
    expect(pr.needs).toContain('push');
    // plan, worktree, models from prior phases — no needs required
    expect(pr.needs ?? []).not.toContain('plan');
    expect(pr.needs ?? []).not.toContain('worktree');
  });

  it('Docking pr step uses github.pr plugin step', async () => {
    const wf = await loadWorkflow(missionYaml);
    const docking = wf.phases.find((p) => p.name === 'Docking')!;
    const pr = docking.steps.find((s) => s.id === 'pr')!;
    expect(pr.step).toContain('github.pr');
  });
});
