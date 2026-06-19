---
sidebar_position: 3
---

# `agent` Steps

An `agent:` step calls an AI model using an agent defined in a Markdown file.

## Basic usage

```yaml
- id: summarize
  agent: ./agents/summarizer.md
  prompt: "Summarize the following text:\n${{ inputs.text }}"
```

The `agent:` value is a path to a `.md` file (relative to the workflow file). The `prompt:` is the user-turn message sent to the model.

## Agent files

An agent file is a Markdown document with YAML frontmatter:

```markdown
---
model: claude-opus-4-5
provider: claude
mode: api
temperature: 0.2
---

You are a professional text summarizer. Given a piece of text, produce a
concise summary with a title and three key points.

Always respond using the required structured output format.
```

| Frontmatter field | Description |
|-------------------|-------------|
| `model` | Model ID (e.g., `claude-opus-4-5`, `claude-sonnet-4-5`) |
| `provider` | Provider name (currently: `claude`) |
| `mode` | Execution mode: `api`, `cli`, or `agent-sdk` |
| `temperature` | Sampling temperature (0.0–1.0) |

The file body (after the frontmatter) becomes the **system prompt**.

## Structured output

Add `output:` pointing to a `.ts` file that exports a Zod schema to get typed, validated JSON back from the agent:

```yaml
- id: plan
  agent: ./agents/flight-director.md
  prompt: "Plan the following issue: ${{ inputs.issue_body }}"
  output: ./schemas/Plan.ts
```

```typescript
// schemas/Plan.ts
import { z } from 'zod';

export default z.object({
  issue_title: z.string(),
  tasks: z.array(z.object({
    name: z.string(),
    title: z.string(),
    files: z.array(z.string()),
    acceptance: z.string(),
    depends_on: z.array(z.string()),
  })),
  open_questions: z.array(z.string()),
});
```

plyflow converts the Zod schema to JSON Schema, forces the model to return matching JSON (using tool-use in `api` mode), validates the response, and makes it available as the step's typed output.

```yaml
- id: show-tasks
  needs: [plan]
  run: return `Planning ${ctx.steps.plan.output.tasks.length} tasks`;
```

## Per-step overrides

Override the agent file's model, mode, or params on a per-step basis:

```yaml
- id: implement
  agent: ./agents/astronaut.md
  model: "${{ steps.models.output.astronaut }}"   # dynamic model selection
  mode: agent-sdk
  params:
    cwd: "${{ steps.worktree.output.worktree_path }}"
    allowedTools: ["Read", "Edit", "Write", "Bash"]
    maxTurns: 50
  prompt: |
    Task: ${{ task.name }}
    Acceptance: ${{ task.acceptance }}
```

| Field | Description |
|-------|-------------|
| `model` | Override the agent file's model (expression-resolved) |
| `mode` | Override the agent file's mode (`api`, `cli`, `agent-sdk`) |
| `params` | Merged into the provider request; mode-specific fields like `cwd`, `allowedTools`, `maxTurns` |

## Text output (no schema)

Without `output:`, the agent returns raw text:

```yaml
- id: draft
  agent: ./agents/writer.md
  prompt: "Write a blog post about ${{ inputs.topic }}"

- id: show
  needs: [draft]
  run: return ctx.steps.draft.output; // plain string
```

## Modes

See [Agents & Providers](../agents-providers.md) for a detailed explanation of the three modes (`api`, `cli`, `agent-sdk`) and when to use each.
