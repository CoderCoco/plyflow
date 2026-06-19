# Mission Port P2 Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 ship-blocking bugs in the mission port covering bare conditionals, schema validation, retry feedback threading, branch naming, comms wiring, foreach key collisions, and a FAIL-first dry-run test.

**Architecture:** Fixes span `examples/mission/mission.yaml`, `src/core/format-schema.ts`, `examples/mission/lib/gh-comments.ts`, a new `examples/mission/lib/post-comment.ts`, `examples/mission/comms.yaml`, and `examples/mission/mission.dryrun.test.ts`. Each fix is independently testable.

**Tech Stack:** TypeScript, Zod, Vitest, YAML workflow format, `gh` CLI, ESM `.js` imports.

## Global Constraints

- Branch: `feat/mission-port` — all changes go directly here, no worktree.
- ESM-only: all `.ts` files use `import`/`export`; imports reference `.js` extensions.
- Strict mode: no `any` escapes beyond what already exists.
- All new tests live alongside existing ones in the test files specified.
- Test suite must stay green: 218 tests + new ones.
- `npm run build` and `npm run lint` must pass.
- Commit message (single commit at end): `fix(mission): wrap conditionals, thread fixes_needed, real branch, comms wiring; reject bare if/until`

---

### Task 1: FIX 1 — Wrap all bare `if:`/`until:` conditionals in `${{ }}` in mission.yaml

**Files:**
- Modify: `examples/mission/mission.yaml`

**Interfaces:**
- No new interfaces — purely YAML content changes.
- Produces: mission.yaml where every `if:` and `until:` value starts with `${{` and ends with `}}`.

- [ ] **Step 1: Identify all bare conditionals**

Read `examples/mission/mission.yaml` and note every `if:` and `until:` value. The bare ones (currently without `${{ }}`) are:
1. Line 63: `until: "steps.verify.output.verdict == 'PASS'"` (Build loop)
2. Line 92: `if: "steps.attempt.output.verify.verdict == 'PASS'"` (Build commit)
3. Line 104: `until: "steps.filter.output.actionable.length == 0"` (Review loop)
4. Line 152: `if: "steps.filter.output.actionable.length > 0"` (Review repair)
5. Line 185: `if: "steps.verify-fix.output.verdict == 'PASS'"` (Review commit-fix)

- [ ] **Step 2: Apply the wrapping edits**

In `examples/mission/mission.yaml`, make these exact changes:

Change line 63:
```yaml
              until: "steps.verify.output.verdict == 'PASS'"
```
to:
```yaml
              until: "${{ steps.verify.output.verdict == 'PASS' }}"
```

Change line 92:
```yaml
            if: "steps.attempt.output.verify.verdict == 'PASS'"
```
to:
```yaml
            if: "${{ steps.attempt.output.verify.verdict == 'PASS' }}"
```

Change line 104:
```yaml
          until: "steps.filter.output.actionable.length == 0"
```
to:
```yaml
          until: "${{ steps.filter.output.actionable.length == 0 }}"
```

Change line 152:
```yaml
            if: "steps.filter.output.actionable.length > 0"
```
to:
```yaml
            if: "${{ steps.filter.output.actionable.length > 0 }}"
```

Change line 185:
```yaml
                if: "steps.verify-fix.output.verdict == 'PASS'"
```
to:
```yaml
                if: "${{ steps.verify-fix.output.verdict == 'PASS' }}"
```

- [ ] **Step 3: Verify comms.yaml already wraps correctly**

Read `examples/mission/comms.yaml` and confirm every `if:` already has `${{ }}`. (It does — line 50: `if: "${{ steps.pick.output.actionable.length > 0 }}"` and line 84: `if: "${{ steps.verify.output.verdict == 'PASS' }}"`)

- [ ] **Step 4: Run the existing dry-run tests to confirm they still pass**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run examples/mission/mission.dryrun.test.ts --reporter=verbose
```
Expected: all 6 tests pass.

---

### Task 2: FIX 2 — Reject bare `if`/`until` at schema load time

**Files:**
- Modify: `src/core/format-schema.ts`
- Modify: `src/core/format-schema.test.ts`

**Interfaces:**
- Consumes: `parseWorkflow` from Task 1 (already exists)
- Produces: `parseWorkflow` now throws a Zod error if `if` is present without `${{`, or if `loop.until` is present without `${{`.

- [ ] **Step 1: Write failing tests first**

Add to the end of `src/core/format-schema.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the new tests to confirm they FAIL**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run src/core/format-schema.test.ts --reporter=verbose
```
Expected: the 4 new tests fail (bare `if`/`until` currently accepted).

- [ ] **Step 3: Implement the validation in format-schema.ts**

In `src/core/format-schema.ts`, update the `stepDef` object's `.superRefine()` block to add bare conditional checks. Add after the existing `compositesRequiringSteps` loop:

```typescript
      // Reject bare if/until — must be ${{ }} expressions.
      const requiresExpr = (val: unknown, field: string) => {
        if (typeof val === 'string' && !val.includes('${{')) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `if/until must be a \${{ }} expression (got bare string: "${val}")`,
          });
        }
      };
      requiresExpr(s['if'], 'if');
      if (s.loop && typeof s.loop === 'object' && 'until' in s.loop) {
        requiresExpr((s.loop as { until?: unknown }).until, 'loop.until');
      }
```

- [ ] **Step 4: Run the tests — all 4 new tests + all existing format-schema tests pass**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run src/core/format-schema.test.ts --reporter=verbose
```
Expected: All tests pass (including the 3 existing ones).

- [ ] **Step 5: Run the full suite to confirm nothing regressed**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run --reporter=verbose 2>&1 | tail -10
```
Expected: All tests pass (218 + 4 new = 222).

---

### Task 3: FIX 3 — Thread `fixes_needed` into the astronaut retry prompt

**Files:**
- Modify: `examples/mission/mission.yaml`

**Interfaces:**
- Consumes: `steps.verify.output.fixes_needed` (array of strings from ControllerVerdict schema)
- Produces: The astronaut `implement` step prompt includes prior fix feedback on retries; on iteration 0 (first attempt) when `steps.verify` is not yet populated, the expression returns empty string safely.

- [ ] **Step 1: Update the implement step prompt in mission.yaml**

Locate the `implement` step under Build phase. Change its prompt from:
```yaml
                prompt: |
                  Task: ${{ task.name }} — ${{ task.title }}
                  Files: ${{ task.files }}
                  Acceptance: ${{ task.acceptance }}
                  Iteration: ${{ iteration }}
```
to:
```yaml
                prompt: |
                  Task: ${{ task.name }} — ${{ task.title }}
                  Files: ${{ task.files }}
                  Acceptance: ${{ task.acceptance }}
                  Iteration: ${{ iteration }}
                  Prior verification feedback (address these): ${{ steps.verify && steps.verify.output ? steps.verify.output.fixes_needed : '' }}
```

- [ ] **Step 2: Run dry-run test — confirm it doesn't crash on iteration 0**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run examples/mission/mission.dryrun.test.ts --reporter=verbose
```
Expected: All 6 existing tests still pass (the FAIL-first test in Task 7 will add the regression lock).

---

### Task 4: FIX 4 — Docking must use worktree's real branch, not plan's guess

**Files:**
- Modify: `examples/mission/mission.yaml`

**Interfaces:**
- Consumes: `steps.worktree.output.branch` (the branch git-worktree.ts actually created)
- Produces: Docking `push` and `pr` steps use the real branch from worktree output.

- [ ] **Step 1: Update push and pr steps in Docking phase**

In `examples/mission/mission.yaml`, locate the Docking phase. Change the `push` step's `branch:` from:
```yaml
          branch: "${{ steps.plan.output.branch }}"
```
to:
```yaml
          branch: "${{ steps.worktree.output.branch }}"
```

Change the `pr` step's `branch:` from:
```yaml
          branch: "${{ steps.plan.output.branch }}"
```
to:
```yaml
          branch: "${{ steps.worktree.output.branch }}"
```

Keep `title: "${{ steps.plan.output.issue_title }}"` unchanged.

- [ ] **Step 2: Run dry-run tests — confirm Docking test still passes**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run examples/mission/mission.dryrun.test.ts --reporter=verbose
```
Expected: All tests pass including "Docking pr step produces a pr_number in outputs".

---

### Task 5: FIX 5 — comms.yaml wiring: notify + push branch

**Files:**
- Create: `examples/mission/lib/post-comment.ts`
- Modify: `examples/mission/comms.yaml`
- Modify: `examples/mission/lib/gh-comments.ts` (add `headRefName` to dry-run output)
- Modify: `examples/mission/lib/comms.test.ts` (add post-comment test)

**Interfaces:**
- `post-comment.ts` default export: `(input: { repo?: string; pr: number; body: string }, ctx?: unknown, exec?: Exec) => Promise<{ body: string }>`
- `fetchComments` return type now includes `headRefName: string` in its output.

- [ ] **Step 1: Write failing test for post-comment module**

Add to `examples/mission/lib/comms.test.ts` at the end:

```typescript
describe('post-comment', () => {
  it('calls gh pr comment --body and returns the body', async () => {
    const { exec, calls } = makeFakeExec(() => ({ stdout: '', stderr: '', code: 0 }));

    const { default: postComment } = await import('./post-comment.js');
    const result = await postComment({ pr: 42, body: 'Comms round complete.' }, undefined, exec);

    const commentCall = calls.find((c) => c.cmd === 'gh' && c.args[1] === 'comment');
    expect(commentCall).toBeDefined();
    expect(commentCall!.args).toContain('42');
    expect(commentCall!.args).toContain('--body');
    expect(commentCall!.args).toContain('Comms round complete.');
    expect(result.body).toBe('Comms round complete.');
  });

  it('includes --repo when provided', async () => {
    const { exec, calls } = makeFakeExec(() => ({ stdout: '', stderr: '', code: 0 }));

    const { default: postComment } = await import('./post-comment.js');
    await postComment({ pr: 9, body: 'Hello', repo: 'owner/repo' }, undefined, exec);

    const commentCall = calls.find((c) => c.cmd === 'gh' && c.args[1] === 'comment');
    expect(commentCall!.args).toContain('--repo');
    expect(commentCall!.args).toContain('owner/repo');
  });
});
```

- [ ] **Step 2: Run tests to confirm they FAIL (module not yet created)**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run examples/mission/lib/comms.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|pass|fail|Error" | head -20
```
Expected: post-comment tests fail (module not found).

- [ ] **Step 3: Create `examples/mission/lib/post-comment.ts`**

```typescript
import { postComment } from './gh-comments.js';
import type { Exec } from './exec.js';

export interface PostCommentInput {
  repo?: string;
  pr: number;
  body: string;
}

export interface PostCommentOutput {
  body: string;
}

export default async function postCommentDefault(
  input: PostCommentInput,
  ctx?: unknown,
  exec?: Exec,
): Promise<PostCommentOutput> {
  return postComment(input, ctx, exec);
}
```

- [ ] **Step 4: Run the new tests — both pass**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run examples/mission/lib/comms.test.ts --reporter=verbose
```
Expected: All comms tests pass including the 2 new post-comment tests.

- [ ] **Step 5: Add `headRefName` to fetchComments dry-run output and update comms.yaml**

In `examples/mission/lib/gh-comments.ts`, update the dry-run return in `fetchComments` to include `headRefName`:

Change:
```typescript
    return {
      merged: false,
      ci_passing: true,
      comments: [],
      reviewThreads: [],
      reviews: [],
    };
```
to:
```typescript
    return {
      merged: false,
      ci_passing: true,
      comments: [],
      reviewThreads: [],
      reviews: [],
      headRefName: '',
    };
```

- [ ] **Step 6: Update comms.yaml — fix `notify` to use post-comment, fix `push` to use real branch**

In `examples/mission/comms.yaml`:

Change the `notify` step's `uses:` from:
```yaml
        uses: ./lib/gh-comments.ts
```
to:
```yaml
        uses: ./lib/post-comment.ts
```

Change the `push` step's `branch:` from:
```yaml
          branch: "${{ inputs.pr }}"
```
to:
```yaml
          branch: "${{ steps.fetch.output.headRefName }}"
```

Also add `needs: [fetch]` to the `push` step so it has access to `steps.fetch.output`:
```yaml
      - id: push
        needs: [fetch]
        uses: ./lib/git-push.ts
```

- [ ] **Step 7: Run full suite to confirm nothing regressed**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run --reporter=verbose 2>&1 | tail -10
```
Expected: All tests pass.

---

### Task 6: FIX 6 — Repair foreach key composite to avoid collision

**Files:**
- Modify: `examples/mission/mission.yaml`

**Interfaces:**
- No interface changes — purely YAML content change.
- Produces: Review repair foreach uses `key: "${{ finding.file + '::' + finding.summary }}"` instead of bare summary.

- [ ] **Step 1: Update the repair foreach key**

In `examples/mission/mission.yaml`, locate the `repair` step under Review phase. Change:
```yaml
            key: "${{ finding.summary }}"
```
to:
```yaml
            key: "${{ finding.file + '::' + finding.summary }}"
```

- [ ] **Step 2: Run dry-run tests to confirm no regression**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run examples/mission/mission.dryrun.test.ts --reporter=verbose
```
Expected: All tests pass.

---

### Task 7: FIX 7 — Add FAIL-first dry-run variant test

**Files:**
- Modify: `examples/mission/mission.dryrun.test.ts`

**Interfaces:**
- Consumes: `MissionFakeProvider` pattern from existing test, `FAKE_PLAN` with one task
- Produces: A new test `'FAIL-first retry: astronaut called twice when controller fails first'` that asserts:
  1. The astronaut for `task-one` was called TWICE (retry happened after FAIL)
  2. The review ran the repair fan-out (scout returns one bucket, inspector returns one finding with confidence 80 on round 1, repair's controller PASSes → round 2's filter returns empty → loop exits)

**Key design:** The `MissionFakeRetryProvider` uses call counters to return `FAIL` on the FIRST controller call for a task and `PASS` on the second. The Scout returns one non-empty bucket; the Inspector returns one finding with confidence >50; the repair's Controller PASSes. Round 2: Scout returns empty buckets → filter sees no actionable → loop exits.

- [ ] **Step 1: Add the FAIL-first provider and test to mission.dryrun.test.ts**

Add the following at the end of `examples/mission/mission.dryrun.test.ts`, inside the `describe` block OR as a new `describe` block:

```typescript
// ---------------------------------------------------------------------------
// FAIL-first scenario: proves retry loop and review repair fan-out work
// ---------------------------------------------------------------------------

describe('mission.yaml FAIL-first dry-run', () => {
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

  it('astronaut called twice when controller fails first, review repair runs then exits', async () => {
    let controllerCallCount = 0;
    let scoutCallCount = 0;

    // Scout returns 1 bucket on round 1 (triggering inspect/repair), empty on round 2
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

    // Inspector returns one finding with confidence 80
    const FAKE_INSPECTOR_ONE_FINDING = {
      findings: [
        {
          file: 'src/thing.ts',
          severity: 'major' as const,
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
          // First controller call → FAIL (forces astronaut retry)
          if (controllerCallCount === 1) {
            return {
              structured: {
                task_name: 'task-one',
                verdict: 'FAIL' as const,
                fixes_needed: ['Add missing null check'],
              },
            };
          }
          // All subsequent controller calls → PASS
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
          // Round 1: return one bucket; round 2: return empty (loop exits)
          return { structured: scoutCallCount === 1 ? FAKE_SCOUT_ONE_BUCKET : FAKE_SCOUT_EMPTY };
        }

        if (sys.startsWith('You are the Systems Inspector') || sys.startsWith('You are the Inspector')) {
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
    });

    // CRITICAL 1 locked: retry loop fired → astronaut called twice for task-one
    // (once for initial attempt, once after FAIL)
    expect(provider.astronautCallCount).toBeGreaterThanOrEqual(2);

    // Review repair ran: scout called at least twice (round 1 with finding, round 2 empty)
    expect(scoutCallCount).toBeGreaterThanOrEqual(2);

    // Controller was called at least 3 times: once (FAIL) + once (PASS for retry) + at least once for repair
    expect(controllerCallCount).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the new FAIL-first test to confirm it passes**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run examples/mission/mission.dryrun.test.ts --reporter=verbose
```
Expected: All tests pass including the new FAIL-first test.

---

### Task 8: Final integration — run full suite, build, lint, commit

**Files:**
- No new file changes. Verification and commit only.

**Interfaces:**
- Produces: Clean commit on `feat/mission-port` with specified message.

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/chris/GitHub/plyflow && npx vitest run --reporter=verbose 2>&1 | tail -15
```
Expected: All tests pass. Count should be 218 + new tests.

- [ ] **Step 2: Run build**

```bash
cd /home/chris/GitHub/plyflow && npm run build 2>&1 | tail -20
```
Expected: Clean build, no errors.

- [ ] **Step 3: Run lint**

```bash
cd /home/chris/GitHub/plyflow && npm run lint 2>&1 | tail -20
```
Expected: No lint errors.

- [ ] **Step 4: Commit all changes**

```bash
cd /home/chris/GitHub/plyflow && git add -p
# Stage all changed files:
# - examples/mission/mission.yaml
# - examples/mission/comms.yaml
# - examples/mission/lib/gh-comments.ts
# - examples/mission/lib/post-comment.ts (new)
# - examples/mission/lib/comms.test.ts
# - examples/mission/mission.dryrun.test.ts
# - src/core/format-schema.ts
# - src/core/format-schema.test.ts
```

```bash
cd /home/chris/GitHub/plyflow && git add \
  examples/mission/mission.yaml \
  examples/mission/comms.yaml \
  examples/mission/lib/gh-comments.ts \
  examples/mission/lib/post-comment.ts \
  examples/mission/lib/comms.test.ts \
  examples/mission/mission.dryrun.test.ts \
  src/core/format-schema.ts \
  src/core/format-schema.test.ts

git commit -m "fix(mission): wrap conditionals, thread fixes_needed, real branch, comms wiring; reject bare if/until

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 5: Write the report**

Write the fix report to `/home/chris/GitHub/plyflow/.git/sdd/p2-fix-report.md` with:
- Per-fix summary of changes + test result
- FAIL-first dry-run proof that retry works
- Full suite count and pass/fail
- Build and lint status
- Commit hash

---

## Self-Review

**Spec coverage check:**
- FIX 1 (bare if/until) → Task 1 ✓
- FIX 2 (schema validation) → Task 2 ✓
- FIX 3 (fixes_needed threading) → Task 3 ✓
- FIX 4 (real branch in Docking) → Task 4 ✓
- FIX 5 (comms notify + push branch) → Task 5 ✓
- FIX 6 (foreach key composite) → Task 6 ✓
- FIX 7 (FAIL-first dry-run test) → Task 7 ✓
- Final commit + report → Task 8 ✓

**Type consistency check:**
- `headRefName: string` added to dry-run return in gh-comments.ts matches `steps.fetch.output.headRefName` reference in comms.yaml ✓
- `fixes_needed` is `string[]` in ControllerVerdict schema; `steps.verify.output.fixes_needed` used in prompt renders as string (JS implicit conversion) ✓
- `post-comment.ts` default export signature matches what comms.yaml `uses:` expects ✓

**Placeholder check:**
- No TBD, TODO, or placeholder code in the plan ✓
- All code blocks are complete ✓
