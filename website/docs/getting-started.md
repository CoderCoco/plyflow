---
sidebar_position: 2
---

# Getting Started

## Prerequisites

- **Node.js 20+** (ESM project — Node 20 LTS or later)
- **npm** (comes with Node)
- **ANTHROPIC_API_KEY** — required for the default Claude provider in `api` mode

## Install

Clone the repo and build:

```bash
git clone https://github.com/CoderCoco/plyflow.git
cd plyflow
npm install
npm run build
```

This compiles the TypeScript source (`src/`) to JavaScript and makes the `plyflow` CLI available via `npx` or `node dist/cli.js`.

:::tip Running globally
After building, you can link the CLI so `plyflow` works from anywhere:
```bash
npm link
```
:::

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
