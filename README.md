# plyflow

Run AI agent workflows defined in YAML, with an interactive terminal UI.

plyflow is "GitHub Actions for AI agents": workflows are DAGs of typed steps,
AI steps call agents defined in Markdown, and runs render a live progress tree
that can pause for input. Unlike a built-in workflow runner, plyflow workflows
can import libraries, run arbitrary TypeScript, prompt the user, and target any
AI provider.

## Install

plyflow is a pnpm workspace monorepo and requires **Node ≥24** and **pnpm**
(`npm install -g pnpm`). A published `plyflow` npm package is on the way; for now,
clone and build from source:

```bash
git clone https://github.com/CoderCoco/plyflow.git
cd plyflow
pnpm install      # install workspace dependencies
pnpm -r build     # build every package under packages/
```

Run the CLI from the repo with `pnpm dev -- run <file.yaml>`, or link it globally
with `cd packages/meta && npm link` so the `plyflow` command works anywhere.

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
- `sh` — run a shell command (`json:` parses stdout)
- `input` — pause and ask the user (`confirm` | `text` | `select`)
- `parallel` — explicit fan-out over a fixed list of steps
- `foreach` — dynamic fan-out over a runtime array
- `loop` — repeat steps until a condition (`until:`) or `maxIterations`
- `use` — call another workflow file as a sub-step
- `widget` — mount a custom Ink/React component for interactive input
- `step` — invoke a registered custom step type (plugin)

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

## Running a workflow from GitHub

Run a workflow straight from a GitHub repository — plyflow fetches the repo,
caches it under `~/.plyflow/cache/`, and runs it locally:

```bash
# Shorthand (ref optional — defaults to the repo's default branch)
plyflow run github:org/repo/examples/mission/mission.yaml@v1.0.0

# …or paste a GitHub URL
plyflow run https://github.com/org/repo/blob/main/examples/mission/mission.yaml
```

Sibling files the workflow references (agents, schemas, plugins) are fetched
with it. The first run of a given remote workflow asks for confirmation, since
remote workflows can execute code; pass `--yes` to skip the prompt (also skipped
in non-interactive/CI environments). Use `--refresh` to bypass the cache and
re-fetch.

**Private repos:** set `GITHUB_TOKEN` (or `GH_TOKEN`) and plyflow authenticates
the download.

## Extensibility (v0.3)

### Workflow `package.json` and host-provided modules

A workflow directory can include a `package.json` to declare additional
dependencies. plyflow auto-installs missing deps (`npm ci` if a lockfile is
present, else `npm install`) before running.

Modules already bundled by plyflow (`zod`, `react`, `ink`) are **host-provided**:
they resolve to plyflow's own copies and don't need to be declared. To mark
additional packages as host-provided (so they're never installed), use
`plyflow.provided`:

```json
{
  "plyflow": {
    "provided": ["zod"],
    "plugins": ["./steps/uppercase.ts"]
  }
}
```

### `widget:` step type

Add an interactive custom UI to any workflow with a `widget:` step:

```yaml
- id: picked
  widget: ./Picker.tsx       # path to your React/Ink component
  default: typescript        # returned in non-TTY mode (CI, tests, piped)
  with:
    message: "Which language?"
    choices: [typescript, python, rust]
```

The widget component receives `{ data, resolve }`:

```tsx
// Picker.tsx — react and ink are provided by plyflow; no install needed
import React from 'react';
import { Text, useInput } from 'ink';

export default function Picker({ data, resolve }) {
  useInput((input) => {
    if (input === '\r') resolve(data.choices[0]);
  });
  return <Text>{data.message}</Text>;
}
```

Call `resolve(value)` to return the chosen value. In non-TTY mode (CI, piped
output, tests) the step returns `default:` without rendering the component.
Without `default:`, a non-TTY run throws.

See `examples/widgets/` for a full working example.

### Plugins (`step:` type key)

Register custom step types with `plugins:` in the workflow YAML:

```yaml
plugins:
  - ./steps/uppercase.ts
phases:
  - name: Transform
    steps:
      - id: shout
        step: uppercase
        with:
          text: hello    # => output: 'HELLO'
```

A plugin module default-exports either a **StepType object** or a
**register function**:

```ts
// StepType form — the loader wraps match to (def) => def.step === name
import type { StepType } from 'plyflow/steps/types.js';

const uppercaseStep: StepType<{ text: string }> = {
  name: 'uppercase',
  match: () => false,            // overridden by loader
  parse: (def) => ({ text: String(def.with?.text ?? '') }),
  run: async (cfg) => ({ output: cfg.text.toUpperCase() }),
};
export default uppercaseStep;

// Register-function form
export default function register(registry) {
  registry.register({ name: 'double', match: (d) => d.step === 'double', ... });
}
```

Plugins can also be declared in `package.json` under `plyflow.plugins` — both
sources are merged and deduplicated before loading.

See `examples/plugins/` for a full working example.

## Future work

- `workflows/` auto-discovery + a TUI picker (run with no file argument)
- MCP support on agents
- Additional providers (OpenAI, etc.)
