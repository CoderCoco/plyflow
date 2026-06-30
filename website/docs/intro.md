---
slug: /
sidebar_position: 1
---

# plyflow

**Run AI agent workflows defined in YAML — with a live terminal UI, resume, and full TypeScript extensibility.**

plyflow is "GitHub Actions for AI agents": workflows are DAGs of typed steps, AI steps call agents defined in Markdown files, and runs render a live progress tree in the terminal that can pause for human input.

---

## 30-second quick start

Install the CLI. A published npm package is on the way; until then, clone and build
(see [Getting Started](./getting-started.md) for the full setup):

```bash
# Coming soon — published package:
npm install -g plyflow

# Available today — clone and link:
git clone https://github.com/CoderCoco/plyflow.git
cd plyflow && pnpm install && pnpm -r build && npm link
```

Then create an agent and a workflow, and run it:

```bash
export ANTHROPIC_API_KEY=sk-ant-…

cat > summarizer.md << 'EOF'
---
model: claude-opus-4-8
provider: claude
mode: api
---
You are a precise summarizer. Reply with a single sentence.
EOF

cat > summarize.yaml << 'EOF'
name: Summarize
inputs:
  text: { type: string, required: true }
phases:
  - name: Main
    steps:
      - id: summary
        agent: ./summarizer.md
        prompt: ${{ inputs.text }}
EOF

plyflow run summarize.yaml --input text="The quick brown fox jumps over the lazy dog."
```

[Get the full walkthrough →](./getting-started.md)

---

## Why plyflow?

| Feature | Details |
|---------|---------|
| **YAML workflows** | Readable, version-controlled, shareable. Phases run sequentially; steps within a phase run in parallel. |
| **Agents are Markdown** | System prompt is the file body; model/provider/mode are frontmatter. |
| **TypeScript everywhere** | `run:` steps and `uses:` modules are real TypeScript — import any library. |
| **DAG execution** | Steps declare `needs:` to sequence within a phase; everything else parallelises automatically. |
| **Dynamic fan-out** | `foreach:` and `loop:` let workflows grow at runtime based on data. |
| **Resume from any point** | Every run is journaled. Interrupted runs can be resumed, skipping already-completed steps. |
| **Interactive terminal UI** | Live progress tree, human `input:` steps, and custom Ink/React `widget:` components. |
| **Extensible** | Add custom step types (plugins), custom UI widgets, and per-workflow npm packages. |

---

## Key concepts at a glance

```
workflow.yaml
  └── phases (sequential)
        └── steps (parallel, constrained by needs:)
              ├── run / uses: Inline TypeScript / external .ts module
              ├── agent:    AI call → text or structured JSON output
              ├── sh:       Run a shell command
              ├── input:    Pause for human input (confirm / text / select)
              ├── parallel: Explicit fan-out over a fixed step list
              ├── foreach:  Dynamic fan-out over an array
              ├── loop:     Repeat until a condition is met
              ├── use:      Call another workflow as a sub-step
              ├── widget:   Custom Ink/React terminal UI component
              └── step:     Custom plugin step type
```

| Concept | Description |
|---------|-------------|
| **Workflow** | A YAML file with `name`, optional `inputs`, and `phases` |
| **Phase** | An ordered group of steps; phases run sequentially |
| **Step** | A unit of work with exactly one type key (`run`, `agent`, `input`, etc.) |
| **Agent** | A Markdown file — frontmatter sets model/provider, body is the system prompt |
| **Expression** | `${{ }}` — interpolates inputs, step outputs, env vars, and loop bindings |
| **Journal** | Per-run JSON file under `.plyflow/runs/` for resume and auditing |

---

## Explore the docs

### Core concepts
- [Getting Started](./getting-started.md) — install, write your first workflow, run it
- [Workflow Files](./workflow-files.md) — full YAML reference (inputs, phases, expressions)
- [Step Types](./steps/overview.md) — `run`/`uses`, `agent`, `sh`, `input`, `parallel`, `foreach`, `loop`, `use`, `widget`, `step`
- [Agents & Providers](./agents-providers.md) — Markdown agent files, Claude provider modes
- [Structured Output](./structured-output.md) — Zod schemas → forced JSON output from agents
- [Resume & Journaling](./resume-journaling.md) — how journaling works, `--resume` flag

### Reference & tools
- [CLI Reference](./cli-reference.md) — all `plyflow` commands and flags
- [Programmatic Usage](./programmatic-usage.md) — use plyflow as a Node.js library
- [Testing Workflows](./testing.md) — `@plyflow/testing`: `fakeProvider` and `mockExec`

### Extensibility
- [Custom Widgets](./extensibility/widgets.md) — Ink/React terminal UI components
- [Plugins](./extensibility/plugins.md) — register custom step types
- [Workflow Dependencies](./extensibility/workflow-dependencies.md) — per-workflow `package.json`

### Example & help
- [Example: Mission Workflow](./example-mission.md) — a full multi-phase AI software delivery workflow
- [Troubleshooting & FAQ](./troubleshooting.md) — common errors and how to fix them
- [Contributing](./contributing.md) — development setup, project layout, how to add a step type or provider

---

## What can you build?

- **Automated code-review pipelines** — scout changed files, fan out to specialist agents per language bucket, repair findings.
- **Content generation workflows** — agent writes a draft, human confirms, another agent formats it.
- **Software delivery agents** — plan an issue, implement it task-by-task, review, open a PR. (See the [mission example](./example-mission.md).)
- **Data processing pipelines** — run TypeScript transforms between AI calls with full library access.

---

plyflow is at **v0.3**. The core engine, all step types, the Claude provider (api / cli / agent-sdk modes), structured output, resume, widgets, plugins (including the first-party [`@plyflow/git` and `@plyflow/github` packs](./steps/plugin-packs.md)), running [workflows from GitHub](./remote-workflows.md), and the [testing framework](./testing.md) are implemented and tested.
