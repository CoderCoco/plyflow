---
sidebar_position: 5
---

# Agents & Providers

## Agent files

An agent is a Markdown file with YAML frontmatter. The frontmatter configures the model and provider; the body is the system prompt.

```markdown
---
model: claude-sonnet-4-5
provider: claude
mode: api
temperature: 0.3
---

You are a precise software engineer. When given a task, implement it
faithfully following the acceptance criteria. Always describe what you did.
```

### Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Model ID (required) |
| `provider` | string | Provider name (currently: `claude`) |
| `mode` | `api` \| `cli` \| `agent-sdk` | Execution mode (see below) |
| `temperature` | number | Sampling temperature (0.0–1.0) |

Additional keys are passed through to the provider.

## The Claude provider

plyflow ships with a Claude provider that supports three execution modes.

### `api` mode (default)

Calls the Anthropic Messages API directly via the `@anthropic-ai/sdk`. This is the simplest mode:

- Fast, predictable, stateless
- Forced tool-use for structured output (100% reliable extraction)
- No tool execution — the model generates text or a structured response

**When to use:** Any step that needs text generation or structured JSON output without needing to read files or run commands.

```yaml
- id: summarize
  agent: ./agents/summarizer.md
  # mode: api  ← default
  prompt: "Summarize: ${{ inputs.text }}"
  output: ./schemas/Summary.ts
```

### `agent-sdk` mode

Runs an agentic loop via `@anthropic-ai/claude-agent-sdk`. The model can execute tools (read files, run bash commands, etc.) across multiple turns.

**When to use:** Steps that need the model to actively explore a codebase, run tests, or perform multi-step tool use.

```yaml
- id: implement
  agent: ./agents/astronaut.md
  mode: agent-sdk
  params:
    cwd: "${{ steps.worktree.output.worktree_path }}"
    allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"]
    maxTurns: 50
    permissionMode: bypassPermissions
  prompt: "Implement the feature described in the task."
```

Available `params` for `agent-sdk`:

| Param | Type | Description |
|-------|------|-------------|
| `cwd` | string | Working directory for tool execution |
| `allowedTools` | string[] | Which built-in tools are available (`Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`) |
| `maxTurns` | number | Max agentic turns (default: 50) |
| `permissionMode` | string | Permission mode (`bypassPermissions` for CI) |

Default allowed tools: `["Read", "Edit", "Write", "Bash", "Grep", "Glob"]`.

**Structured output in `agent-sdk`:** plyflow uses the SDK's `outputFormat: { type: 'json_schema', schema }` when an `output:` schema is provided. Falls back to a `submit` tool call or JSON text extraction.

### `cli` mode

Spawns the `claude` CLI (`claude -p`) as a subprocess. Useful for local development or testing without an API key.

```yaml
- id: draft
  agent: ./agents/writer.md
  mode: cli
  prompt: "Write a draft about ${{ inputs.topic }}"
```

Requires the `claude` CLI to be installed and authenticated (`claude auth login`).

## Per-step overrides

Override model, mode, or provider params at the step level — useful for dynamic model selection or per-step tool configuration:

```yaml
- id: plan
  agent: ./agents/flight-director.md
  model: "${{ steps.models.output.director }}"   # expression-resolved
  mode: agent-sdk
  params:
    cwd: "${{ steps.worktree.output.worktree_path }}"
    allowedTools: ["Read", "Grep", "Glob", "Bash"]
  prompt: "..."
```

The step-level `model` and `mode` override the agent file's frontmatter. `params` is merged into the provider request alongside any params from the frontmatter.

## Read-only agents

Agents that must not write files should declare a restricted `allowedTools`. The mission workflow uses this pattern for Flight Controller, Scout, and Systems Inspector agents:

```yaml
params:
  cwd: "${{ steps.worktree.output.worktree_path }}"
  allowedTools: ["Read", "Grep", "Glob", "Bash"]
```

The Astronaut (write-capable) omits `allowedTools`, getting the full default set.

## Required environment variable

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Required for both `api` mode and `agent-sdk` mode. Not required for `cli` mode (uses `claude auth` credentials).

## Future providers

The provider interface (`AIProvider`) is designed to support additional providers. OpenAI, Gemini, and others are planned as future additions.
