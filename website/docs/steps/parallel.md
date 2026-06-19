---
sidebar_position: 5
---

# `parallel` Steps

A `parallel:` step runs a fixed list of child steps concurrently and collects their outputs.

## Basic usage

```yaml
- id: gather
  parallel:
    - id: fetch-issues
      uses: ./lib/gh-issues.ts
      with:
        repo: "${{ inputs.repo }}"

    - id: fetch-prs
      uses: ./lib/gh-prs.ts
      with:
        repo: "${{ inputs.repo }}"

    - id: fetch-releases
      uses: ./lib/gh-releases.ts
      with:
        repo: "${{ inputs.repo }}"
```

All three child steps run at the same time. The `parallel:` step completes when all children finish.

## Output

The `parallel:` step's output is an object keyed by child step ID:

```yaml
- id: show
  needs: [gather]
  run: |
    const issues = ctx.steps.gather.output['fetch-issues'];
    const prs = ctx.steps.gather.output['fetch-prs'];
    return { issueCount: issues.length, prCount: prs.length };
```

:::note When to use parallel vs default concurrency
Steps within a phase already run concurrently by default (constrained only by `needs:`). Use `parallel:` when you want to treat a group of concurrent steps as a single logical unit — so a later step can depend on all of them with a single `needs: [gather]` instead of listing each individually.
:::

## Nesting

Child steps of `parallel:` support all the same step fields, including `needs:` (within the parallel scope), `if:`, `agent:`, etc.

```yaml
- id: analyze
  parallel:
    - id: static-check
      run: return performStaticAnalysis(ctx.inputs.code);

    - id: style-check
      run: return checkStyle(ctx.inputs.code);

    - id: security-scan
      if: "${{ inputs.run_security == true }}"
      agent: ./agents/security-scanner.md
      prompt: "Scan: ${{ inputs.code }}"
```
