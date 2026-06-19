---
sidebar_position: 8
---

# CLI Reference

## `plyflow run`

Run a workflow file.

```bash
plyflow run <file> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<file>` | Path to the workflow YAML file, a `github:<owner>/<repo>/<path>@<ref>` shorthand, or a full `https://github.com/…` blob URL |

### Options

| Option | Description |
|--------|-------------|
| `--input <key=value>` | Set a workflow input. Repeat for multiple inputs. |
| `--resume <runId>` | Resume a previous run from the first incomplete or changed step. |
| `--refresh` | Re-fetch a remote workflow, bypassing the local cache. |
| `--yes`, `-y` | Skip the remote-workflow trust prompt. |

### Examples

```bash
# Run with a single input
plyflow run ./examples/summarize.yaml --input text="Hello world"

# Run with multiple inputs
plyflow run ./examples/mission/mission.yaml \
  --input issue=123 \
  --input repo=owner/my-repo

# Pass a multi-word string
plyflow run ./wf.yaml --input message="This is a long message"

# Run and get a run ID for later resuming
plyflow run ./long-workflow.yaml --input topic=AI

# Resume from a previous run
plyflow run ./long-workflow.yaml --input topic=AI --resume abc123def456

# Override per-role models (mission workflow)
plyflow run ./examples/mission/mission.yaml \
  --input issue=42 \
  --input models=director=claude-opus-4-5,inspector=claude-opus-4-5

# Run a workflow directly from GitHub (shorthand)
plyflow run github:org/repo/examples/wf.yaml@v1.0.0

# Run a workflow directly from GitHub (full URL)
plyflow run https://github.com/org/repo/blob/main/examples/wf.yaml

# Re-fetch a cached remote workflow
plyflow run github:org/repo/examples/wf.yaml@main --refresh

# Skip the trust prompt in CI
plyflow run github:org/repo/examples/wf.yaml@main --yes
```

## Input type coercion

Inputs are coerced to the declared type:

| Declared type | Input value | Coerced value |
|---------------|-------------|---------------|
| `string` | `hello` | `"hello"` |
| `number` | `42` | `42` |
| `boolean` | `true` | `true` |
| `boolean` | `false` | `false` |

## TTY vs non-TTY mode

plyflow detects whether stdout is a TTY:

- **TTY (interactive):** The full terminal UI renders with a live progress tree. `input:` steps prompt the user. `widget:` steps render their Ink component.
- **Non-TTY (CI, piped):** Output is written as structured log lines (`LineLogger`). `input:` steps use their `default:` value (or throw if none is set). `widget:` steps use their `default:` value (or throw).

To run in CI or pipe output, simply redirect stdout:

```bash
# Piped — non-TTY mode
plyflow run ./wf.yaml --input text="hello" | tee output.log

# CI — all input: steps must have default: values
plyflow run ./wf.yaml --input issue=42
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Required for the Claude provider in `api` or `agent-sdk` mode |

## Exit codes

| Code | Description |
|------|-------------|
| `0` | Workflow completed successfully |
| `1` | Workflow failed (step error, validation error, etc.) |
