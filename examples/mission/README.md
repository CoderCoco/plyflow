# Mission Workflow

A production-ready multi-agent software-delivery pipeline built on **plyflow**.
Given a GitHub issue number, it autonomously plans, implements, reviews, and
opens a pull request — using a crew of specialised AI agents at each phase.

## Quick start

```sh
# Run against a real issue (requires ANTHROPIC_API_KEY and `gh auth login`)
plyflow run examples/mission/mission.yaml \
  --input issue=123 \
  --input repo=owner/repo-name

# Optional: override per-role models
plyflow run examples/mission/mission.yaml \
  --input issue=123 \
  --input repo=owner/repo-name \
  --input models=director=claude-opus-4-5,inspector=claude-opus-4-5
```

Inputs:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `issue` | number | yes | — | GitHub issue number to implement |
| `repo` | string | no | inferred by `gh` | `owner/repo` (e.g. `acme/api`) |
| `models` | string | no | see table below | `role=model,...` overrides |

Default model per role (when `fable` is unavailable, falls back to `opus`/`sonnet`):

| Role | Default |
|------|---------|
| `director` | `fable` → `opus` |
| `astronaut` | `sonnet` |
| `controller` | `sonnet` |
| `inspector` | `fable` → `sonnet` |
| `utility` | `haiku` |

## Five phases

### 1. Setup

Runs three helpers in dependency order:

- **models** (`resolve-models.ts`) — parse the `models` input string into a
  per-role map; apply fable-unavailable fallbacks.
- **issue** (`gh-issue.ts`) — fetch title + body from GitHub.
- **worktree** (`git-worktree.ts`) — create (or reuse) a git worktree at
  `.claude/worktrees/issue-<N>-<slug>` on branch `claude/issue-<N>-<slug>`.

All later phases access these outputs via inherited step references
(`${{ steps.issue.output.title }}`, etc.) — no `needs:` required since phases
run sequentially.

### 2. Plan

- **plan** (Flight Director agent) — reads the issue, scouts the repo, and
  produces a `Plan` (see `schemas/Plan.ts`): a list of atomic tasks with
  dependency declarations, acceptance criteria, and a suggested branch name.
- **ready** (confirm input) — pauses for human approval before liftoff.
  In non-TTY / CI contexts supply a `prompt` handler that auto-approves.

### 3. Build

A `foreach` over `plan.output.tasks` (respecting `depends_on` as a DAG,
concurrency 5).  For each task:

- **attempt** (loop, max 3 iterations, until `verify.output.verdict == 'PASS'`):
  - **implement** (Astronaut agent) — makes the code change; returns
    `AstronautReport`.
  - **verify** (Flight Controller agent, read-only) — runs tests/linting,
    returns `ControllerVerdict` (`PASS` or `FAIL` with `fixes_needed`).
- **commit** (`git-commit.ts`, if `attempt.output.verify.verdict == 'PASS'`) —
  stages all changes and commits with a conventional message.

### 4. Review

A `loop` (max 3 rounds, until `filter.output.actionable.length == 0`).
Each round:

- **scout** (Scout agent, read-only) — scans the diff, identifies language
  buckets with changed files, returns `ScoutResult`.
- **inspect** (`foreach` over `scout.output.buckets`) — one Systems Inspector
  agent per bucket; returns `InspectorFindings` (a list of findings with file,
  severity, confidence, and suggestion).
- **flatten** (`flatten-findings.ts`) — concatenates all bucket findings.
- **filter** (`findings-filter.ts`) — deduplicates, drops out-of-scope files,
  splits by confidence threshold.
- **repair** (`foreach` over `filter.output.actionable`, only if non-empty) —
  one Astronaut + Flight Controller per finding, followed by a commit on PASS.

When `actionable` is empty the loop exits immediately (one round minimum).

### 5. Docking

- **push** (`git-push.ts`) — push the branch to origin.
- **pr** (`gh-pr.ts`) — create (or reuse) a GitHub pull request; returns
  `PrResult` (`pr_number`, `pr_url`).

## Agent contracts / schemas

| Agent | Schema | Key fields |
|-------|--------|------------|
| Flight Director | `Plan` | `issue_title`, `branch`, `tasks[]`, `open_questions[]` |
| Astronaut | `AstronautReport` | `task_name`, `status`, `files_modified`, `summary` |
| Flight Controller | `ControllerVerdict` | `task_name`, `verdict` (`PASS`/`FAIL`), `fixes_needed[]` |
| Scout | `ScoutResult` | `buckets[]`, `changed_files[]`, `specialists[]` |
| Systems Inspector | `InspectorFindings` | `findings[]` (file, severity, confidence, summary, suggestion) |

All schemas live under `schemas/` and are loaded by the engine at runtime for
structured-output extraction + Zod validation.

## Authoring rules (critical)

### R1 — `needs:` is same-scope only

`needs:` declares scheduling dependencies within the **current phase or loop
scope**.  Cross-phase step outputs (e.g. `steps.worktree.output.worktree_path`
inside the Build phase) are available automatically via `inheritedSteps` —
listing them in `needs:` will cause a scheduler error.

### R2 — loop `until` references child step outputs

Inside a `loop`, the `until` expression sees the **last iteration's child
outputs** as `steps.<childId>.output` (not `steps.<loopId>.iteration.output`).
For example: `until: "steps.verify.output.verdict == 'PASS'"` — NOT
`steps.attempt.output.verify.verdict`.

The **consumer** of a loop's output uses `steps.<loopId>.output.<childId>…`
(the loop returns its last iteration's outputs map).  For example, after the
`attempt` loop: `steps.attempt.output.verify.verdict`.

### R3 — read-only agents declare `allowedTools`

Agents that must not write files (Flight Controller, Scout, Systems Inspector)
pass `allowedTools: ["Read", "Grep", "Glob", "Bash"]` in their `params:`.
Astronaut uses the full tool set (omit `allowedTools`).

## Comms workflow (`comms.yaml`)

After the PR is open, run the comms workflow to handle review comments:

```sh
plyflow run examples/mission/comms.yaml \
  --input pr=<pr-number> \
  --input repo=owner/repo-name \
  --input since=<ISO-timestamp>
```

The comms workflow fetches new comments, triages them with Capcom, applies
fixes, posts replies, and re-requests review.

## CI dry-run vs. live end-to-end

`mission.dryrun.test.ts` runs automatically in CI:

- Sets `MISSION_DRYRUN=1` — all `git`/`gh` helpers return canned outputs
  without spawning subprocesses.
- Uses `MissionFakeProvider` — dispatches scripted structured outputs to each
  agent call based on the agent's system-prompt opening line.
- Validates the full foreach/loop/agent wiring end-to-end (output paths,
  scheduling, `until`/`if` expressions).

The **live end-to-end** test (real GitHub + Claude) is run **manually** against
a throwaway issue.  It requires `ANTHROPIC_API_KEY` and `gh auth login` and is
NOT run in CI.
