---
sidebar_position: 8
---

# Running Workflows from GitHub

plyflow can run a workflow directly from a public or private GitHub repository.
The whole repo is downloaded once and cached locally, so sibling files the
workflow references — agents, schemas, plugins — are always available.

## Reference syntax

There are two ways to refer to a remote workflow:

### `github:` shorthand

```bash
plyflow run github:<owner>/<repo>/<path-to-workflow.yaml>@<ref>
```

`<ref>` is a branch name, tag, or full commit SHA. It is optional — omitting it
uses the repository's default branch.

```bash
# Branch
plyflow run github:myorg/my-workflows/examples/summarize.yaml@main

# Tag
plyflow run github:myorg/my-workflows/examples/summarize.yaml@v1.2.0

# Commit SHA (immutable — cached forever)
plyflow run github:myorg/my-workflows/examples/summarize.yaml@a1b2c3d4e5f6
```

### Full GitHub URL

Paste any GitHub blob URL directly — plyflow parses the owner, repo, ref, and
file path automatically:

```bash
plyflow run https://github.com/myorg/my-workflows/blob/main/examples/summarize.yaml
```

## Whole-repo fetch

plyflow downloads the **entire repository** as a tarball (via the GitHub API)
and unpacks it to the local cache. This means any file the workflow references —
agent Markdown files, Zod schemas, plugin modules, workflow `package.json` — is
available on disk alongside the workflow file. You do not need to list sibling
files separately.

## Caching

The downloaded repo is cached under `~/.plyflow/cache/`. Subsequent runs of the
same workflow at the same ref re-use the cached copy without hitting the network.

Cache behaviour by ref type:

| Ref type | Cache policy |
|----------|-------------|
| Full 40-hex commit SHA | Cached forever (immutable) |
| Branch or tag name | Re-used for 1 hour (TTL), then re-fetched |

To force a fresh download regardless of TTL, pass `--refresh`:

```bash
plyflow run github:myorg/my-workflows/examples/summarize.yaml@main --refresh
```

## Trust prompt

Because remote workflows execute code on your machine, plyflow asks for
confirmation the first time you run a particular remote workflow. Once you
confirm, that workflow runs without prompting again — unless its contents
change, in which case you're asked to confirm the new version.

```
Remote workflow from myorg/my-workflows.
Run it? (yes/no) ›
```

After you confirm, the trust decision is recorded (keyed to the specific
workflow file and a hash of its directory contents) and you won't be asked
again for that workflow unless its content changes.

To skip the prompt:

- Pass `--yes` (or `-y`):

  ```bash
  plyflow run github:myorg/my-workflows/examples/summarize.yaml@main --yes
  ```

- Run in a non-interactive environment (CI, piped stdout) — plyflow detects the
  absence of a TTY and skips the prompt automatically.

In both cases plyflow still **records the workflow as trusted**, so subsequent
runs of the same unchanged workflow won't prompt (or auto-skip) again either.

## Private repositories

Set `GITHUB_TOKEN` or `GH_TOKEN` in your environment and plyflow will
authenticate the tarball download:

```bash
export GITHUB_TOKEN=ghp_...
plyflow run github:myorg/private-workflows/examples/deploy.yaml@main
```

The token is sent as an `Authorization: Bearer` header to the GitHub API
endpoint and is **not** forwarded to any subsequent network requests made by
the workflow itself.
