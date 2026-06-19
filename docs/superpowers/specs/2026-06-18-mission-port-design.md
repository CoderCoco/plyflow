# Mission Port — Design Spec

**Date:** 2026-06-18
**Status:** Approved (design); feeds two implementation plans
**Repo:** plyflow (this repo)

## Summary

Recreate the `mission` multi-agent workflow (GitHub issue → plan → build → review → PR → comment-handling) as a **plyflow workflow**. mission is fundamentally *dynamic* — it fans out one agent per plan-task, per language-bucket, per finding, per comment, with counts unknown until runtime — while plyflow v0.1 has a *static* DAG fixed at authoring time. Closing that gap requires new plyflow control-flow primitives, after which mission can be authored declaratively.

This is delivered as **two sequential implementation plans**, each producing working, testable software:

1. **plyflow v0.2 — control-flow primitives** (this enables any dynamic workflow, ships independently).
2. **mission on plyflow** (agents, schemas, git/gh helpers, workflow YAML; depends on Plan 1).

Scope is the **full, faithful mission**: all five phases including Comms, full dependency-wave scheduling, real agentic execution, per-run git worktrees, and per-role model overrides.

## Goals

- Add the five primitives plyflow needs for dynamic multi-agent orchestration: `foreach` (dynamic fan-out with dependency waves), `loop` (bounded repeat-until), `if` (conditional steps), `agent-sdk` agentic mode, and expression-resolved model overrides — plus nested journaling so resume works mid-fan-out.
- Author mission as a plyflow workflow that mirrors the original's five phases (Plan, Build, Review, PR/Docking, Comms), agent contracts, retry/round caps, and resume.
- Keep every unit small and single-purpose: one step type per file, one helper per file, one schema per file, one agent per file.

## Non-Goals

- Replacing plyflow's existing v0.1 step types or engine semantics (we extend, not rewrite).
- A general-purpose sandboxing model for agent-sdk tool use — local workflows remain TRUSTED, consistent with v0.1.
- GitHub App / non-`gh`-CLI integrations — mission uses the `gh` CLI, and so will this.
- Perfectly reproducing mission's internal constants where a simpler equivalent is faithful enough; caps and thresholds are matched, but incidental implementation details may differ.

## Global Constraints

- Node >= 20; ESM (`"type": "module"`); TypeScript strict; intra-project imports use the `.js` extension.
- TDD throughout; co-located `*.test.ts`; Vitest.
- Zod v4 native `z.toJSONSchema`.
- Expressions use `${{ }}` resolved against `{ inputs, steps, env }`, extended with `item` (inside `foreach`) and `iteration` (inside `loop`).
- Local workflows and agent tool use are TRUSTED (no sandboxing).
- `gh` CLI is the GitHub interface; `git` for VCS; agent-sdk uses `@anthropic-ai/claude-agent-sdk`.
- Conventional Commits for every commit.

---

## Part 1 — plyflow v0.2 primitives

### 1.0 Engine refactor (backbone)

v0.1's `engine.ts` runs `phases → waves → steps` with the per-step logic inline in `runWorkflow`. Extract a reusable recursive executor:

```ts
async function runSteps(
  steps: StepDef[],
  scope: ExecScope,
): Promise<Record<string, unknown>>   // returns outputs keyed by step id
```

`ExecScope` carries the shared run state (provider, registry, journal, baseDir, emit, prompt handler, and the current expression context contributions — `inputs`, accumulated `steps` outputs, and optional `item`/`iteration` bindings). The top-level phase loop, each `foreach` element's sub-pipeline, and each `loop` iteration all call `runSteps`. This makes composite steps (`foreach`, `loop`) implementable as step types that recurse via the scope, rather than special cases bolted onto the phase loop.

Composite step types receive the scope so they can invoke `runSteps` on their children. To avoid a hard dependency cycle (registry → step type → engine), the scope exposes a `runChildren(steps, extraContext, journalSubScope)` callback the composite steps call.

### 1.1 `foreach` — dynamic fan-out with dependency waves

```yaml
- id: build
  foreach: ${{ steps.plan.output.tasks }}   # array expression, evaluated at runtime
  as: item                                    # binding name (default: item)
  key: ${{ item.name }}                        # element identity (dedup, dep refs, output key)
  dependsOn: ${{ item.depends_on }}            # array of other element keys
  concurrency: 5                               # max elements running at once (default: unlimited)
  steps:                                       # sub-pipeline run once per element
    - id: implement
      agent: ./agents/astronaut.md
      prompt: "${{ item.title }} ..."
    - id: verify
      needs: [implement]
      agent: ./agents/flight-controller.md
```

Semantics:
- Evaluate the array expression. For each element, expose `${{ item }}` (or the `as` name) in the child expression context, alongside the parent `inputs`/`steps`.
- Build a DAG over elements using `key` + `dependsOn` (referencing other elements' `key` values), topo-sort into waves (reusing the v0.1 `planPhase` wave/cycle logic generalized to arbitrary nodes). Unknown `dependsOn` target or a cycle throws.
- Run each wave's elements concurrently, capped by `concurrency`; within an element, run its `steps` sub-pipeline via `runChildren` (sub-steps may use `needs`).
- Collect outputs into a map keyed by `key`: `steps.build.output[key]` is that element's `{ stepId: output }` map (or its last step's output — **decision: the element's full sub-step output map**, so `steps.build.output['Apollo'].verify.verdict` is reachable).
- Journaled per element + sub-step (see 1.5).

### 1.2 `loop` — bounded repeat-until

```yaml
- id: review-rounds
  loop:
    maxIterations: 3
    until: ${{ steps['review-rounds'].iteration.output.status == 'clean' }}
  steps:
    - id: inspect ...
    - id: maybe-repair ...
```

Semantics:
- Run the `steps` sub-pipeline up to `maxIterations` times. Expose `${{ iteration }}` (0-based index) in the child context.
- After each iteration, evaluate `until`; if truthy, stop. `until` reads the just-completed iteration's outputs (exposed as the loop step's current output, and via `iteration.output`).
- The `loop` step's final `output` is the last iteration's sub-step output map.
- Journaled per iteration + sub-step.

### 1.3 `if` — conditional step

Any `StepDef` may carry `if: ${{ expr }}`. Before running, the engine resolves `if`; if falsy, it emits a `step-skipped` event, records the step's output as `null`, and treats the step as completed for `needs` purposes (a skipped step does not block dependents). Applies uniformly to every step type, including composite ones.

### 1.4 `agent-sdk` agentic mode

Implement the currently-stubbed `agent-sdk` mode in the Claude provider using `@anthropic-ai/claude-agent-sdk`'s `query()`:
- Runs an agentic loop with tools (Read/Edit/Write/Bash/Grep/Glob), `cwd` set to the run's working directory (the worktree), `model` and `system` (the agent body) from the request, and a max-turns bound.
- **Structured output:** when `outputSchema` is set, register a forced `submit` tool whose `input_schema` is the Zod→JSON schema; the agent calls `submit` to finish, and the provider validates and returns its input as `structured`. Without a schema, return the final assistant text.
- The client/`query` function is dependency-injected (constructor option) so tests use a fake that scripts tool turns and the final `submit`/text — no network.
- Returns `{ text?, structured?, usage }`, same `AIResult` shape as the other modes.

### 1.5 Nested journaling & resume

Extend the journal so entries are keyed by a **composite path** rather than a flat step id: `phase/<phase> · foreach/<key> · <stepId>` and `loop/<iter> · <stepId>`. The change-hash continues to cover resolved config + inputs + source (v0.1 behavior), now scoped to the path. On resume, a completed element/iteration sub-step with a matching hash replays; the dirty-cascade extends across nesting (a re-run parent element forces its sub-steps to re-run). This makes Build and Review resumable mid-fan-out.

### 1.6 Model & mode overrides

The `agent` step gains optional `model:` and `mode:` fields (expression-resolved) that override the agent file's frontmatter when present. Combined with workflow `inputs`, this expresses mission's `--models role=value` and the fable→opus/sonnet fallback (a small resolution step computes the effective per-role models from inputs + availability and feeds them via `${{ }}`).

---

## Part 2 — mission on plyflow

### 2.1 Phase map

| mission phase | plyflow construction |
|---|---|
| **Setup** | `uses:` helper: create/verify branch `claude/issue-<N>-<slug>` + git worktree from `origin/main`. |
| **Plan** | `agent` (Flight Director, `agent-sdk`) → `Plan` schema (tasks[]). A `loop` re-dispatches while `open_questions` non-empty, gathering answers via a `foreach` of `input` steps; an `input` "ready for liftoff?" gate. Plan output is the resumable state. |
| **Build** | `foreach` over `${{ steps.plan.output.tasks }}`, `dependsOn: ${{ item.depends_on }}`, `concurrency: 5`. Per element: `loop` (until `verdict == 'PASS'`, max 3) wrapping Astronaut → Flight Controller, feeding prior `fixes_needed` into the next attempt's prompt; commit on PASS via a `uses:` git helper. `plan_problem` aborts with state saved. |
| **Review** | `loop` (until `status == 'clean'`, max `max_rounds`): scout `agent` → `foreach` language buckets (Inspectors) → `run` step dedupes/filters by confidence (>50% actionable) and applies the cascade guard (drop findings outside changed files) → `if actionable>0` → `foreach` findings (repair Astronaut → Controller → commit). Exhausted → `input` (try-more / skip / stop). |
| **Docking** | Docking `agent` + `gh-pr` helper: push, build PR body (Summary / Changes / Test plan / `Closes #N`), `gh pr create`. |
| **Comms** (separate `comms.yaml`, repeatable single-pass) | fetch helper (PR + comments since `last_seen_at`) → CAPCOM triage `agent` → `if actionable` → `foreach` fixes (Astronaut → Controller → commit) → downlink helpers (push, resolve threads, post summary + replies, re-request review). |

### 2.2 Agents (`.md`, ported from mission, adapted for agent-sdk + structured output)

flight-director, astronaut, flight-controller, systems-inspector, capcom, docking, scout. Each: frontmatter (`model`, `provider: claude`, `mode: agent-sdk`, params) + body = system prompt. Director/scout are planning/analysis; astronaut/controller/inspector are agentic (edit/run); capcom/docking are structured-output.

### 2.3 Schemas (Zod `.ts`, one per file)

`Plan` (issue_title, branch, worktree_path, tasks[]{name, title, files[], depends_on[], acceptance}, open_questions[]), `AstronautReport` (task_name, status, files_modified[], summary, plan_problem_description?), `ControllerVerdict` (task_name, verdict, fixes_needed[]), `InspectorFindings` (findings[]{file, line?, severity, confidence, summary, suggestion}), `CapcomTriage` (comments[]{id, category, fix_hint?, reply_draft?}), `FetchResult` (PR/comment metadata), `PrResult` (pr_number, pr_url).

### 2.4 Helper modules (`uses:` `.ts`, one per file)

`gh-issue` (fetch issue), `git-worktree` (branch+worktree setup), `git-commit`, `git-push`, `gh-pr` (create/reuse PR), `gh-comments` (fetch/resolve threads, post comments, re-request review), `findings-filter` (dedupe + confidence filter + cascade guard), `resolve-models` (per-role model resolution + fable fallback). Conventional-commit message construction lives with `git-commit`.

### 2.5 Reference data

`review-rubric.md` and the 52-name crew roster, ported as files the Director and Inspector agents read.

### 2.6 Caps & thresholds (matched to mission)

Task attempt cap 3; verifier retry 3; review rounds default 3; tasks-per-batch 5 (the `foreach` concurrency cap); findings confidence threshold 50%; roster 52.

---

## Testing strategy

- **Primitives:** each TDD'd in isolation with the `FakeProvider` — `foreach` wave ordering + concurrency + output keying + cycle/unknown-dep errors; `loop` until/cap + iteration binding; `if` skip + needs-satisfaction; nested journal replay + dirty-cascade resume. `agent-sdk` mode with a fake `query` that scripts tool turns + a forced `submit`.
- **Mission assets:** schema round-trips; each helper module unit-tested against a faked `gh`/`git` (inject the exec function); each phase dry-run with `FakeProvider` asserting the right fan-out shape; the full `mission.yaml` and `comms.yaml` parse + validate. One guarded, opt-in live end-to-end against a throwaway issue (not in CI).
- CI continues to run lint + build + test on Node 20/22, plus the built-binary smoke test.

## File structure (additions)

```
src/steps/foreach.ts          # foreach step type
src/steps/loop.ts             # loop step type
src/core/conditional.ts       # if-evaluation helper used by the engine
src/core/exec.ts              # runSteps recursive executor (extracted from engine.ts)
src/providers/claude-agent.ts # agent-sdk mode (or extend claude.ts)
# Plan 2:
examples/mission/agents/*.md
examples/mission/schemas/*.ts
examples/mission/lib/*.ts      # gh/git helpers
examples/mission/mission.yaml
examples/mission/comms.yaml
examples/mission/reference/{review-rubric.md,crew-roster.md}
```

## Future work

- Streaming agent-sdk tool activity into the TUI progress tree (per-agent live status).
- A `workflows/` discovery picker (deferred from v0.1).
- MCP tools on agents.
- Parallelizing across multiple issues.
