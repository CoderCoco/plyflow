---
sidebar_position: 7
---

# Resume & Journaling

Every plyflow run is journaled to disk. If a run is interrupted — or you want to re-run with changed steps — you can resume from the first incomplete or changed step.

## The journal

Each run is assigned a unique run ID. The journal is written to:

```
.plyflow/runs/<runId>.json
```

The journal records every completed step's output, along with a change hash (a hash of the step definition). The change hash lets plyflow detect when you've modified a step and invalidate its cached result.

## Resuming

When the CLI prints a run ID (shown at the start of every run), note it for later:

```bash
plyflow run ./mission.yaml --input issue=42
# [plyflow] Run ID: abc123def456
```

Resume a run:

```bash
plyflow run ./mission.yaml --input issue=42 --resume abc123def456
```

plyflow loads the journal and for each step:
1. Checks if the step has a journal entry (completed in a prior run).
2. Checks if the step's definition hash matches the stored hash.
3. If both match → **replay**: the cached output is used; the step is not re-executed.
4. If either doesn't match → **re-execute**: the step runs normally, and all downstream steps also re-execute.

## Nested journals

`foreach:` and `loop:` steps write nested journal entries:

```
build/foreach:task-name-1/implement
build/foreach:task-name-1/verify
build/foreach:task-name-2/implement
build/foreach:task-name-2/verify
attempt/loop:0/implement
attempt/loop:0/verify
attempt/loop:1/implement
attempt/loop:1/verify
```

This means resume works correctly even across complex multi-level pipelines. A foreach that processed 80 of 100 tasks can resume from task 81.

:::note Key encoding
`foreach:` element keys that contain `/` are percent-encoded to `%2F` in the journal path to avoid path ambiguity.
:::

## Change hash invalidation

If you edit a step definition (e.g., change the agent prompt, modify the `run:` code, or update a schema), plyflow detects the change via the stored hash and re-executes that step and all steps that depend on it. Steps before the changed step are replayed from cache.

This makes development iteration fast: edit a single step, resume, and only the changed step and its descendants re-run.

## Journal location

By default, journals are written to `.plyflow/runs/` in the current working directory. Add `.plyflow/` to your `.gitignore` to avoid committing run journals:

```gitignore
.plyflow/
```

## Listing runs

The journal directory contains one JSON file per run. You can inspect it directly:

```bash
ls .plyflow/runs/
cat .plyflow/runs/abc123def456.json
```
