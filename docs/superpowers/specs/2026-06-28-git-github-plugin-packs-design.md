# `@plyflow/git` + `@plyflow/github` Plugin Packs — Design (Spec B)

**Date:** 2026-06-28
**Status:** Approved (design); implementation plan pending
**Depends on:** Spec A — `2026-06-28-monorepo-and-core-features-design.md`
(specifically A1 shell primitive, A4 dry-run, A5 plugin-by-specifier)

## Summary

Two first-party plugin packs that turn plyflow into "batteries-included" for code
automation. They package the generic git and GitHub operations that
`examples/mission/` currently hand-rolls (~700 LoC across `lib/git-*.ts` and
`lib/gh-*.ts`) as reusable, typed custom step types any plyflow workflow can use:

```yaml
plugins:
  - '@plyflow/git'
  - '@plyflow/github'

# ...
- id: worktree
  step: git.worktree
  with: { issue: ${{ inputs.issue }}, slug: ${{ steps.plan.output.slug }} }
- id: pr
  step: github.pr
  with: { title: ${{ ... }}, body: ${{ ... }}, head: ${{ steps.worktree.output.branch }} }
```

Both packs are published under the `@plyflow` scope from the monorepo's
`plugins/` directory and register their steps through the existing `step:` plugin
mechanism.

## Motivation

Spec A's shell step lets a workflow shell out to `git`/`gh` directly in YAML, but
raw `sh:` for every git/GitHub operation is verbose and untyped (manual JSON
parsing, manual branch-name derivation, repeated create-or-reuse logic). These
packs give those operations **typed inputs, validated structured outputs, and
built-in dry-run** — reusable by anyone building CI/PR/code-review automation, not
just mission. They are the "marketable batteries" half of the broader effort.

## Goals

- Ship `@plyflow/git` and `@plyflow/github` as independent scoped packages.
- Cover the operations mission needs today (worktree, commit, push, diff; issue,
  pr, comments, review) with typed steps + Zod output schemas.
- Honor the engine `--dry-run` (Spec A4) by delegating to core's injectable shell
  primitive — no real git/gh calls in dry-run or tests.
- Be referenced by bare package specifier (Spec A5), with zero per-workflow glue.
- Let `examples/mission/` delete its `git-*`/`gh-*` modules and use these instead.

## Non-Goals (this spec)

- octokit / GitHub REST SDK integration — both packs wrap the `gh` CLI to start
  (zero auth config; dogfoods the `sh` step). octokit stays a future option.
- Hosting providers other than GitHub (no GitLab/Bitbucket pack here).
- Generic VCS abstraction beyond git.
- Re-implementing mission *policy* (confidence thresholds, triage categories) —
  that stays in the example as domain logic.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Distribution | Two packages under `plugins/` | Independent versioning; users install only what they need |
| Step registration | Existing `step:` plugin mechanism | No new extension API; `step: git.commit` etc. |
| Reference style | Bare specifier in `plugins:` (Spec A5) | `'@plyflow/git'` — no relative paths |
| GitHub access | **`gh` CLI** wrapped via core's shell primitive | Zero auth config; matches mission; dry-run for free |
| Output typing | Each step ships a Zod schema; returns validated object | Same contract as `agent` structured output |
| Dry-run | Delegate to core injectable `exec` (Spec A1/A4) | Honors `--dry-run`; tests use `mockExec` |
| Naming | Namespaced step ids `git.*` / `github.*` | Avoids collisions; reads clearly in YAML |

## Architecture

Each pack exports a plugin **register function** (the existing
`(registry) => void` form) that registers its step types. A step type provides
`{ name, match, parse, run }`; `run` builds and invokes a `gh`/`git` command
through the **same injectable `exec` primitive the `sh` step uses** (imported from
`@plyflow/core`), so dry-run and test mocking work uniformly.

```text
plugins/
  git/     → @plyflow/git
    src/
      index.ts        register(): registers git.* steps
      worktree.ts     git.worktree
      commit.ts       git.commit
      push.ts         git.push
      diff.ts         git.diff
      schemas/        Zod output schemas
  github/  → @plyflow/github
    src/
      index.ts        register(): registers github.* steps
      issue.ts        github.issue
      pr.ts           github.pr
      comments.ts     github.comments
      review.ts       github.review
      schemas/        Zod output schemas
```

### `@plyflow/git` steps

| Step | Inputs (`with:`) | Output |
|---|---|---|
| `git.worktree` | `issue`, `slug`, `base?` | `{ path, branch, created }` — create or reuse a worktree; derive branch name from issue+slug |
| `git.commit` | `path`, `message` | `{ committed, sha? }` — stage all, commit; detect clean tree (no-op → `committed: false`) |
| `git.push` | `path`, `branch?`, `setUpstream?` | `{ pushed, ref }` |
| `git.diff` | `path`, `base?` | `{ files: string[], patch? }` — changed files / patch for review phases |

### `@plyflow/github` steps

| Step | Inputs (`with:`) | Output |
|---|---|---|
| `github.issue` | `number` | `{ number, title, body }` |
| `github.pr` | `title`, `body`, `head`, `base?` | `{ number, url, created }` — create-or-reuse (returns existing if one is open for `head`) |
| `github.comments` | `pr` | `{ comments: [...], ci?: {...} }` — PR review comments + CI status |
| `github.review` | `pr`, one of `{ comment \| reRequest \| resolveThread }` | action-specific result |

All commands run via `gh ... --json ...` and parse structured output; non-zero
exit throws (or respects `continueOnError`), matching the `sh` step.

## Mission migration (validation)

The packs are validated by porting `examples/mission/` onto them:

- Delete `lib/git-worktree.ts`, `git-commit.ts`, `git-push.ts`, `gh-issue.ts`,
  `gh-pr.ts`, `gh-comments.ts`, `post-comment.ts`, and the now-unneeded
  `lib/exec.ts` (replaced by Spec A1).
- Replace their `uses:` steps with `step: git.*` / `step: github.*`.
- The mission dry-run test (Spec A4) runs unchanged in spirit, now using
  `@plyflow/testing`'s `mockExec` to script `gh`/`git` output.

This both proves the packs and shrinks the example to mostly YAML + agent
personas + policy.

## Testing strategy

- TDD per step: `parse` (config extraction) + `run` (command construction and
  output parsing) unit tests, with `mockExec` asserting the exact command built
  and feeding canned stdout.
- A dry-run test per pack confirming no real command executes under `--dry-run`.
- An integration test registering each pack into a minimal workflow and asserting
  structured outputs validate against the Zod schemas.
- Reuse `@plyflow/testing` for all mocking — no live git repo or `gh` auth in tests.

## Risks & open questions

- **`gh` availability/version** — packs assume the `gh` CLI is installed and
  authenticated at runtime; document this as a requirement and fail with a clear
  message if `gh` is missing. (octokit could later remove this dependency.)
- **Create-or-reuse races** (`github.pr`, `git.worktree`) — encode the existing
  mission semantics (reuse if present) and test both branches.
- **Schema drift with `gh --json` fields** — pin the requested `--json` fields
  explicitly per step so output shape is stable across `gh` versions.
