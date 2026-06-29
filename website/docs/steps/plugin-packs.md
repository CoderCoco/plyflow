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
