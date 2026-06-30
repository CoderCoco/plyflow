# Mission Migration onto the Plugin Packs + Docs (Spec B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `examples/mission/` onto `@plyflow/git` (B1) and `@plyflow/github` (B2): replace its hand-rolled `lib/git-*` / `lib/gh-*` modules with `step: git.*` / `step: github.*`, delete the now-dead code, keep the dry-run e2e gate green via the engine's `dryRun` mode, and document both packs on the website.

**Architecture:** Both mission workflows (`mission.yaml`, `comms.yaml`) declare the packs in a top-level `plugins:` list and invoke their steps via `step:`. The packs honor the engine's `--dry-run`/`ctx.dryRun`, so the existing `mission.dryrun.test.ts` switches from the ad-hoc `MISSION_DRYRUN=1` environment flag to `runWorkflow(..., { dryRun: true })`. The deleted lib modules' behavior is already covered by the packs' own unit tests (B1/B2), so their mission-side tests are removed. Output field renames (`worktree_path → path`, `pr_number/pr_url → number/url`, input `issue → number`, `branch → head`) are threaded through the YAML and the dry-run test.

**Tech Stack:** plyflow YAML workflows, `@plyflow/core` engine (`runWorkflow`), vitest e2e, Docusaurus docs.

**Depends on:** B1 (`@plyflow/git`) and B2 (`@plyflow/github`) both merged.

## Global Constraints

- **Both packs must be merged and building** before starting. Run `pnpm --filter @plyflow/git build && pnpm --filter @plyflow/github build` first.
- **The mission dry-run e2e is the gate:** `pnpm exec vitest run --config vitest.examples.config.ts examples/mission`. It must stay green after every task in this plan.
- **Conventional Commits.**
- **Field renames (apply consistently):**
  | Old (mission lib) | New (pack step) |
  |---|---|
  | `git.worktree` output `worktree_path` | `path` |
  | `git.commit`/`git.push` input `worktree_path` | `path` |
  | `github.issue` input `issue` | `number` |
  | `github.pr` input `branch` | `head` |
  | `github.pr` output `pr_number` / `pr_url` | `number` / `url` |
  | `github.comments` output `ci_passing` | `ci.passing` |
- **Wiring decision (see Task B3.1):** packs are referenced **by bare specifier** (`@plyflow/git`, `@plyflow/github`) — the realistic end-user form and the Spec B goal. This requires the packs built + resolvable from the workflow dir's `node_modules`. The lower-friction in-repo alternative (relative path to `src/index.ts`, no build) is documented inline as a fallback.

---

## File Structure

```
examples/mission/
  package.json          NEW — declares @plyflow/git + @plyflow/github deps so bare specifiers resolve
  mission.yaml          MODIFIED — plugins: + step: git.* / github.*; worktree_path → path
  comms.yaml            MODIFIED — plugins: + step: github.comments / github.review / git.*
  mission.dryrun.test.ts MODIFIED — dryRun:true (drop MISSION_DRYRUN env); pr_number → number
  mission.test.ts       MODIFIED — parse assertions updated for step: keys
  comms.test.ts         MODIFIED — drop tests for deleted gh-* lib fns; keep policy-fn tests
  lib/
    git-worktree.ts      DELETE
    git-commit.ts        DELETE
    git-push.ts          DELETE
    gh-issue.ts          DELETE
    gh-pr.ts             DELETE
    gh-comments.ts       DELETE
    post-comment.ts      DELETE
    exec.ts              DELETE (sole consumers were the deleted modules)
    vcs.test.ts          DELETE (git lib tests; covered by @plyflow/git)
    resolve-models.ts    KEEP (mission policy)
    actionable-comments.ts KEEP (mission policy)
    findings-filter.ts   KEEP
    flatten-findings.ts  KEEP (+ flatten-findings.test.ts)
pnpm-workspace.yaml      MODIFIED — add 'examples/*' so examples/mission deps install
website/
  docs/steps/plugin-packs.md  NEW — @plyflow/git + @plyflow/github reference
  sidebars.ts                 MODIFIED — add the new doc under Step Types
  docs/example-mission.md     MODIFIED — note the packs power the example
```

---

## Task 1: Wire the packs into the workspace and the mission example

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `examples/mission/package.json`

**Interfaces:**
- Produces: `examples/mission/node_modules/@plyflow/git` + `@plyflow/github` symlinks (via pnpm), so the workflow loader resolves `plugins: ['@plyflow/git', '@plyflow/github']` by bare specifier.

- [ ] **Step 1: Build the packs (prerequisite)**

Run: `pnpm --filter @plyflow/git build && pnpm --filter @plyflow/github build`
Expected: each emits `dist/index.js` + `dist/index.d.ts`. (Bare-specifier resolution uses each package's `exports.default → ./dist/index.js`; Node's resolver does not honor the `@plyflow/source` condition, so `dist` must exist.)

- [ ] **Step 2: Add `examples/*` to the workspace**

`pnpm-workspace.yaml` — add the examples glob:
```yaml
packages:
  - 'packages/*'
  - 'plugins/*'
  - 'examples/*'
allowBuilds:
  esbuild: true
```

- [ ] **Step 3: Create the mission example manifest**

`examples/mission/package.json`:
```json
{
  "name": "@plyflow/example-mission",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "plyflow": { "provided": ["zod"] },
  "dependencies": {
    "@plyflow/git": "workspace:*",
    "@plyflow/github": "workspace:*"
  },
  "devDependencies": {
    "@plyflow/core": "workspace:*",
    "@plyflow/testing": "workspace:*"
  }
}
```

> **Alternative wiring (fallback, no build / no workspace change):** skip Steps 1–3 and instead reference the packs by relative path in the `plugins:` lists below — `plugins: ['../../plugins/git/src/index.ts', '../../plugins/github/src/index.ts']`. jiti loads the TS source directly; the packs' only runtime import from `@plyflow/core` (`defaultShellExec`) is never invoked under dry-run. Choose this if coupling the example e2e to pack builds is undesirable. The bare-specifier form remains the one shown in the docs (Task B3.5).

- [ ] **Step 4: Install so the workspace links the packs into the example**

Run: `pnpm install`
Expected: `examples/mission/node_modules/@plyflow/{git,github}` symlinks created; lockfile updated.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml examples/mission/package.json pnpm-lock.yaml
git commit -m "chore(mission): add example manifest + workspace glob for plugin packs"
```

---

## Task 2: Migrate `mission.yaml` to the pack steps

**Files:**
- Modify: `examples/mission/mission.yaml`

**Interfaces:**
- Consumes: `git.worktree`, `git.commit`, `git.push` (B1); `github.issue`, `github.pr` (B2).

- [ ] **Step 1: Add the top-level `plugins:` declaration**

Insert after the `inputs:` block (before `phases:`):
```yaml
plugins:
  - '@plyflow/git'
  - '@plyflow/github'
```

- [ ] **Step 2: Migrate the Setup `issue` and `worktree` steps**

Replace:
```yaml
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
with:
```yaml
      - id: issue
        step: github.issue
        with:
          number: "${{ inputs.issue }}"
          repo: "${{ inputs.repo }}"

      - id: worktree
        needs: [issue]
        step: git.worktree
        with:
          issue: "${{ inputs.issue }}"
          slug: "${{ steps.issue.output.title }}"
```

- [ ] **Step 3: Rename every `worktree_path` output reference to `path`**

Replace all occurrences of `steps.worktree.output.worktree_path` with `steps.worktree.output.path`. There are 8 occurrences (Plan `cwd`, Build `implement`/`verify` `cwd`, Review `scout`/`review-bucket`/`fix`/`verify-fix` `cwd`, Docking `push`). Verify count:
```bash
grep -c 'steps.worktree.output.worktree_path' examples/mission/mission.yaml   # before: 8
```

- [ ] **Step 4: Migrate the Build `commit` step**

Replace:
```yaml
          - id: commit
            needs: [attempt]
            if: "${{ steps.attempt.output.verify.verdict == 'PASS' }}"
            uses: ./lib/git-commit.ts
            with:
              worktree_path: "${{ steps.worktree.output.worktree_path }}"
              message: "feat(${{ task.name }}): ${{ task.title }}\n\nRefs #${{ inputs.issue }}"
```
with:
```yaml
          - id: commit
            needs: [attempt]
            if: "${{ steps.attempt.output.verify.verdict == 'PASS' }}"
            step: git.commit
            with:
              path: "${{ steps.worktree.output.path }}"
              message: "feat(${{ task.name }}): ${{ task.title }}\n\nRefs #${{ inputs.issue }}"
```

- [ ] **Step 5: Migrate the Review `commit-fix` step**

Replace:
```yaml
              - id: commit-fix
                needs: [verify-fix]
                if: "${{ steps['verify-fix'].output.verdict == 'PASS' }}"
                uses: ./lib/git-commit.ts
                with:
                  worktree_path: "${{ steps.worktree.output.worktree_path }}"
                  message: "fix: ${{ finding.summary }}\n\nRefs #${{ inputs.issue }}"
```
with:
```yaml
              - id: commit-fix
                needs: [verify-fix]
                if: "${{ steps['verify-fix'].output.verdict == 'PASS' }}"
                step: git.commit
                with:
                  path: "${{ steps.worktree.output.path }}"
                  message: "fix: ${{ finding.summary }}\n\nRefs #${{ inputs.issue }}"
```

- [ ] **Step 6: Migrate the Docking `push` and `pr` steps**

Replace:
```yaml
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
          body: "## Summary\n\nImplements #${{ inputs.issue }}: ${{ steps.plan.output.issue_title }}\n\nCloses #${{ inputs.issue }}"
```
with:
```yaml
      - id: push
        step: git.push
        with:
          path: "${{ steps.worktree.output.path }}"
          branch: "${{ steps.worktree.output.branch }}"

      - id: pr
        needs: [push]
        step: github.pr
        with:
          repo: "${{ inputs.repo }}"
          head: "${{ steps.worktree.output.branch }}"
          title: "${{ steps.plan.output.issue_title }}"
          body: "## Summary\n\nImplements #${{ inputs.issue }}: ${{ steps.plan.output.issue_title }}\n\nCloses #${{ inputs.issue }}"
```

- [ ] **Step 7: Verify no stale references remain**

Run:
```bash
grep -n 'worktree_path\|uses: ./lib/gh-\|uses: ./lib/git-' examples/mission/mission.yaml
```
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add examples/mission/mission.yaml
git commit -m "refactor(mission): port mission.yaml onto @plyflow/git + @plyflow/github steps"
```

---

## Task 3: Migrate `comms.yaml` to the pack steps

**Files:**
- Modify: `examples/mission/comms.yaml`

**Interfaces:**
- Consumes: `github.comments`, `github.review` (B2); `git.commit`, `git.push` (B1). Reads `steps.fetch.output.headRefName` (passthrough field on `github.comments` output, see B2.4).

- [ ] **Step 1: Add the top-level `plugins:` declaration**

Insert after the `inputs:` block:
```yaml
plugins:
  - '@plyflow/git'
  - '@plyflow/github'
```

- [ ] **Step 2: Migrate the `fetch` step**

Replace:
```yaml
      - id: fetch
        uses: ./lib/gh-comments.ts
        with:
          repo: "${{ inputs.repo }}"
          pr: "${{ inputs.pr }}"
```
with:
```yaml
      - id: fetch
        step: github.comments
        with:
          repo: "${{ inputs.repo }}"
          pr: "${{ inputs.pr }}"
```
(Downstream `steps.fetch.output.comments` and `steps.fetch.output.headRefName` remain valid — `github.comments` returns `comments` and passes through `headRefName`.)

- [ ] **Step 3: Migrate the Fix `commit` step**

Replace:
```yaml
          - id: commit
            needs: [verify]
            if: "${{ steps.verify.output.verdict == 'PASS' }}"
            uses: ./lib/git-commit.ts
            with:
              worktree_path: "${{ inputs.worktree_path }}"
              message: "fix: address review comment ${{ comment.id }}\n\nRefs PR #${{ inputs.pr }}"
```
with:
```yaml
          - id: commit
            needs: [verify]
            if: "${{ steps.verify.output.verdict == 'PASS' }}"
            step: git.commit
            with:
              path: "${{ inputs.worktree_path }}"
              message: "fix: address review comment ${{ comment.id }}\n\nRefs PR #${{ inputs.pr }}"
```

- [ ] **Step 4: Migrate the Downlink `push` and `notify` steps**

Replace:
```yaml
      - id: push
        needs: [fetch]
        uses: ./lib/git-push.ts
        with:
          worktree_path: "${{ inputs.worktree_path }}"
          branch: "${{ steps.fetch.output.headRefName }}"

      - id: notify
        needs: [push]
        uses: ./lib/post-comment.ts
        with:
          repo: "${{ inputs.repo }}"
          pr: "${{ inputs.pr }}"
          body: "Mission Control: comms round complete. Actionable comments addressed and pushed."
```
with:
```yaml
      - id: push
        needs: [fetch]
        step: git.push
        with:
          path: "${{ inputs.worktree_path }}"
          branch: "${{ steps.fetch.output.headRefName }}"

      - id: notify
        needs: [push]
        step: github.review
        with:
          repo: "${{ inputs.repo }}"
          pr: "${{ inputs.pr }}"
          comment: "Mission Control: comms round complete. Actionable comments addressed and pushed."
```

- [ ] **Step 5: Verify no stale references remain**

Run:
```bash
grep -n 'worktree_path:\|uses: ./lib/gh-\|uses: ./lib/git-\|uses: ./lib/post-comment' examples/mission/comms.yaml
```
Expected: only `path: "${{ inputs.worktree_path }}"` lines remain referencing the *input* (the workflow input is still named `worktree_path`); no `uses: ./lib/(gh|git|post)` matches.

- [ ] **Step 6: Commit**

```bash
git add examples/mission/comms.yaml
git commit -m "refactor(mission): port comms.yaml onto @plyflow/github + @plyflow/git steps"
```

---

## Task 4: Delete dead lib modules + update mission tests; keep the e2e green

**Files:**
- Delete: `examples/mission/lib/{git-worktree,git-commit,git-push,gh-issue,gh-pr,gh-comments,post-comment,exec}.ts`
- Delete: `examples/mission/lib/vcs.test.ts`
- Modify: `examples/mission/mission.dryrun.test.ts`
- Modify: `examples/mission/mission.test.ts`
- Modify: `examples/mission/comms.test.ts`

- [ ] **Step 1: Switch the dry-run e2e from `MISSION_DRYRUN` env to engine `dryRun`**

In `mission.dryrun.test.ts`, the lib helpers no longer read `MISSION_DRYRUN`; the packs honor `ctx.dryRun`. Make these edits:

1. Remove the `process.env.MISSION_DRYRUN` set/restore in **both** `beforeEach`/`afterEach` blocks (the two `describe` suites). Keep the `mkdtemp`/`rm` runDir handling.
2. Add `dryRun: true` to **every** `runWorkflow(missionYamlPath, { ... })` options object (6 call sites).

Example — change each call from:
```ts
const result = await runWorkflow(missionYamlPath, {
  inputs: { issue: 123, repo: 'owner/repo' },
  provider,
  runDir,
  prompt: autoPrompt,
  isTty: true,
});
```
to:
```ts
const result = await runWorkflow(missionYamlPath, {
  inputs: { issue: 123, repo: 'owner/repo' },
  provider,
  runDir,
  prompt: autoPrompt,
  isTty: true,
  dryRun: true,
});
```

- [ ] **Step 2: Update the PR-output assertion for the new field names**

In `mission.dryrun.test.ts`, the `'Docking pr step produces a pr_number in outputs'` test asserts `pr_number`. `github.pr` now outputs `{ number, url, created }`. Replace:
```ts
  it('Docking pr step produces a pr_number in outputs', async () => {
    const provider = new MissionFakeProvider();
    const result = await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider, runDir, prompt: autoPrompt, isTty: true, dryRun: true,
    });
    const prOutput = result.outputs['pr'] as { pr_number: number; pr_url: string } | undefined;
    expect(prOutput).toBeDefined();
    expect(typeof prOutput?.pr_number).toBe('number');
    expect(prOutput?.pr_number).toBe(1);
  });
```
with:
```ts
  it('Docking pr step produces a pr number in outputs', async () => {
    const provider = new MissionFakeProvider();
    const result = await runWorkflow(missionYamlPath, {
      inputs: { issue: 123, repo: 'owner/repo' },
      provider, runDir, prompt: autoPrompt, isTty: true, dryRun: true,
    });
    // github.pr dry-run output: { number, url, created }
    const prOutput = result.outputs['pr'] as { number: number; url: string; created: boolean } | undefined;
    expect(prOutput).toBeDefined();
    expect(typeof prOutput?.number).toBe('number');
    expect(prOutput?.created).toBe(false);
  });
```

- [ ] **Step 3: Run the dry-run e2e and watch it pass against the migrated YAML**

Run: `pnpm exec vitest run --config vitest.examples.config.ts examples/mission/mission.dryrun.test.ts`
Expected: PASS (both suites). This proves the packs' dry-run paths produce output shapes the migrated workflow wires correctly.

> If a step output path fails to resolve, the message names the step id — cross-check against the rename table in Global Constraints.

- [ ] **Step 4: Delete the obsolete lib modules and the git lib test**

Run:
```bash
git rm examples/mission/lib/git-worktree.ts examples/mission/lib/git-commit.ts \
       examples/mission/lib/git-push.ts examples/mission/lib/gh-issue.ts \
       examples/mission/lib/gh-pr.ts examples/mission/lib/gh-comments.ts \
       examples/mission/lib/post-comment.ts examples/mission/lib/exec.ts \
       examples/mission/lib/vcs.test.ts
```

- [ ] **Step 5: Confirm no remaining importers of the deleted modules**

Run:
```bash
grep -rn "lib/git-\|lib/gh-\|lib/post-comment\|lib/exec" examples/mission --include='*.ts' --include='*.yaml'
```
Expected: no matches. (The kept modules — `resolve-models`, `actionable-comments`, `findings-filter`, `flatten-findings` — must not import `./exec.js`; if grep shows one does, that module was using shell exec and its migration was missed — stop and reassess.)

- [ ] **Step 6: Prune `comms.test.ts` and `mission.test.ts` of deleted-module tests**

- In `comms.test.ts`: delete every `import`/`describe`/`it` that exercises `gh-comments.ts` (`fetchComments`, `resolveThread`, `postComment`, `reRequestReview`) or `post-comment.ts`. Keep tests for `actionable-comments.ts` and any other surviving policy module. If the file ends up empty, `git rm` it.
- In `mission.test.ts`: update any parse-time assertion that references a `uses: ./lib/gh-*`/`git-*` path or a `worktree_path`/`pr_number`/`branch`(pr) field to the migrated `step:`/field names. If it only asserts structural facts (phase names, task counts), no change is needed.

- [ ] **Step 7: Run the full mission test set**

Run: `pnpm exec vitest run --config vitest.examples.config.ts examples/mission`
Expected: PASS — dryrun e2e, surviving unit tests, parse tests. Note the net LoC deleted.

- [ ] **Step 8: Commit**

```bash
git add -A examples/mission
git commit -m "refactor(mission): delete hand-rolled git/gh libs; e2e uses engine dry-run"
```

---

## Task 5: Document the plugin packs on the website

**Files:**
- Create: `website/docs/steps/plugin-packs.md`
- Modify: `website/sidebars.ts`
- Modify: `website/docs/example-mission.md`

- [ ] **Step 1: Write the plugin-packs reference doc**

`website/docs/steps/plugin-packs.md`:
````markdown
---
id: plugin-packs
title: First-Party Plugin Packs
sidebar_label: Plugin Packs (git / github)
---

# First-Party Plugin Packs: `@plyflow/git` and `@plyflow/github`

Two installable packs turn plyflow into "batteries-included" for code automation.
They package the common git and GitHub operations as typed, validated step types,
so workflows skip hand-rolled `sh:` plumbing and JSON parsing.

Reference them by bare package specifier in a workflow's `plugins:` list:

```yaml
plugins:
  - '@plyflow/git'
  - '@plyflow/github'
```

Install them alongside your workflow (the specifier resolves from the workflow
directory's `node_modules`):

```bash
npm install @plyflow/git @plyflow/github
```

## Requirements

- **`@plyflow/github` wraps the `gh` CLI.** The [GitHub CLI](https://cli.github.com)
  must be installed and authenticated (`gh auth login`) at runtime. Steps fail
  with `gh`'s stderr on a non-zero exit.
- Both packs run through plyflow's injectable shell primitive, so they honor
  `--dry-run` (no real `git`/`gh` runs) and are fully mockable in tests with
  `@plyflow/testing`'s `mockExec`.

## `@plyflow/git` steps

| Step | Inputs (`with:`) | Output |
|---|---|---|
| `git.worktree` | `issue`, `slug`, `base?` (default `main`) | `{ path, branch, created }` — create or reuse a worktree; branch derived from issue + slug |
| `git.commit` | `path`, `message` | `{ committed, sha? }` — stage all & commit; clean tree → `committed: false` |
| `git.push` | `path`, `branch?`, `setUpstream?` (default `true`) | `{ pushed, ref }` — pushes current branch if `branch` omitted |
| `git.diff` | `path`, `base?` (default `main`) | `{ files, patch }` — changed files + patch vs `origin/<base>...HEAD` |

```yaml
- id: worktree
  step: git.worktree
  with: { issue: '${{ inputs.issue }}', slug: '${{ steps.issue.output.title }}' }
- id: commit
  step: git.commit
  with: { path: '${{ steps.worktree.output.path }}', message: 'feat: do the thing' }
```

## `@plyflow/github` steps

| Step | Inputs (`with:`) | Output |
|---|---|---|
| `github.issue` | `number`, `repo?` | `{ number, title, body }` |
| `github.pr` | `title`, `body`, `head`, `base?` (default `main`), `repo?` | `{ number, url, created }` — reuses the open PR for `head` if present |
| `github.comments` | `pr`, `repo?`, `since?` | `{ comments, ci: { passing }, merged, ... }` — also passes through raw `gh pr view` fields (`headRefName`, etc.) |
| `github.review` | `pr`, `repo?`, exactly one of `comment` \| `reRequest` \| `resolveThread` | action-specific result |

```yaml
- id: pr
  step: github.pr
  with:
    title: '${{ steps.plan.output.issue_title }}'
    body: 'Closes #${{ inputs.issue }}'
    head: '${{ steps.worktree.output.branch }}'
```

## Testing workflows that use the packs

The packs never touch the real network or shell in tests. Inject `mockExec` from
`@plyflow/testing` to script `git`/`gh` output, or run the workflow under
`dryRun: true` to get synthetic outputs with no subprocess at all. See
[Testing](../testing.md).
````

- [ ] **Step 2: Add the doc to the sidebar**

In `website/sidebars.ts`, add `'steps/plugin-packs'` to the `Step Types` category `items` array (after `'steps/plugin-step'`):
```ts
      items: [
        'steps/overview',
        'steps/run-uses',
        'steps/agent',
        'steps/input',
        'steps/parallel',
        'steps/loop',
        'steps/foreach',
        'steps/widget',
        'steps/sh',
        'steps/use',
        'steps/plugin-step',
        'steps/plugin-packs',
      ],
```

- [ ] **Step 3: Cross-link from the mission example doc**

In `website/docs/example-mission.md`, add a short note (near the top, after the intro paragraph) that the example is built on the first-party packs:
```markdown
> The git and GitHub operations in this example are provided by the first-party
> [`@plyflow/git` and `@plyflow/github` packs](./steps/plugin-packs.md) — the
> workflow declares them in `plugins:` and invokes `step: git.*` / `step: github.*`.
```

- [ ] **Step 4: Verify the docs build**

Run: `pnpm --filter website build` (or the repo's docs build command)
Expected: build succeeds; no broken-link warnings for `steps/plugin-packs` or the cross-links.

> If the repo has no `website` build script wired into `pnpm`, run the build from `website/` per its README; the only hard requirement is that the new doc id matches the sidebar entry and the relative links resolve.

- [ ] **Step 5: Commit + changeset**

```bash
git add website/docs/steps/plugin-packs.md website/sidebars.ts website/docs/example-mission.md
git commit -m "docs: document @plyflow/git + @plyflow/github plugin packs"
pnpm changeset   # patch/minor note: mission example migrated; packs documented
git add .changeset
git commit -m "chore: changeset for mission migration + pack docs"
```

---

## Self-Review

- **Spec coverage (Mission migration section of Spec B):** deletes `git-worktree`, `git-commit`, `git-push`, `gh-issue`, `gh-pr`, `gh-comments`, `post-comment`, and `exec` (B3.4 Step 4) ✅; replaces `uses:` with `step: git.*`/`github.*` in both `mission.yaml` (B3.2) and `comms.yaml` (B3.3) ✅; dry-run test runs "unchanged in spirit" now using the engine's `dryRun` rather than the ad-hoc env flag (B3.4 Steps 1–3) ✅. Docs cover both packs incl. the `gh` runtime requirement (B3.5) ✅.
- **Field-rename consistency:** the rename table is applied in B3.2 (`worktree_path → path` ×8, `issue → number`, `branch → head`), B3.3 (same on comms), and B3.4 (`pr_number → number`). `github.comments` passthrough preserves `headRefName` that comms' `push` depends on (verified against `comms.yaml:97`). ✅
- **No placeholders:** every YAML edit shows full before/after; every test edit shows the concrete replacement; deletions are explicit `git rm` commands. ✅
- **Risks:** (1) **Wiring** — bare-specifier resolution needs the packs built + linked (B3.1 Steps 1/4); the relative-path fallback is documented if build-coupling is unwanted. (2) **Surviving lib modules importing `exec.ts`** — guarded by the grep in B3.4 Step 5. (3) **`mission.test.ts` parse assertions** — Step 6 updates any that reference old paths/fields; structural-only assertions need no change. ✅
- **Decision to surface for approval:** bare specifier (recommended, spec-faithful, requires pack build in the example test path) vs. relative-path-to-src (lower friction, no build). Default in this plan = bare specifier.
