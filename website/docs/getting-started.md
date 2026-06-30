---
sidebar_position: 2
---

# Getting Started

## Prerequisites

- **Node.js 24+** (ESM project — Node 24 or later)
- **pnpm** — the repo is a pnpm workspace monorepo (`npm install -g pnpm`)
- **ANTHROPIC_API_KEY** — required for the default Claude provider in `api` mode

## Install

A published npm package (`npm install -g plyflow`) is on the way. Until then, clone
the repo and build it from source:

```bash
git clone https://github.com/CoderCoco/plyflow.git
cd plyflow
pnpm install
pnpm -r build
```

This builds every workspace package under `packages/` (the engine, CLI, TUI, and
testing helpers). The `plyflow` CLI lives in the `plyflow` meta-package
(`packages/meta`). To run it from the repo without installing globally:

```bash
pnpm dev -- run <file.yaml> --input k=v
```

:::tip Running globally
To make `plyflow` available from anywhere, link the meta-package after building:
```bash
cd packages/meta && npm link
```
:::

The examples below use a bare `plyflow` command, assuming you've linked it. If you
haven't, substitute `pnpm dev -- run …` from the repo root.

## Your first workflow

Create a file `hello.yaml` in any directory:

```yaml
name: hello
inputs:
  name: { type: string, required: true }

phases:
  - name: Greet
    steps:
      - id: greet
        run: |
          return `Hello, ${ctx.inputs.name}!`;
```

Run it:

```bash
plyflow run ./hello.yaml --input name=World
```

You'll see a live progress tree in the terminal. When the workflow finishes, the step output (`Hello, World!`) is shown.

## An AI workflow

The [`examples/summarize.yaml`](https://github.com/CoderCoco/plyflow/blob/main/examples/summarize.yaml) workflow calls a Claude agent and then asks for confirmation:

```yaml
name: summarize
inputs:
  text: { type: string, required: true }

phases:
  - name: Summarize
    steps:
      - id: summary
        agent: ./agents/summarizer.md
        prompt: "Summarize the following:\n${{ inputs.text }}"
        output: ./schemas/Summary.ts

      - id: confirm
        needs: [summary]
        input:
          type: confirm
          message: "Title is '${{ steps.summary.output.title }}'. Accept?"
```

Set your API key and run:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
plyflow run ./examples/summarize.yaml --input text="Your text here"
```

The `summary` step calls the `summarizer.md` agent, validates the response against the `Summary.ts` Zod schema, and makes the typed output available to the `confirm` step via `${{ steps.summary.output.title }}`.

## Resuming a run

Every run is assigned a unique ID and journaled under `.plyflow/runs/<runId>.json`. If a run is interrupted — network blip, agent timeout, you pressed Ctrl-C — you can resume from the first incomplete step:

```bash
plyflow run ./examples/summarize.yaml \
  --input text="Your text here" \
  --resume abc123def456
```

plyflow replays already-completed steps from the journal and re-runs from the first changed or incomplete step.

## What's next

- **[Workflow Files](./workflow-files.md)** — understand the full YAML schema: inputs, phases, expressions.
- **[Step Types](./steps/overview.md)** — explore every step type with examples.
- **[Agents & Providers](./agents-providers.md)** — write agent Markdown files and configure providers.
- **[Structured Output](./structured-output.md)** — use Zod schemas for typed agent responses.
- **[Example: Mission Workflow](./example-mission.md)** — a full multi-agent software-delivery pipeline.
