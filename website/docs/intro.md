---
slug: /
sidebar_position: 1
---

# Introduction

**plyflow** is a Node.js/TypeScript CLI that runs AI agent workflows defined in YAML files. Think of it as *GitHub Actions for AI agents*: workflows are DAGs of typed steps, AI steps call agents defined in Markdown files, and runs render a live progress tree in the terminal that can pause for human input.

## Why plyflow?

Most AI "workflow" tools lock you into rigid templates or proprietary scripting. plyflow takes a different approach:

- **Workflows are YAML** — readable, version-controlled, and shareable.
- **Agents are Markdown** — your system prompt is the file body; model/provider config is frontmatter.
- **TypeScript everywhere** — inline `run:` steps and `uses:` modules are real TypeScript. Import any library. No sandboxing.
- **DAG execution** — steps within a phase run in parallel by default, constrained by explicit `needs:` declarations.
- **Dynamic fan-out** — `foreach:` and `loop:` let workflows grow at runtime based on data.
- **Provider-agnostic** — currently ships with a Claude provider (`api`, `cli`, and `agent-sdk` modes); designed for additional providers.
- **Resume from any point** — every run is journaled. Interrupted runs can be resumed, skipping already-completed steps.
- **Extensible** — add custom UI widgets (Ink/React), custom step types (plugins), or workflow-local npm packages.

## Key concepts

| Concept | Description |
|---------|-------------|
| **Workflow** | A YAML file with `name`, `inputs`, and `phases` |
| **Phase** | An ordered group of steps; phases run sequentially |
| **Step** | A unit of work with exactly one type key (`run`, `agent`, `input`, etc.) |
| **Agent** | A Markdown file — frontmatter sets the model/provider, body is the system prompt |
| **Expression** | `${{ }}` — interpolates inputs, step outputs, env vars, and loop bindings |
| **Journal** | Per-run JSON file under `.plyflow/runs/` for resume and auditing |

## The big picture

```
workflow.yaml
  └── phases (sequential)
        └── steps (parallel, constrained by needs:)
              ├── run:     TypeScript / JavaScript
              ├── agent:   AI call → structured or text output
              ├── input:   Pause for human input
              ├── foreach: Dynamic fan-out over an array
              ├── loop:    Repeat until a condition is met
              ├── widget:  Custom Ink/React terminal UI
              └── step:    Custom plugin step type
```

## What can you build?

- **Automated code-review pipelines** — scout changed files, fan out to specialist agents per language bucket, repair findings.
- **Content generation workflows** — agent writes a draft, human confirms, another agent formats it.
- **Software delivery agents** — plan an issue, implement it task-by-task, review, open a PR. (See [the mission example](./example-mission.md).)
- **Data processing pipelines** — run TypeScript transforms between AI calls with full library access.

## Status

plyflow is at **v0.3**. The core engine, all step types, the Claude provider, structured output, resume, widgets, and plugins are implemented and tested. See [Getting Started](./getting-started.md) to run your first workflow in minutes.
