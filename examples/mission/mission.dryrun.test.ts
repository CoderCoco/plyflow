/**
 * End-to-end dry-run for examples/mission/mission.yaml.
 *
 * Runs the full 5-phase workflow (Setup → Plan → Build → Review → Docking)
 * with:
 *   - MISSION_DRYRUN=1  →  git/gh helpers return canned values (no subprocess)
 *   - MissionFakeProvider  →  dispatches scripted structured outputs to each
 *     agent step based on keywords in the request's system prompt
 *   - autoPrompt  →  auto-approves the Plan-phase "ready" confirm gate
 *
 * This is the gate that catches output-path wiring bugs that parse-only tests
 * miss (foreach output shape, loop.until references, if-guard paths, etc.).
 *
 * Also contains a FAIL-first scenario (FIX 7) that proves the retry loop
 * and review repair fan-out actually fire when conditionals are ${{ }}-wrapped.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runWorkflow } from '@plyflow/core';
import type { AIProvider, AICompleteRequest, AIResult } from '@plyflow/core';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const missionYamlPath = fileURLToPath(new URL('./mission.yaml', import.meta.url));

// ---------------------------------------------------------------------------
// MissionFakeProvider
//
// Dispatches by inspecting the system prompt rather than using a positional
// queue — this is robust to changes in engine scheduling order.
// ---------------------------------------------------------------------------

/**
 * Tiny fixed Plan returned by the Flight Director.
 * One task with no dependencies → deterministic Build foreach (1 iteration).
 */
const FAKE_PLAN = {
  issue_title: 'dry-run issue',
  branch: 'claude/issue-123-dry-run-issue',
  worktree_path: '.claude/worktrees/issue-123-dry-run-issue',
  tasks: [
    {
      name: 'task-one',
      title: 'Implement the thing',
      files: ['src/thing.ts'],
      depends_on: [] as string[],
      acceptance: 'The thing works.',
    },
  ],
  open_questions: [] as string[],
};

const FAKE_ASTRONAUT_REPORT = {
  task_name: 'task-one',
  status: 'done' as const,
  files_modified: ['src/thing.ts'],
  summary: 'Implemented the thing.',
};

const FAKE_CONTROLLER_VERDICT_PASS = {
  task_name: 'task-one',
  verdict: 'PASS' as const,
  fixes_needed: [] as string[],
};

const FAKE_SCOUT_RESULT = {
  // Empty buckets → inspect foreach is empty → filter sees findings:[] → actionable:[]
  // → review loop exits after round 1 (until condition met immediately).
  buckets: [] as string[],
  changed_files: [] as string[],
  specialists: [] as string[],
};

class MissionFakeProvider implements AIProvider {
  name = 'mission-fake';
  calls: AICompleteRequest[] = [];

  async complete(req: AICompleteRequest): Promise<AIResult> {
    this.calls.push(req);
    const sys = req.system ?? '';

    // Dispatch by the opening sentence of each agent's system prompt.
    // Use the most-specific match first to avoid cross-mention false positives
    // (e.g., the Astronaut prompt mentions "Flight Director's plan").

    // Flight Director (opens with "You are the Flight Director")
    if (sys.startsWith('You are the Flight Director')) {
      return { structured: FAKE_PLAN };
    }

    // Flight Controller (opens with "You are the Flight Controller")
    if (sys.startsWith('You are the Flight Controller')) {
      return { structured: FAKE_CONTROLLER_VERDICT_PASS };
    }

    // Scout (opens with "You are the Scout")
    if (sys.startsWith('You are the Scout')) {
      return { structured: FAKE_SCOUT_RESULT };
    }

    // Systems Inspector (triggered only if scout returns non-empty buckets)
    if (sys.startsWith('You are the Systems Inspector') || sys.startsWith('You are the Inspector')) {
      return { structured: { findings: [] } };
    }

    // Astronaut — catchall for any remaining agent
    if (sys.startsWith('You are an Astronaut')) {
      return { structured: FAKE_ASTRONAUT_REPORT };
    }

    // Capcom / Docking — should not be called in the main mission flow
    // but return safe defaults to avoid hard failures.
    return { structured: {}, text: '' };
  }
}

// ---------------------------------------------------------------------------
// Auto-prompt handler — approve every input step (confirm gate)
// ---------------------------------------------------------------------------

async function autoPrompt(_stepId: string, _req: unknown): Promise<unknown> {
  return true;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('mission.yaml dry-run end-to-end', () => {
  let runDir: string;
  const originalDryrun = process.env.MISSION_DRYRUN;

  beforeEach(async () => {
    process.env.MISSION_DRYRUN = '1';
    runDir = await mkdtemp(join(tmpdir(), 'plyflow-mission-dryrun-'));
  });

  afterEach(async () => {
    // Restore env var
    if (originalDryrun === undefined) {
      delete process.env.MISSION_DRYRUN;
    } else {
      process.env.MISSION_DRYRUN = originalDryrun;
    }
    await rm(runDir, { recursive: true, force: true });
  });

  it('completes all 5 phases without throwing', async () => {
    const provider = new MissionFakeProvider();

    const result = await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider,
      runDir,
      prompt: autoPrompt,
      isTty: true,
    });

    expect(result).toBeDefined();
    expect(result.runId).toBeTruthy();
  });

  it('invokes the Flight Director exactly once (Plan phase)', async () => {
    const provider = new MissionFakeProvider();

    await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider,
      runDir,
      prompt: autoPrompt,
      isTty: true,
    });

    // Use startsWith to avoid matching cross-mentions (e.g. "Flight Director's plan" in Astronaut prompt)
    const directorCalls = provider.calls.filter((c) =>
      c.system.startsWith('You are the Flight Director'),
    );
    expect(directorCalls).toHaveLength(1);
  });

  it('Build phase fans out one astronaut + controller per task', async () => {
    const provider = new MissionFakeProvider();

    await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider,
      runDir,
      prompt: autoPrompt,
      isTty: true,
    });

    // 1 task → 1 astronaut call, 1 controller call (PASS on first try)
    // Use startsWith to avoid cross-mention false positives
    const astronautCalls = provider.calls.filter((c) =>
      c.system.startsWith('You are an Astronaut'),
    );
    const controllerCalls = provider.calls.filter((c) =>
      c.system.startsWith('You are the Flight Controller'),
    );
    expect(astronautCalls).toHaveLength(1);
    expect(controllerCalls).toHaveLength(1);
  });

  it('Review phase runs the Scout exactly once (loop exits round 1)', async () => {
    const provider = new MissionFakeProvider();

    await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider,
      runDir,
      prompt: autoPrompt,
      isTty: true,
    });

    const scoutCalls = provider.calls.filter((c) => c.system.startsWith('You are the Scout'));
    expect(scoutCalls).toHaveLength(1);
  });

  it('Docking pr step produces a pr_number in outputs', async () => {
    const provider = new MissionFakeProvider();

    const result = await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider,
      runDir,
      prompt: autoPrompt,
      isTty: true,
    });

    // The pr step output should be the GhPrResult from the dry-run gate.
    const prOutput = result.outputs['pr'] as { pr_number: number; pr_url: string } | undefined;
    expect(prOutput).toBeDefined();
    expect(typeof prOutput?.pr_number).toBe('number');
    expect(prOutput?.pr_number).toBe(1);
  });

  it('Build produces an output entry for each task (foreach fan-out)', async () => {
    const provider = new MissionFakeProvider();

    const result = await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider,
      runDir,
      prompt: autoPrompt,
      isTty: true,
    });

    // build output is a foreach result: { [taskName]: { attempt: {...}, commit: {...} } }
    const buildOutput = result.outputs['build'] as Record<string, unknown> | undefined;
    expect(buildOutput).toBeDefined();
    // FAKE_PLAN has 1 task named 'task-one'
    expect(Object.keys(buildOutput!)).toContain('task-one');
  });
});

// ---------------------------------------------------------------------------
// FAIL-first scenario (FIX 7)
//
// Proves that the retry loop + review repair fan-out ACTUALLY fire now that
// all if/until conditionals are ${{ }}-wrapped.
//
// Scenario:
//   Build:  controller FAILs on iteration 0 → loop continues → astronaut
//           called twice → controller PASSes on iteration 1 → loop exits.
//   Review: Scout round 1 returns one 'typescript' bucket → Inspector returns
//           one finding (confidence=80) → filter puts it in actionable →
//           repair foreach runs (1 fix astronaut + 1 controller PASS) →
//           Scout round 2 returns empty → filter sees nothing → until exits.
// ---------------------------------------------------------------------------

describe('mission.yaml FAIL-first dry-run (FIX 7)', () => {
  let runDir: string;
  const originalDryrun = process.env.MISSION_DRYRUN;

  beforeEach(async () => {
    process.env.MISSION_DRYRUN = '1';
    runDir = await mkdtemp(join(tmpdir(), 'plyflow-mission-failfirst-'));
  });

  afterEach(async () => {
    if (originalDryrun === undefined) {
      delete process.env.MISSION_DRYRUN;
    } else {
      process.env.MISSION_DRYRUN = originalDryrun;
    }
    await rm(runDir, { recursive: true, force: true });
  });

  it('astronaut called twice when controller FAILs first; review repair runs then exits', async () => {
    let controllerCallCount = 0;
    let scoutCallCount = 0;

    const FAKE_SCOUT_ONE_BUCKET = {
      buckets: ['typescript'],
      changed_files: ['src/thing.ts'],
      specialists: ['typescript-specialist'],
    };
    const FAKE_SCOUT_EMPTY = {
      buckets: [] as string[],
      changed_files: [] as string[],
      specialists: [] as string[],
    };
    const FAKE_INSPECTOR_ONE_FINDING = {
      findings: [
        {
          file: 'src/thing.ts',
          severity: 'major',
          confidence: 80,
          summary: 'Missing null check',
          suggestion: 'Add null check before access',
        },
      ],
    };

    class MissionFakeRetryProvider implements AIProvider {
      name = 'mission-fake-retry';
      calls: AICompleteRequest[] = [];
      astronautCallCount = 0;

      async complete(req: AICompleteRequest): Promise<AIResult> {
        this.calls.push(req);
        const sys = req.system ?? '';

        if (sys.startsWith('You are the Flight Director')) {
          return { structured: FAKE_PLAN };
        }

        if (sys.startsWith('You are the Flight Controller')) {
          controllerCallCount++;
          if (controllerCallCount === 1) {
            // First call: FAIL → forces astronaut retry
            return {
              structured: {
                task_name: 'task-one',
                verdict: 'FAIL' as const,
                fixes_needed: ['Add missing null check'],
              },
            };
          }
          // All subsequent calls: PASS
          return {
            structured: {
              task_name: 'task-one',
              verdict: 'PASS' as const,
              fixes_needed: [] as string[],
            },
          };
        }

        if (sys.startsWith('You are the Scout')) {
          scoutCallCount++;
          // Round 1: one bucket; round 2: empty (until condition met)
          return { structured: scoutCallCount === 1 ? FAKE_SCOUT_ONE_BUCKET : FAKE_SCOUT_EMPTY };
        }

        if (
          sys.startsWith('You are the Systems Inspector') ||
          sys.startsWith('You are the Inspector')
        ) {
          return { structured: FAKE_INSPECTOR_ONE_FINDING };
        }

        if (sys.startsWith('You are an Astronaut')) {
          this.astronautCallCount++;
          return { structured: FAKE_ASTRONAUT_REPORT };
        }

        return { structured: {}, text: '' };
      }
    }

    const provider = new MissionFakeRetryProvider();

    await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider,
      runDir,
      prompt: autoPrompt,
      isTty: true,
    });

    // CRITICAL: retry loop fired → astronaut was called at least twice
    // (once for build task attempt 0, once for attempt 1 after FAIL)
    // Plus at least once for the review repair fix → total ≥ 3
    expect(provider.astronautCallCount).toBeGreaterThanOrEqual(2);

    // Review ran two rounds: round 1 (found issues, ran repair), round 2 (empty → exit)
    expect(scoutCallCount).toBeGreaterThanOrEqual(2);

    // Controller: 1st call (FAIL for build), 2nd call (PASS for build retry),
    // at least 1 more for review repair verify → total ≥ 3
    expect(controllerCallCount).toBeGreaterThanOrEqual(3);
  });
});
