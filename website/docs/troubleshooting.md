---
sidebar_position: 14
---

# Troubleshooting & FAQ

## Conditions always evaluate to `true`

**Symptom:** A step with `if:` or `until:` always runs (or a loop never terminates) even though the condition should be `false`.

**Cause:** The condition value is a bare string, not an expression. A bare YAML string is always truthy:

```yaml
# WRONG — "steps.check.output === 'done'" is a literal string, always truthy
- id: next
  if: steps.check.output === 'done'
  run: …
```

**Fix:** Wrap every condition in `${{ }}`:

```yaml
# CORRECT
- id: next
  if: ${{ steps.check.output === 'done' }}
  run: …
```

The same applies to `until:` on `loop:` steps. Always wrap boolean expressions in `${{ }}`.

---

## `needs:` on a step from a previous phase errors

**Symptom:** `Error: unknown step id "prev-phase-step"` or similar when a step declares `needs: [prev-phase-step]` where `prev-phase-step` is in an earlier phase.

**Cause:** `needs:` is **intra-phase only** — it controls parallel scheduling within a single phase. Cross-phase step outputs are automatically available in all later phases via `${{ steps.prev-phase-step.output }}` without any `needs:` declaration.

**Fix:** Remove the cross-phase id from `needs:`. Just reference the output value directly:

```yaml
phases:
  - name: Build
    steps:
      - id: compile
        run: return 'artifact.zip';

  - name: Deploy
    steps:
      - id: ship
        # No needs: here — cross-phase outputs are always available
        run: |
          const artifact = ${{ steps.compile.output }};
          return deploy(artifact);
```

---

## `input` or `widget` step throws in CI / non-TTY environment

**Symptom:** `Error: no TTY available and no default provided for step "confirm"` (or similar) in CI or when output is piped.

**Cause:** `input` and `widget` steps pause for human input. When the process is not attached to an interactive terminal and no fallback is configured, plyflow throws rather than hanging indefinitely.

**Fix:** Add a `default:` value to the step so non-TTY runs return it automatically:

```yaml
- id: confirm
  input:
    type: confirm
    message: "Proceed with deployment?"
  default: true     # returned automatically when not a TTY
```

Alternatively, pass a `prompt` handler to `runWorkflow` when using the library API — see [Programmatic Usage](./programmatic-usage.md#handling-input-steps-programmatically).

---

## `agent-sdk` mode fails or requires specific Node version

**Symptom:** Errors from `@anthropic-ai/claude-agent-sdk` or Ink rendering failures when using `mode: agent-sdk` on an agent step.

**Cause:** The `agent-sdk` mode uses `@anthropic-ai/claude-agent-sdk` and Ink (a React-based terminal renderer), which require Node.js ≥22. plyflow itself requires Node ≥24 (`engines: { node: ">=24" }`), which satisfies this.

**Fix:** Ensure you are running Node 24 or later:

```bash
node --version   # should be >=24.0.0
```

Use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions if needed:

```bash
nvm install 24
nvm use 24
```

---

## Provider authentication errors

| Mode | Authentication | Fix |
|------|---------------|-----|
| `api` | Reads `ANTHROPIC_API_KEY` from env | Set `export ANTHROPIC_API_KEY=sk-ant-…` |
| `cli` | Spawns the `claude` binary | Install Claude Code CLI and ensure `claude` is on your `PATH` |
| `agent-sdk` | Uses Claude Code credentials | Log in with the `claude` CLI first (`claude auth login`) |

**Symptom for `api` mode:** `AuthenticationError` or `401` from the Anthropic API.

**Symptom for `cli` mode:** `Error: spawn claude ENOENT` — the `claude` executable cannot be found.

---

## `foreach` step errors on duplicate keys or slash in key

**Symptom:** `Error: duplicate foreach key "…"` when running a `foreach:` step.

**Cause:** Each iteration of `foreach:` writes its output to the journal under a key derived from the item. Duplicate keys would overwrite journal entries, so plyflow throws.

**Fix:** Ensure the values used as keys in the `foreach:` array are unique. If you control the array, deduplicate it upstream in a `run:` step.

**Slash in key:** Keys containing `/` are sanitised for journal file paths (slashes are replaced). This is handled automatically; you do not need to avoid slashes in your data.

---

## Workflow dependency installation fails or a module is not found

**Symptom:** `Cannot find package 'some-lib'` when a `run:` step or widget imports a library.

**Cause/Fix:**

1. **Workflow `package.json`** — If your workflow directory contains a `package.json`, plyflow runs `npm ci` (if a lockfile is present) or `npm install` before the workflow starts. Check that the package is declared in that `package.json`.

2. **Host-provided modules** — `zod`, `react`, and `ink` are bundled with plyflow and resolve to plyflow's own copies. Do not declare them in your workflow's `package.json`. If you need to mark additional packages as host-provided (so they resolve to the host's copy), add them to `plyflow.provided` in your workflow's `package.json`:

```json
{
  "plyflow": {
    "provided": ["my-shared-lib"]
  }
}
```

3. **Relative imports** — `run:` and `uses:` paths are resolved relative to the workflow file's directory. Use `./lib/helper.ts`, not `lib/helper.ts`.

---

## Widget fails with "widget failed" or "no default export"

**Symptom:** `Error: widget failed: …/Picker.tsx has no default export` or the widget step throws immediately.

**Cause:** Widget modules must:
- Exist at the path given in the `widget:` field (resolved relative to the workflow file).
- Have a `default` export that is a React component accepting `{ data, resolve }`.

**Fix:**

```tsx
// Picker.tsx — must have a default export
import React from 'react';
import { Text } from 'ink';

export default function Picker({ data, resolve }) {
  // call resolve(value) to return a value from the widget
  return <Text>{data.message}</Text>;
}
```

Verify the path is correct and the file compiles without errors.

---

## Step output is `undefined` even though the step ran

**Symptom:** `${{ steps.myStep.output }}` evaluates to `undefined` in a later step.

**Cause:** A `run:` step's output is whatever the function returns. If the function does not return a value (implicit `undefined`), the output is `undefined`.

**Fix:** Ensure the inline `run:` code has an explicit `return` statement:

```yaml
- id: compute
  run: |
    const result = 1 + 1;
    return result;   # explicit return required
```

---

## Resume skips steps it should re-run

**Symptom:** After changing a step's definition, resuming still returns the cached output.

**Cause:** The journal records each step's output keyed by step ID. Resume replays the cached output for any step that has a `completed` entry, regardless of whether the step definition changed.

**Fix:** To force a step to re-run, either start a fresh run (omit `--resume`) or delete the relevant step's entry from the journal file at `.plyflow/runs/<runId>.json`.

---

## Build error: "onBrokenLinks: throw" in docs

This is a docs-site concern, not a plyflow runtime issue. If you are contributing to the docs, see [Contributing](./contributing.md).
