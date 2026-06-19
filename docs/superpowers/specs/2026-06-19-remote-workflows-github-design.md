# Remote Workflows from GitHub — Design

**Date:** 2026-06-19
**Status:** Approved (design); implementation plan pending

## Summary

Let users run a plyflow workflow directly from a GitHub repository, the way you
might run a remote script:

```bash
plyflow run github:org/repo/path/to/wf.yaml@v1.2.0
plyflow run https://github.com/org/repo/blob/main/examples/mission/mission.yaml
```

plyflow fetches the workflow **and the sibling files it references** (agents
`.md`, schemas/`uses`/plugins `.ts`, a per-workflow `package.json`), caches them
locally, and then runs the existing engine unchanged against the cached copy.

## Goals

- Run a remote workflow in one step (no separate install command).
- Correctly resolve everything a workflow references (`./agents`, `./schemas`,
  `./steps`, plugins, `package.json` deps), not just the lone YAML.
- Accept both a compact shorthand and a pasted browser URL.
- Cache fetched repos globally and reuse them across runs and projects.
- Support private repos via a token environment variable.
- Guard the obvious footgun — remote workflows execute arbitrary code — with a
  warn-and-confirm gate on first run.

## Non-Goals (this version)

- No separate `plyflow add`/`pull` install command (run-direct only).
- No git clone or GitHub Contents-API fetch path (tarball only).
- No central workflow registry or TUI browser/picker.
- No sources other than GitHub (design leaves room, but only GitHub ships).

## Key Decisions

| Decision | Choice |
|---|---|
| UX model | Run directly from a URL (fetch + execute in one step) |
| What to fetch | The whole containing repo directory tree (bundle), not a single file |
| Reference syntax | Shorthand `github:...@ref` **and** full `https://github.com/...` URLs |
| Fetch mechanism | Repo tarball via `codeload.github.com`, extracted locally |
| Trust/security | Warn + confirm on first run; trust-on-first-use hash pinning thereafter |
| Caching | Global cache under `~/.plyflow/cache/`, reused; `--refresh` to force |
| Private repos | Yes — `GITHUB_TOKEN` / `GH_TOKEN` sent on the request |

## Architecture

### Integration point: a resolver in front of the loader

A new `resolveWorkflowSource(arg, opts)` runs **before** anything else in the run
flow. If `arg` is a remote ref it fetches+caches the repo and returns a **local
filesystem path** into the cache. From that point on the entire existing engine
(`loadWorkflow`, `prepareEnv`, module-loader, steps, journal) runs **unchanged**
against a real local directory. Remote-ness disappears at the boundary.

This keeps the blast radius tiny: engine, exec, steps, and journal are untouched.
Relative references, plugin loading, and `npm install` all "just work" because
the cache directory is an ordinary directory on disk.

Rejected alternative: a virtual/remote filesystem inside the loader and `jiti`
(lazy URL fetches). It touches many code paths, fights `jiti` and `npm install`,
and carries far more risk for no user-visible benefit.

### Module layout: `src/core/remote/`

Three small, independently testable units plus a thin orchestrator.

1. **`ref.ts` — parse & normalize.**
   `parseWorkflowRef(arg)` recognizes:
   - shorthand: `github:org/repo/path/to/wf.yaml@ref`
   - full URL: `https://github.com/org/repo/blob/<ref>/path/to/wf.yaml`
   - anything else → `null` (treated as a local path; current behavior preserved)

   Returns `{ host, owner, repo, ref, subPath }` or `null`. When `ref` is
   omitted it resolves to the repo's default branch.

2. **`fetch.ts` — fetch & extract.**
   `ensureRepo({ owner, repo, ref }, opts)`:
   - Downloads `https://codeload.github.com/<owner>/<repo>/tar.gz/<ref>` via
     Node's built-in `fetch`, sending `Authorization: Bearer <token>` when
     `GITHUB_TOKEN` / `GH_TOKEN` is set (enables private repos).
   - Extracts the **whole repo** into the cache dir using `tar`.
   - Extraction is atomic: write to a temp dir, then `rename` into place, so a
     failed fetch never leaves a corrupt cache entry.
   - Returns the cache dir root.

   Extracting the whole repo — rather than only the subdir — means `../`-style
   sibling references and shared repo files resolve correctly, and multiple
   workflows from the same repo share a single extraction.

3. **`cache.ts` — cache policy.**
   - Cache root: `~/.plyflow/cache/<owner>-<repo>@<ref>/`.
   - Immutable refs (tags, 40-char SHAs) are kept forever.
   - Mutable refs (branches) re-fetch when older than a TTL (≈1h) or on
     `--refresh`.
   - Cache key includes the ref.

A thin `resolveWorkflowSource(arg, opts)` ties them together and returns
`{ localPath, source }` where `localPath = <cacheDir>/<subPath>` and `source`
is `{ remote: boolean, owner, repo, ref, sha } | null`.

## CLI Integration

In `src/cli/index.ts`, before `loadWorkflow`:

```ts
const resolved = await resolveWorkflowSource(args.workflow, { refresh, token });
// resolved.localPath → feeds existing loadWorkflow / runWorkflow unchanged
// resolved.source    → { remote, owner, repo, ref, sha } | null
```

New flags in the hand-rolled `src/cli/args.ts`:

- `--refresh` — force re-fetch even if cached.
- `--yes` / `-y` — skip the trust confirmation (also auto-skipped in non-TTY/CI).

## Trust & Security

Remote workflows execute arbitrary code (`plugins`, `uses`, `run` steps are
TS/JS). After fetch, before execution, and **only when the fetched content is
not already trusted**:

- Compute a content hash of the fetched workflow directory and check it against a
  `~/.plyflow/trust.json` record keyed by `owner/repo` + subPath.
- If new or changed: show the source (`org/repo@ref`, resolved SHA, path) and a
  one-line warning that it runs code, then require confirmation. On approval,
  record the hash so future runs of the same content are silent.
- Changed content (e.g. a branch moved) re-prompts. `--yes` and non-TTY bypass
  the gate with a printed notice.

This yields trust-on-first-use pinning essentially for free on top of the
confirm gate. The prompt reuses the existing TUI input/confirm path (the same
mechanism `input` steps use), with a plain-stdout fallback in line mode.

## Error Handling

The resolver fails loudly and early — before any execution — with actionable
messages, thrown as a typed `RemoteFetchError` so the CLI prints a clean message
(no stack) while keeping detail available for debug output:

- **Malformed ref** (looks remote but unparseable) → explain the two accepted
  forms.
- **404 — repo/ref not found** → distinguish "repo not found or private (set
  `GITHUB_TOKEN`)" from "ref `<x>` not found".
- **401/403** → "authentication failed / rate-limited; set `GITHUB_TOKEN`";
  surface GitHub's rate-limit reset time when present.
- **Network / tarball / extract failure** → clear message; partial cache dir is
  never published (atomic temp→rename).
- **Subpath not in repo** → after extraction, if `<cacheDir>/<subPath>` does not
  exist, report that the file was not found in `org/repo@ref`.
- **Trust declined** → exit cleanly, no run, non-zero exit code.

## Testing

Following the project's existing test style:

- **`ref.ts`** — pure unit tests: shorthand, full URLs, missing ref, non-remote
  passthrough, and edge cases (`@` in paths, nested subdirs, default-branch
  resolution).
- **`fetch.ts` / `cache.ts`** — `fetch` and the filesystem stubbed: correct
  codeload URL + auth header, extraction into the cache, atomic temp→rename, TTL
  re-fetch vs immutable-ref reuse, `--refresh` behavior. No real network.
- **Trust** — new content prompts, trusted content is silent, changed content
  re-prompts, `--yes`/non-TTY bypass.
- **One integration test** — a small fixture tarball served from a local HTTP
  server (or a `fetch` stub returning fixture bytes) → resolve → run an existing
  example end-to-end against the cache dir, proving the "engine runs unchanged"
  claim.

## Dependencies

- Add: `tar` (extraction).
- Everything else uses Node built-ins: `fetch`, `fs`, `os`, `crypto`.

## Open Questions / Future Work

- A separate `plyflow add`/`pull` command to vendor a workflow locally for
  editing.
- Additional sources (GitLab, generic HTTPS tarballs).
- A workflow registry + TUI picker (already noted in the v0.2 roadmap).
- Cache eviction/GC command (`plyflow cache clean`).
