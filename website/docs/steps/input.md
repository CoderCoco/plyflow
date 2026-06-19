---
sidebar_position: 4
---

# `input` Steps

An `input:` step pauses the workflow and asks the user a question. Three input types are supported: `confirm`, `text`, and `select`.

## `confirm` — yes/no prompt

```yaml
- id: proceed
  needs: [plan]
  input:
    type: confirm
    message: "Flight plan ready: ${{ steps.plan.output.tasks.length }} tasks. Proceed?"
```

The step output is a boolean (`true` if confirmed, `false` otherwise). If the user declines, you can gate subsequent steps with `if:`:

```yaml
- id: build
  needs: [proceed]
  if: "${{ steps.proceed.output == true }}"
  foreach: "${{ steps.plan.output.tasks }}"
  # ...
```

## `text` — free text input

```yaml
- id: get-name
  input:
    type: text
    message: "Enter your name:"
```

The step output is the string the user typed.

## `select` — pick from a list

```yaml
- id: choose-env
  input:
    type: select
    message: "Which environment?"
    choices:
      - staging
      - production
      - local
```

The step output is the selected string.

## `default:` for non-TTY mode

When running in a non-interactive context (CI, piped output, tests), plyflow cannot render a prompt. Add `default:` to provide an automatic answer:

```yaml
- id: confirm
  input:
    type: confirm
    message: "Accept the plan?"
  default: true
```

Without `default:`, an `input:` step in non-TTY mode throws an error.

:::tip CI workflows
When automating plyflow in CI, either:
1. Set `default:` on every `input:` step to make them non-interactive, or
2. Use `--input` flags to supply all required values, and make the confirm steps auto-approve with `default: true`.
:::

## Full example

From `examples/summarize.yaml`:

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
