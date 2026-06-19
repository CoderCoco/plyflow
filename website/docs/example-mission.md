---
sidebar_position: 11
---

# Example: The Mission Workflow

The **mission workflow** (`examples/mission/mission.yaml`) is a production-ready multi-agent software-delivery pipeline. Given a GitHub issue number, it autonomously:

1. **Plans** the work using a Flight Director agent
2. **Builds** each task using an Astronaut + Flight Controller verify loop
3. **Reviews** the diff using specialist inspectors
4. **Opens a pull request** on GitHub

It showcases nearly every plyflow feature: `foreach`, `loop`, `if`, structured output, per-step model overrides, `agent-sdk` mode, resume, and complex cross-phase output access.

## Quick start

```bash
# Requires ANTHROPIC_API_KEY and `gh auth login`
plyflow run examples/mission/mission.yaml \
  --input issue=123 \
  --input repo=owner/repo-name

# Override per-role models
plyflow run examples/mission/mission.yaml \
  --input issue=123 \
  --input repo=owner/repo-name \
  --input models=director=claude-opus-4-5,inspector=claude-opus-4-5
```

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `issue` | number | yes | GitHub issue number |
| `repo` | string | no | `owner/repo` (inferred from `gh` if omitted) |
| `models` | string | no | `role=model,...` overrides |

## Phase 1: Setup

Three steps run in dependency order:

```yaml
phases:
  - name: Setup
    steps:
      - id: models
        uses: ./lib/resolve-models.ts
        with:
          overrides: "${{ inputs.models }}"
          fableAvailable: true

      - id: issue
        uses: ./lib/gh-issue.ts
        with:
          issue: "${{ inputs.issue }}"
          repo: "${{ inputs.repo }}"

      - id: worktree
        needs: [issue]
        uses: ./lib/git-worktree.ts
        with:
          issue: "${{ inputs.issue }}"
          slug: "${{ steps.issue.output.title }}"
```

- **models** — parses the `models` input string into a per-role map; applies fallbacks.
- **issue** — fetches title and body from GitHub.
- **worktree** — creates (or reuses) a git worktree at `.claude/worktrees/issue-<N>-<slug>` on branch `claude/issue-<N>-<slug>`.

All later phases access these outputs via inherited step references (`${{ steps.worktree.output.worktree_path }}`) without `needs:`, because phases run sequentially.

## Phase 2: Plan

```yaml
  - name: Plan
    steps:
      - id: plan
        agent: ./agents/flight-director.md
        model: "${{ steps.models.output.director }}"
        params:
          cwd: "${{ steps.worktree.output.worktree_path }}"
          allowedTools: ["Read", "Grep", "Glob", "Bash"]
        prompt: |
          Issue #${{ inputs.issue }}: ${{ steps.issue.output.title }}

          ${{ steps.issue.output.body }}

          Produce the flight plan.
        output: ./schemas/Plan.ts

      - id: ready
        needs: [plan]
        input:
          type: confirm
          message: "Flight plan ready: ${{ steps.plan.output.tasks.length }} tasks. Proceed to liftoff?"
```

The Flight Director agent reads the issue, scouts the repo (using Read/Grep/Glob/Bash tools via `agent-sdk`), and returns a structured `Plan`:

```typescript
// schemas/Plan.ts
z.object({
  issue_title: z.string(),
  branch: z.string(),
  tasks: z.array(z.object({
    name: z.string(),
    title: z.string(),
    files: z.array(z.string()),
    acceptance: z.string(),
    depends_on: z.array(z.string()),
  })),
  open_questions: z.array(z.string()),
})
```

A `confirm` input gate lets the human review the plan before proceeding.

## Phase 3: Build

A `foreach` over `plan.output.tasks` (with `depends_on` as a DAG, concurrency 5). For each task, a `loop` retries up to 3 times:

```yaml
  - name: Build
    steps:
      - id: build
        foreach: "${{ steps.plan.output.tasks }}"
        as: task
        key: "${{ task.name }}"
        dependsOn: "${{ task.depends_on }}"
        concurrency: 5
        steps:
          - id: attempt
            loop:
              maxIterations: 3
              until: "${{ steps.verify.output.verdict == 'PASS' }}"
            steps:
              - id: implement
                agent: ./agents/astronaut.md
                model: "${{ steps.models.output.astronaut }}"
                params:
                  cwd: "${{ steps.worktree.output.worktree_path }}"
                prompt: |
                  Task: ${{ task.name }} — ${{ task.title }}
                  Files: ${{ task.files }}
                  Acceptance: ${{ task.acceptance }}
                  Iteration: ${{ iteration }}
                  Prior feedback: ${{ steps.verify && steps.verify.output ? steps.verify.output.fixes_needed : '' }}
                output: ./schemas/AstronautReport.ts

              - id: verify
                needs: [implement]
                agent: ./agents/flight-controller.md
                model: "${{ steps.models.output.controller }}"
                params:
                  cwd: "${{ steps.worktree.output.worktree_path }}"
                  allowedTools: ["Read", "Grep", "Glob", "Bash"]
                prompt: |
                  Task: ${{ task.name }}
                  Summary: ${{ steps.implement.output.summary }}
                output: ./schemas/ControllerVerdict.ts

          - id: commit
            needs: [attempt]
            if: "${{ steps.attempt.output.verify.verdict == 'PASS' }}"
            uses: ./lib/git-commit.ts
            with:
              worktree_path: "${{ steps.worktree.output.worktree_path }}"
              message: "feat(${{ task.name }}): ${{ task.title }}\n\nRefs #${{ inputs.issue }}"
```

Key patterns here:
- `task` binding comes from `foreach as: task` — available in all child steps.
- `iteration` binding comes from the `loop` — available inside the loop body.
- The `verify.output.fixes_needed` is null-guarded since iteration 0 has no prior verify.
- After the `attempt` loop, `steps.attempt.output.verify.verdict` accesses the last iteration's verify output.
- Flight Controller uses `allowedTools` to prevent writes (read-only agent).

## Phase 4: Review

A `loop` (max 3 rounds) reruns until no actionable findings remain:

```yaml
  - name: Review
    steps:
      - id: review
        loop:
          maxIterations: 3
          until: "${{ steps.filter.output.actionable.length == 0 }}"
        steps:
          - id: scout       # scans diff, identifies language buckets
          - id: inspect     # foreach over buckets — one inspector agent per bucket
            needs: [scout]
            foreach: "${{ steps.scout.output.buckets }}"
            as: bucket
            key: "${{ bucket }}"
            steps:
              - id: review-bucket
                agent: ./agents/systems-inspector.md
                # ...
          - id: flatten     # concatenate all bucket findings
            needs: [inspect]
          - id: filter      # deduplicate, filter to in-scope files
            needs: [flatten, scout]
          - id: repair      # foreach over actionable findings
            needs: [filter]
            if: "${{ steps.filter.output.actionable.length > 0 }}"
            foreach: "${{ steps.filter.output.actionable }}"
            as: finding
            concurrency: 5
            steps:
              - id: fix
              - id: verify-fix
                needs: [fix]
              - id: commit-fix
                needs: [verify-fix]
```

This phase demonstrates nested composites: a `loop` containing a `foreach` containing a `foreach`.

## Phase 5: Docking

```yaml
  - name: Docking
    steps:
      - id: push
        uses: ./lib/git-push.ts
        with:
          worktree_path: "${{ steps.worktree.output.worktree_path }}"
          branch: "${{ steps.worktree.output.branch }}"

      - id: pr
        needs: [push]
        uses: ./lib/gh-pr.ts
        with:
          repo: "${{ inputs.repo }}"
          branch: "${{ steps.worktree.output.branch }}"
          title: "${{ steps.plan.output.issue_title }}"
          body: "Closes #${{ inputs.issue }}"
```

## Agent roles

| Agent | Mode | Tools | Description |
|-------|------|-------|-------------|
| Flight Director | `agent-sdk` | Read, Grep, Glob, Bash | Plans the implementation as a task DAG |
| Astronaut | `agent-sdk` | Full set | Implements code changes |
| Flight Controller | `agent-sdk` | Read, Grep, Glob, Bash (read-only) | Verifies changes, returns PASS/FAIL |
| Scout | `agent-sdk` | Read, Grep, Glob, Bash (read-only) | Scans diff, identifies language buckets |
| Systems Inspector | `agent-sdk` | Read, Grep, Glob, Bash (read-only) | Deep review per language bucket |

## The comms workflow

After the PR is open, use `comms.yaml` to handle review comments in a single pass:

```bash
plyflow run examples/mission/comms.yaml \
  --input pr=<pr-number> \
  --input repo=owner/repo-name \
  --input since=<ISO-timestamp>
```

The comms workflow:
1. **Fetch** — downloads PR comments
2. **Triage** (Capcom agent) — categorises as `ACT`, `REPLY`, or `IGNORE`
3. **Fix** — `foreach` over actionable comments: Astronaut implements, Controller verifies, commits
4. **Downlink** — pushes branch, posts replies, re-requests review

## Authoring rules

### R1: `needs:` is same-scope only

`needs:` only controls ordering within the **current phase or loop scope**. Cross-phase outputs are available automatically — do not list them in `needs:`:

```yaml
# Phase: Build
# steps.worktree is from Phase: Setup — NO needs: required
- id: build
  foreach: "${{ steps.plan.output.tasks }}"
  # steps.worktree.output.worktree_path is available without needs: [worktree]
```

### R2: `loop until:` references child step IDs

```yaml
loop:
  until: "${{ steps.verify.output.verdict == 'PASS' }}"  # 'verify' is a child step
```

After the loop, the consumer uses `steps.<loop_id>.output.<child_id>.<field>`:

```yaml
if: "${{ steps.attempt.output.verify.verdict == 'PASS' }}"
```

### R3: Read-only agents declare `allowedTools`

Agents that must not write files pass restricted `allowedTools`:

```yaml
params:
  allowedTools: ["Read", "Grep", "Glob", "Bash"]
```

The Astronaut (write-capable) omits `allowedTools`.
