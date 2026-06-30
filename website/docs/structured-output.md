---
sidebar_position: 6
---

# Structured Output

By default, agent steps return raw text. Add `output:` to get validated, typed JSON instead.

## How it works

1. You write a `.ts` file that `export default`s a Zod schema.
2. plyflow calls `z.toJSONSchema(schema)` to get a JSON Schema.
3. In `api` mode, the JSON Schema is passed as a forced tool-use call to Claude — 100% reliable extraction.
4. In `agent-sdk` mode, `outputFormat: { type: 'json_schema', schema }` is used.
5. The response is validated against `schema.parse(...)` — throws if the model returned invalid data.
6. Downstream steps receive the typed, validated value as `steps.<id>.output`.

## Writing a schema

```typescript
// schemas/Summary.ts
import { z } from 'zod';

export default z.object({
  title: z.string().describe('A short, descriptive title'),
  keyPoints: z.array(z.string()).min(1).max(5).describe('The main points'),
  wordCount: z.number().int().positive(),
});
```

`zod` is a host-provided module — no install needed in the workflow directory.

## Using a schema

```yaml
- id: summary
  agent: ./agents/summarizer.md
  prompt: "Summarize:\n${{ inputs.text }}"
  output: ./schemas/Summary.ts   # relative to the workflow file
```

## Accessing output fields

```yaml
- id: confirm
  needs: [summary]
  input:
    type: confirm
    message: "Title: '${{ steps.summary.output.title }}'. Accept?"

- id: show-count
  needs: [summary]
  run: return `${ctx.steps.summary.output.keyPoints.length} key points`;
```

## Complex schemas

```typescript
// schemas/Plan.ts
import { z } from 'zod';

const Task = z.object({
  name: z.string(),
  title: z.string(),
  files: z.array(z.string()),
  acceptance: z.string(),
  depends_on: z.array(z.string()),
});

export default z.object({
  issue_title: z.string(),
  branch: z.string(),
  tasks: z.array(Task),
  open_questions: z.array(z.string()),
});
```

```yaml
- id: plan
  agent: ./agents/flight-director.md
  prompt: "Plan issue #${{ inputs.issue }}"
  output: ./schemas/Plan.ts

- id: build
  needs: [plan]
  foreach: "${{ steps.plan.output.tasks }}"
  as: task
  key: "${{ task.name }}"
  dependsOn: "${{ task.depends_on }}"
  steps:
    - id: implement
      agent: ./agents/astronaut.md
      prompt: |
        Task: ${{ task.name }}
        Files: ${{ task.files }}
        Acceptance: ${{ task.acceptance }}
```

## Agent system prompt guidance

For `api` mode, the tool-use mechanism forces structured output without needing special instructions. However, it's still good practice to remind the agent:

```markdown
---
model: claude-sonnet-4-6
mode: api
---

You analyze code and produce structured findings reports.
Always use the `respond` tool to return your findings in the required format.
```

For `agent-sdk` mode, the SDK's `outputFormat` parameter handles extraction, but describing the expected output in the system prompt improves quality.

## Validation errors

If Claude returns data that doesn't match your Zod schema, plyflow throws a validation error. The run is journaled up to that point and can be resumed after fixing the schema or agent prompt.

:::tip Schema design tips
- Use `.describe()` on fields — the description is included in the JSON Schema and helps the model understand what to put there.
- Keep schemas as specific as possible. Overly loose schemas (lots of `z.unknown()`) reduce the value of validation.
- Use `z.literal()` for enum-like fields: `z.enum(['PASS', 'FAIL'])`.
:::
