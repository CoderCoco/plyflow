# plyflow

Run AI agent workflows defined in YAML, with an interactive terminal UI.

plyflow is "GitHub Actions for AI agents": workflows are DAGs of typed steps,
AI steps call agents defined in Markdown, and runs render a live progress tree
that can pause for input. Unlike a built-in workflow runner, plyflow workflows
can import libraries, run arbitrary TypeScript, prompt the user, and target any
AI provider.

## Install

```bash
npm install
npm run build
```

## Run

```bash
# Requires ANTHROPIC_API_KEY for the default Claude provider (api mode).
plyflow run ./examples/summarize.yaml --input text="Your text here"

# Resume an interrupted run (skips already-completed steps):
plyflow run ./examples/summarize.yaml --input text="..." --resume <runId>
```

## Workflow format

A workflow has `name`, optional `inputs`, and ordered `phases`. Phases run in
order; steps within a phase run in parallel unless constrained by `needs`.
Expressions `${{ inputs.x }}` / `${{ steps.id.output.field }}` interpolate
values. A step has exactly one type key:

- `run` / `uses` — inline JS or an external `.ts` module (libraries importable)
- `agent` — an AI agent (`.md` file); add `output:` for a Zod schema → JSON output
- `input` — pause and ask the user (`confirm` | `text` | `select`)
- `parallel` — explicit fan-out

## Agent format

Markdown with frontmatter (`model`, `provider`, `mode`, `temperature`); the body
is the system prompt.

## Structured output

Point a step's `output:` at a `.ts` file that `export default`s a Zod schema.
plyflow converts it to JSON Schema, forces the model to return matching JSON,
and validates the result before downstream steps consume it.

## Resume

Each run writes a journal under `.plyflow/runs/<runId>.json`. Re-running with
`--resume <runId>` replays unchanged completed steps and re-runs from the first
changed or incomplete step.

## Future work

- `workflows/` auto-discovery + a TUI picker (run with no file argument)
- MCP support on agents
- `widget:` step type (custom `.tsx` components mounted in the TUI)
- Additional providers (OpenAI, etc.) and the Claude `agent-sdk` execution mode
