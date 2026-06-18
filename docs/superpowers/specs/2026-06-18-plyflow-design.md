# plyflow — Design Spec

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan

## Summary

`plyflow` is a Node/TypeScript console application that runs **AI agent workflows defined in YAML files** — conceptually "GitHub Actions for AI agents." Workflows are DAGs of typed steps; AI steps call agents defined in Markdown files (frontmatter + system-prompt body). Execution renders a live phase/step progress tree in an Ink/React terminal UI and can pause mid-run to collect user input.

It exists to break past the limits of Claude Code's built-in workflow runner: plyflow workflows can **import libraries**, **run arbitrary inline TS/JS**, **prompt the user interactively**, **render custom TUI widgets**, and **call any AI provider** (Claude first) behind one interface — none of which the built-in runner supports.

## Goals

- Define workflows declaratively in YAML: phases, steps, DAG dependencies, and workflow-level inputs.
- Define reusable agents in Markdown (frontmatter config + body as system prompt), invoked by name with a passed-in prompt.
- Execute steps through a small, uniform **step-type registry** — the single extension primitive.
- Support custom code via inline `run:` steps and external `uses: ./module.ts` modules (libraries importable).
- Support **structured AI output** via Zod schemas (`.ts` files) → JSON Schema → validated results.
- Be **provider-agnostic**: an `AIProvider` interface with Claude as the first implementation (three modes: Agent SDK, `claude -p` subprocess, raw Anthropic API).
- **Interactive mid-run input** via Ink components, and a live **phase/step progress tree**.
- **Journal + resume**: persist completed step results; resume an interrupted/failed run without repeating expensive AI calls.
- CLI entry `plyflow run ./workflow.yaml` (direct file argument).
- GitHub Actions CI: build + lint + test on push and PRs.

## Non-Goals (v1)

- Workflow auto-discovery directory + TUI picker (v2).
- MCP support on agents (v2).
- The custom `widget:` step type implementation (v2 — but the step-type primitive is designed to accommodate it now).
- Remote/distributed execution, a server, or a web UI.
- Sandboxed/untrusted workflow execution — v1 treats local workflow files as **trusted** and runs inline code in-process.

## Architecture

A single TypeScript package (ESM), built with `tsup`, exposing a `plyflow` bin. Six modules with clear boundaries:

- **`core/`** — workflow + agent file loader (YAML via `yaml`, frontmatter via `gray-matter`); a validator using Zod schemas that describe the *workflow/agent file formats themselves*; the context + `${{ }}` expression engine; the DAG scheduler; and the journal/resume store.
- **`steps/`** — the step-type registry plus built-in step types: `agent`, `run`, `input`, `parallel` (and `widget` in v2). Each implements one interface.
- **`providers/`** — the `AIProvider` interface and Claude implementations.
- **`schema/`** — loads user Zod schemas from `.ts` files, converts Zod → JSON Schema (`zod-to-json-schema`) for structured AI output, and validates AI responses.
- **`tui/`** — Ink/React components: the app shell, the phase/step progress tree, interactive input prompts, and output panels. Includes a non-TTY/CI fallback to plain line logging.
- **`cli/`** — argument parsing and wiring (`run`, `--input key=val`, `--resume <runId>`).

### Key enabling decision: runtime TS loading via `jiti`

All user-referenced `.ts` files — external step modules (`uses:`), Zod schema files (`output:`), and custom widgets (v2) — are loaded at runtime through `jiti` (a TS-aware require). This means **no separate build step for user-authored extensions**, and one consistent loading mechanism across all three "faces" of extensibility.

## File Formats

### Workflow YAML

Phases group steps for display and ordering; steps are the DAG nodes.

```yaml
name: summarize-and-review
inputs:                          # workflow-dispatch-style; TUI prompts if not passed via --input
  repo: { type: string, required: true }
phases:
  - name: Gather
    steps:
      - id: read
        run: ./steps/read-repo.ts          # external code step
        with: { path: ${{ inputs.repo }} }
  - name: Analyze
    steps:
      - id: summary
        agent: ./agents/summarizer.md       # AI step
        prompt: "Summarize:\n${{ steps.read.output.text }}"
        output: ./schemas/Summary.ts        # Zod schema → structured JSON
      - id: confirm
        needs: [summary]
        input:                              # interactive Ink prompt mid-run
          type: confirm
          message: "Proceed with ${{ steps.summary.output.title }}?"
```

**Semantics:**
- Phases run in **declared order**; the next phase begins after the current phase's steps complete.
- Steps **within a phase** run in parallel unless constrained by `needs: [stepId, ...]`.
- `${{ }}` expressions read from `inputs`, `steps.<id>.output`, and `env`. The expression engine evaluates a restricted JS expression against this context (no statements, no side effects).
- Step config keys are mutually distinguishing: a step has exactly one of `run` / `uses` / `agent` / `input` / `parallel` (the key selects the step type), plus common keys (`id`, `needs`, `with`, `output`, `retry`, `continueOnError`).

### Agent Markdown

Frontmatter is the agent config; the Markdown body is the system prompt.

```markdown
---
model: claude-opus-4-8
provider: claude
mode: api            # api | agent-sdk | cli  (how to call Claude; api preferred for structured output)
temperature: 0.2
---
You are a precise code summarizer. Return only what the schema asks for.
```

## Step Type Interface (the core primitive)

```ts
interface StepType<Cfg> {
  name: string;                                    // "agent" | "run" | "input" | "parallel" | ...
  parse(raw: unknown): Cfg;                         // Zod-validated step config
  run(cfg: Cfg, ctx: StepContext): Promise<StepResult>;
}
```

`StepContext` exposes:
- resolved `inputs`, `env`, and prior `steps.<id>.output`;
- an event emitter for progress/log/streamed-output lines (drives the TUI);
- a `prompt(request)` callback the TUI fulfills (used by `input` steps and interactive widgets);
- the active `AIProvider`.

`StepResult` carries the step's `output` (arbitrary JSON, validated against the step's Zod schema when `output:` is set), status, and timing.

Built-in step types:
- **`agent`** — resolve the Markdown agent, build the request (system prompt + interpolated prompt + optional JSON Schema), call the provider, validate output.
- **`run` / `uses`** — load JS/TS (inline or `./module.ts` via `jiti`), call its default export with `(ctx.with, ctx)`; libraries are importable inside.
- **`input`** — emit a prompt request; the TUI mounts the matching Ink component (`confirm` | `text` | `select`) and resolves the user's answer.
- **`parallel`** — explicit fan-out of child steps (complements the implicit within-phase parallelism).
- **`widget`** (v2) — load a `.tsx` component, mount it in the TUI, await its `resolve`.

## AI Provider Interface & Structured Output

```ts
interface AIProvider {
  name: string;
  complete(req: {
    system: string;
    prompt: string;
    model: string;
    params?: Record<string, unknown>;
    outputSchema?: JsonSchema;           // when set, force structured output
  }): Promise<AIResult>;                 // { text?, structured?, usage }
}
```

Claude is the first implementation, supporting **three modes behind this one interface**, chosen per agent frontmatter (`mode:`) or global config:
- **`api`** — raw `@anthropic-ai/sdk` `messages.create`. Preferred when `outputSchema` is set: forced tool-use yields clean structured JSON.
- **`agent-sdk`** — `@anthropic-ai/claude-agent-sdk` `query()`: full agentic loop, tools, MCP-ready, streaming.
- **`cli`** — shell out to `claude -p`; reuses existing CLI auth/session.

Provider-agnostic design means OpenAI or other "generic AI tools" slot in as additional `AIProvider` implementations without touching the engine.

**Structured output flow:** a step's `output:` points to a `.ts` file exporting a Zod schema → `zod-to-json-schema` converts it → passed to the provider as `outputSchema` → the response is `schema.parse()`d → downstream `${{ steps.x.output.field }}` references are validated and typed.

## Execution, Journaling & Resume

- Each run gets a `runId` and a journal at `.plyflow/runs/<runId>.json`.
- Before a step executes, the scheduler checks the journal: an **unchanged, already-completed** step replays its cached result (skipping repeat AI calls); the **first incomplete or changed** step and everything downstream of it re-runs. Change detection hashes the resolved step config + upstream outputs.
- `plyflow run --resume <runId>` reattaches to an existing journal.
- Per-step `retry: { max, backoff }` and `continueOnError: true`. On failure, the run is marked failed but remains resumable.

## TUI

The Ink app renders a **phase/step progress tree**: phase headers with their steps nested beneath, each step showing a spinner → ✓/✗, elapsed time, and streamed log/output lines. When an `input` step (or a v2 widget) runs, the app pauses the tree and mounts the matching interactive component, then resumes once resolved. A non-TTY / CI environment falls back to plain line-based logging.

## Testing Strategy

Vitest, test-driven throughout. Coverage:
- **core**: loader + format validation (good/bad fixtures), expression engine, DAG scheduler (ordering, `needs`, cycle detection), journal/resume (replay + invalidation on change).
- **steps**: each built-in step type, using a `FakeProvider` for `agent` steps.
- **schema**: Zod → JSON Schema round-trip + response validation (accept/reject).
- **tui**: components via `ink-testing-library`.
- **e2e**: a couple of fixture workflows executed end-to-end against the `FakeProvider`.

## Build, CI & Repo

- New GitHub repository `plyflow`. Single TS package, ESM, built with `tsup`; bin entry `plyflow`.
- **Dependencies:** `ink` + `react`, `yaml`, `gray-matter`, `zod` + `zod-to-json-schema`, `jiti`, `@anthropic-ai/sdk` (+ optional `@anthropic-ai/claude-agent-sdk`).
- **GitHub Actions CI:** a workflow running install → build → lint → test (vitest) on push and pull requests, with a Node version matrix (e.g. 20.x, 22.x). A release/publish workflow can be added later.

## Future Work (v2+)

- `workflows/` auto-discovery directory + a TUI workflow picker (run with no file argument).
- MCP support on agents.
- The `widget:` step type implementation (`.tsx` components mounted in the TUI).
- Additional `AIProvider` implementations (OpenAI, etc.).
- npm publish workflow.
