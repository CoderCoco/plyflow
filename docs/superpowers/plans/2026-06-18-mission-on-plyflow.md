# Mission on plyflow — Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`. Work in the MAIN tree on branch `feat/mission-port` — do NOT create worktrees.

**Goal:** Author the `mission` workflow (GitHub issue → plan → build → review → PR → comms) as a plyflow workflow on top of the v0.2 primitives (Plan 1, complete).

**Architecture:** Declarative `mission.yaml` (+ repeatable `comms.yaml`) composing `foreach`/`loop`/`if`/`agent` (agent-sdk) steps, with Zod schemas for agent I/O, `uses:` TS helpers for git/gh, and ported agent prompts.

**Tech Stack:** plyflow v0.2 (this repo), `gh` CLI, `git`, `@anthropic-ai/claude-agent-sdk`, Zod v4, Vitest.

## Global Constraints

- Node 20 ESM; `.js` imports; strict; co-located `*.test.ts`; TDD.
- Mission assets live under `examples/mission/` (eslint ignores `examples/**`, so helper `.ts` there are not linted — still keep them clean; their TESTS live under `examples/mission/lib/*.test.ts` and ARE run by vitest, so write them in strict TS).
- **R1 (load-bearing):** every dynamic `foreach`/`loop` whose `foreach`/`until` references `steps.X` MUST list `needs: [X]`.
- **R2:** `loop.until` reads child step outputs as `steps.<childId>.output` (not `steps.<loopId>...`).
- **R3:** read-only agents (Flight Controller, Systems Inspector, scout, CAPCOM, Flight Director) pass `params: { allowedTools: [Read, Grep, Glob, Bash], permissionMode: 'plan' or default }`; Astronaut passes full tools. (Confirm exact provider param names against `src/providers/claude.ts` `completeAgentSdk`.)
- `gh`/`git` calls in helpers go through an INJECTED `exec` function (default `node:child_process` `execFile`) so tests fake them — no network/process in tests.
- Conventional Commits.

## File structure (all new, under examples/mission/)

```
examples/mission/
  schemas/{Plan,AstronautReport,ControllerVerdict,InspectorFindings,CapcomTriage,FetchResult,PrResult}.ts
  lib/{exec,gh-issue,git-worktree,git-commit,git-push,gh-pr,gh-comments,findings-filter,resolve-models}.ts (+ *.test.ts)
  agents/{flight-director,astronaut,flight-controller,systems-inspector,capcom,docking,scout}.md
  reference/{review-rubric.md,crew-roster.md}
  mission.yaml
  comms.yaml
  README.md
```

---

## Task 1: Zod schemas for agent I/O

**Files:** `examples/mission/schemas/*.ts` (one per schema) + `examples/mission/schemas/schemas.test.ts`.

**Interfaces (each file `export default` a Zod v4 schema):**
- `Plan`: `{ issue_title: string, branch: string, worktree_path: string, tasks: Array<{ name: string, title: string, files: string[], depends_on: string[], acceptance: string }>, open_questions: string[] }`
- `AstronautReport`: `{ task_name: string, status: 'done'|'plan_problem', files_modified: string[], summary: string, plan_problem_description?: string }`
- `ControllerVerdict`: `{ task_name: string, verdict: 'PASS'|'FAIL', fixes_needed: string[] }`
- `InspectorFindings`: `{ findings: Array<{ file: string, line?: number, severity: 'blocker'|'major'|'minor'|'nit', confidence: number, summary: string, suggestion: string }> }`
- `CapcomTriage`: `{ comments: Array<{ id: string, category: 'actionable'|'question'|'acknowledge'|'ignore'|'ambiguous', fix_hint?: string, reply_draft?: string }> }`
- `FetchResult`: `{ merged: boolean, ci_passing: boolean, all_threads_resolved: boolean, new_comments: unknown[], open_threads: unknown[], viewer_login: string }` (loose where mission's shape is rich)
- `PrResult`: `{ pr_number: number, pr_url: string }`

- [ ] **Step 1: failing test** — `schemas.test.ts` imports each default export, asserts a valid object parses and an invalid one throws (e.g. `Plan` rejects a task missing `acceptance`; `ControllerVerdict` rejects `verdict: 'MAYBE'`). Also assert `z.toJSONSchema(Plan)` has `properties.tasks`.
- [ ] **Step 2: run** `npx vitest run examples/mission/schemas/schemas.test.ts` → FAIL.
- [ ] **Step 3: implement** the 7 schema files.
- [ ] **Step 4: run** → PASS; full suite still green.
- [ ] **Step 5: commit** `feat(mission): add agent I/O zod schemas`.

---

## Task 2: `exec` helper + `gh-issue` + `git-worktree`

**Files:** `examples/mission/lib/exec.ts`, `gh-issue.ts`, `git-worktree.ts` (+ tests).

**Interfaces:**
- `exec.ts`: `export type Exec = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<{ stdout: string; stderr: string; code: number }>` and `export const defaultExec: Exec` (wraps `node:child_process` execFile). Helpers accept an `Exec` (default `defaultExec`) for testability.
- `gh-issue.ts`: `export default async function ghIssue(input: { issue: number; repo?: string }, ctx, exec = defaultExec): Promise<{ number, title, body, repo }>` — runs `gh issue view <n> --json number,title,body --repo <repo>`.
- `git-worktree.ts`: `export default async function gitWorktree(input: { issue: number; slug: string; base?: string }, ctx, exec = defaultExec): Promise<{ branch, worktree_path }>` — creates/verifies branch `claude/issue-<n>-<slug>` + worktree under `.claude/worktrees/` from `origin/<base|main>`; idempotent (reuse if exists).

- [ ] **Step 1: failing tests** — with a fake `Exec` recording calls and returning scripted stdout: `ghIssue` parses the `gh issue view` JSON; `gitWorktree` issues the right `git worktree add`/branch commands and returns the computed branch+path; re-running when the worktree "exists" (fake returns existing) does not recreate.
- [ ] **Step 2–5:** implement, pass, full suite green, commit `feat(mission): add exec, gh-issue, git-worktree helpers`.

> Note: these are default-exported functions matching plyflow's `uses:` contract `default(input, ctx)` — the optional 3rd `exec` arg is for tests only (the workflow calls them with 2 args, using `defaultExec`).

---

## Task 3: `git-commit` + `git-push` + `gh-pr`

**Files:** `examples/mission/lib/git-commit.ts`, `git-push.ts`, `gh-pr.ts` (+ tests).

**Interfaces:**
- `git-commit.ts`: `default(input: { worktree_path, message }, ctx, exec)` → stages all + commits with the given Conventional-Commit message in the worktree; returns `{ committed: boolean, sha?: string }`. Include a `buildTaskCommitMessage(task_name, title, issue)` helper exported for reuse (`feat: <name> — <title>\n\nRefs #<issue>`).
- `git-push.ts`: `default(input: { worktree_path, branch }, ctx, exec)` → `git push -u origin <branch>`.
- `gh-pr.ts`: `default(input: { repo, branch, title, body }, ctx, exec)` → checks for existing PR; if none, `gh pr create`; returns `{ pr_number, pr_url }`. Include `buildPrBody({ summary_bullets, diffstat, test_plan, issue })`.

- [ ] **Step 1: failing tests** (fake exec): commit builds the right message + runs add/commit; push runs the right command; gh-pr creates when none exists and reuses when one exists (fake returns an existing PR url). `buildTaskCommitMessage`/`buildPrBody` produce expected strings.
- [ ] **Step 2–5:** implement, pass, suite green, commit `feat(mission): add git-commit, git-push, gh-pr helpers`.

---

## Task 4: `gh-comments` + `findings-filter` + `resolve-models`

**Files:** `examples/mission/lib/gh-comments.ts`, `findings-filter.ts`, `resolve-models.ts` (+ tests).

**Interfaces:**
- `gh-comments.ts`: `fetchComments(input: { repo, pr, since? }, ctx, exec)` → PR status + comments since `since`; `resolveThread`, `postComment`, `reRequestReview` helpers. Loose shapes; the agentic CAPCOM consumes them. (Pure-ish wrappers over `gh api`/`gh pr` — tested with fake exec.)
- `findings-filter.ts`: `default(input: { findings: Finding[], changed_files: string[], confidence_threshold?: number }, ctx)` → `{ actionable: Finding[], deferred: Finding[] }` — dedupe by `file+summary`, split by confidence (>threshold default 50 actionable), and CASCADE GUARD drop findings whose `file` is not in `changed_files`. Pure function — no exec.
- `resolve-models.ts`: `default(input: { overrides?: Record<string,string>, fableAvailable?: boolean }, ctx)` → `{ director, astronaut, controller, inspector, capcom, docking, utility }` applying defaults (`director=fable, astronaut=sonnet, controller=sonnet, inspector=fable, capcom=sonnet, docking=sonnet, utility=haiku`), then overrides, then fable→(director=opus, inspector=sonnet) fallback when `!fableAvailable`. Pure function.

- [ ] **Step 1: failing tests** — `findings-filter` dedupes, thresholds, and drops out-of-diff findings; `resolve-models` applies defaults+overrides+fallback; `gh-comments` fetch/resolve/post issue the right `gh` calls (fake exec).
- [ ] **Step 2–5:** implement, pass, suite green, commit `feat(mission): add gh-comments, findings-filter, resolve-models helpers`.

---

## Task 5: Agent prompt files

**Files:** `examples/mission/agents/{flight-director,astronaut,flight-controller,systems-inspector,capcom,docking,scout}.md`.

Port each agent's system prompt from mission 0.11.0 (`/home/chris/.claude/plugins/cache/codercoco-custom-plugin-marketplace/mission/0.11.0/agents/`), adapting: frontmatter `model` (placeholder, overridden per-step), `provider: claude`, `mode: agent-sdk`; body = the system prompt. Each prompt must instruct the agent to FINISH by producing the structured result matching its schema (the agent-sdk provider supplies the schema). For read-only agents, the prompt states they must not edit files.

- [ ] **Step 1:** write the 7 `.md` files (frontmatter + ported/adapted body). No test (prose), but:
- [ ] **Step 2:** add a `examples/mission/agents/agents.test.ts` that `loadAgent`s each file and asserts frontmatter parses (model/provider/mode present) and body is non-empty.
- [ ] **Step 3:** run → PASS; suite green.
- [ ] **Step 4:** commit `feat(mission): add ported agent prompt files`.

---

## Task 6: Reference data + `mission.yaml` Setup + Plan phases

**Files:** `examples/mission/reference/{review-rubric.md,crew-roster.md}`, `examples/mission/mission.yaml` (Setup + Plan phases only for this task), `examples/mission/mission.test.ts`.

**mission.yaml (Setup + Plan):**
```yaml
name: mission
inputs:
  issue: { type: number, required: true }
  repo: { type: string, required: false }
  models: { type: string, required: false }   # "role=value,..." parsed by resolve-models
phases:
  - name: Setup
    steps:
      - id: models
        uses: ./lib/resolve-models.ts
        with: { overrides: "${{ inputs.models }}", fableAvailable: true }
      - id: issue
        uses: ./lib/gh-issue.ts
        with: { issue: "${{ inputs.issue }}", repo: "${{ inputs.repo }}" }
      - id: worktree
        needs: [issue]
        uses: ./lib/git-worktree.ts
        with: { issue: "${{ inputs.issue }}", slug: "${{ steps.issue.output.title }}" }
  - name: Plan
    steps:
      - id: plan
        needs: [issue, worktree, models]
        agent: ./agents/flight-director.md
        model: "${{ steps.models.output.director }}"
        params: { cwd: "${{ steps.worktree.output.worktree_path }}", allowedTools: ["Read","Grep","Glob","Bash"] }
        prompt: "Issue #${{ inputs.issue }}: ${{ steps.issue.output.title }}\n\n${{ steps.issue.output.body }}\n\nProduce the plan."
        output: ./schemas/Plan.ts
      # (open_questions loop + ready gate: see note)
```

> NOTE on open_questions + ready gate: model the open_questions re-plan loop as a `loop` (max ~3) around the director step whose `until` is `${{ steps.plan.output.open_questions.length == 0 }}`, with a `foreach` over `${{ steps.plan.output.open_questions }}` of `input` steps to gather answers fed back into the next prompt. The "ready for liftoff?" gate is an `input` confirm. Keep this task to a WORKING Setup+Plan (single director pass + a confirm gate); add the question-loop refinement only if it parses+dry-runs cleanly with FakeProvider.

- [ ] **Step 1: failing test** — `mission.test.ts` loads `mission.yaml` via `loadWorkflow` and asserts it parses, has phases `Setup`/`Plan`, and the `plan` step references the schema + model override. (Validation-level; no execution yet.)
- [ ] **Step 2–5:** write reference files + the Setup/Plan YAML, pass, suite green, commit `feat(mission): add reference data and Setup/Plan phases`.

---

## Task 7: `mission.yaml` Build phase

**Files:** extend `mission.yaml` with the Build phase; extend `mission.test.ts`.

**Build phase (foreach tasks + per-task retry loop):**
```yaml
  - name: Build
    steps:
      - id: build
        needs: [plan, worktree, models]
        foreach: "${{ steps.plan.output.tasks }}"
        as: task
        key: "${{ task.name }}"
        dependsOn: "${{ task.depends_on }}"
        concurrency: 5
        steps:
          - id: attempt
            loop: { maxIterations: 3, until: "${{ steps.verify.output.verdict == 'PASS' }}" }
            steps:
              - id: implement
                agent: ./agents/astronaut.md
                model: "${{ steps.models.output.astronaut }}"
                params: { cwd: "${{ steps.worktree.output.worktree_path }}" }
                prompt: "Task ${{ task.name }}: ${{ task.title }}\nFiles: ${{ task.files }}\nAcceptance: ${{ task.acceptance }}\nIteration ${{ iteration }}."
                output: ./schemas/AstronautReport.ts
              - id: verify
                needs: [implement]
                agent: ./agents/flight-controller.md
                model: "${{ steps.models.output.controller }}"
                params: { cwd: "${{ steps.worktree.output.worktree_path }}", allowedTools: ["Read","Grep","Glob","Bash"] }
                prompt: "Verify task ${{ task.name }} (acceptance: ${{ task.acceptance }}). Crew report: ${{ steps.implement.output.summary }}."
                output: ./schemas/ControllerVerdict.ts
          - id: commit
            needs: [attempt]
            if: "${{ steps.attempt.output.verify.output.verdict == 'PASS' }}"
            uses: ./lib/git-commit.ts
            with: { worktree_path: "${{ steps.worktree.output.worktree_path }}", message: "feat: ${{ task.name }} — ${{ task.title }}\n\nRefs #${{ inputs.issue }}" }
```
(Confirm the exact nested-output access path — e.g. `steps.attempt.output.verify.output.verdict` — against how `loop`/`foreach` shape outputs; adjust to the real shape. The retry feedback of `fixes_needed` into the next iteration's astronaut prompt: reference `${{ steps.verify.output.fixes_needed }}` in the implement prompt guarded by iteration>0, or include it unconditionally since it's empty on PASS.)

- [ ] **Step 1: failing test** — extend `mission.test.ts`: the workflow still parses with the Build phase; assert the `build` foreach references `steps.plan.output.tasks`, declares `needs: [plan,...]` (R1), and the inner retry loop's `until` reads `steps.verify.output.verdict` (R2).
- [ ] **Step 2–5:** add the Build YAML, pass, suite green, commit `feat(mission): add Build phase (foreach tasks + retry loop)`.

---

## Task 8: `mission.yaml` Review phase

**Files:** extend `mission.yaml` (Review phase); extend `mission.test.ts`.

**Review phase (rounds loop → scout → foreach buckets → filter → foreach findings):**
```yaml
  - name: Review
    steps:
      - id: review
        needs: [build, worktree, models]
        loop: { maxIterations: 3, until: "${{ steps.filter.output.actionable.length == 0 }}" }
        steps:
          - id: scout
            agent: ./agents/scout.md
            model: "${{ steps.models.output.utility }}"
            params: { cwd: "...", allowedTools: ["Read","Grep","Glob","Bash"] }
            output: ./schemas/... (a buckets list schema; or reuse a small inline)
          - id: inspect
            needs: [scout]
            foreach: "${{ steps.scout.output.buckets }}"
            as: bucket
            key: "${{ bucket }}"
            steps:
              - id: review-bucket
                agent: ./agents/systems-inspector.md
                model: "${{ steps.models.output.inspector }}"
                params: { cwd: "...", allowedTools: ["Read","Grep","Glob","Bash"] }
                output: ./schemas/InspectorFindings.ts
          - id: filter
            needs: [inspect, scout]
            uses: ./lib/findings-filter.ts
            with: { findings: "${{ ... flattened inspect findings ... }}", changed_files: "${{ steps.scout.output.changed_files }}" }
          - id: repair
            needs: [filter]
            if: "${{ steps.filter.output.actionable.length > 0 }}"
            foreach: "${{ steps.filter.output.actionable }}"
            as: finding
            key: "${{ finding.summary }}"
            concurrency: 5
            steps:
              - id: fix  (astronaut, full tools)
              - id: verify-fix  (controller, read-only)  needs: [fix]
              - id: commit-fix  needs: [verify-fix]  if: "PASS"  uses: ./lib/git-commit.ts
```
Flattening inspect's per-bucket findings into one array for `filter` likely needs a small `uses:` step (or a `run:` inline) that reads `${{ steps.inspect.output }}` (a map of bucket→{review-bucket: {output: {findings}}}) and concatenates. Add a `lib/flatten-findings.ts` helper if cleaner. The exhausted-rounds user gate (try-more/skip/stop) is an `input` select AFTER the loop (or the loop simply caps at maxIterations and a following `input` reports). Keep it parse-valid and dry-runnable.

- [ ] **Step 1: failing test** — workflow parses with Review; assert the rounds `loop` until reads `steps.filter.output.actionable`, the `inspect` foreach + `repair` foreach declare `needs` (R1), and read-only agents carry `allowedTools` (R3).
- [ ] **Step 2–5:** add Review YAML (+ flatten helper if needed, with a test), pass, suite green, commit `feat(mission): add Review phase (rounds + bucket/finding fan-out)`.

---

## Task 9: `mission.yaml` Docking phase + `comms.yaml`

**Files:** extend `mission.yaml` (Docking); new `examples/mission/comms.yaml`; extend tests.

**Docking:** `docking` agent (or a pure `gh-pr` helper sequence) — push, build PR body, `gh pr create`, output `PrResult`.

**comms.yaml (repeatable single-pass):** inputs `pr`, `repo`; phases Fetch (gh-comments) → Triage (CAPCOM agent → CapcomTriage) → `if actionable` Fix (foreach actionable: astronaut→controller→commit) → Downlink (push, resolve threads, post replies via gh-comments helpers).

- [ ] **Step 1: failing test** — `mission.yaml` parses with Docking (PrResult schema referenced); `comms.yaml` parses with its phases; the Fix foreach declares `needs` and reads `steps.triage.output...` actionable comments.
- [ ] **Step 2–5:** add Docking + comms.yaml, pass, suite green, commit `feat(mission): add Docking phase and comms workflow`.

---

## Task 10: Mission dry-run integration + README

**Files:** `examples/mission/mission.dryrun.test.ts`; `examples/mission/README.md`.

**Dry-run:** with a `FakeProvider` scripted to return valid `Plan`/`AstronautReport`/`ControllerVerdict`/`InspectorFindings` structured outputs and faked `uses:` helpers (or helpers whose `exec` is faked via env/DI), run `runWorkflow('mission.yaml', { provider: fake, prompt: autoApprove })` against a tiny synthetic issue and assert: the Build foreach fans out one astronaut+controller per task, the Review loop runs, and the run completes producing a PrResult-shaped output. This is the end-to-end shape check (no real GitHub/Claude). Use the journal to also assert resume replays.

> The dry-run requires the `uses:` helpers to not actually call git/gh. Approach: gate the helpers on an env var (e.g. `MISSION_DRYRUN=1` → return canned values) OR provide a fake-exec via a workflow input the helpers read from `ctx.env`. Pick one and document it. The goal is a CI-safe end-to-end shape test.

**README:** document `plyflow run examples/mission/mission.yaml --input issue=123 [--input repo=owner/name] [--input models=director=opus,...]`, the phase flow, the agent contracts, the authoring rules (R1/R2/R3), and `comms.yaml` usage. Note the opt-in LIVE e2e (against a throwaway issue) is run manually, not in CI.

- [ ] **Step 1: failing test** — the dry-run test.
- [ ] **Step 2–5:** implement the dry-run plumbing + README, pass, FULL suite + build + lint green, commit `test(mission): end-to-end dry-run + docs`.

---

## Self-Review

- **Coverage:** schemas (T1), helpers (T2–T4), agents (T5), reference+Setup/Plan (T6), Build (T7), Review (T8), Docking+comms (T9), dry-run+README (T10). All spec Part-2 items covered.
- **Ordering:** schemas → helpers → agents → reference → YAML phases incrementally (each parse-validated) → dry-run capstone.
- **Authoring rules** R1/R2/R3 are enforced per-phase and re-asserted in the parse tests.
- **Risk:** the exact nested-output access paths (`steps.<foreachId>.output[key].<subId>.output`, `steps.<loopId>.output...`) must be confirmed against the real primitive output shapes during T7/T8 — the parse tests + dry-run are the gate. The agent-sdk LIVE behavior is validated only by the opt-in manual e2e.
