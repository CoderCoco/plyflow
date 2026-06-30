# Live Agent View & Interactive TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the plyflow TUI a split-pane master/detail view that streams each agent's structured activity live, retains finished output for in-app review, and presents between-stage questions as a focus-capturing modal — all in the alternate screen buffer.

**Architecture:** Spec C — `docs/superpowers/specs/2026-06-28-live-agent-view-tui-design.md`. The engine (`@plyflow/core`) gains a stable per-instance identity (`instanceId`/`parentId`/`kind`) and one structured streaming event (`agent-stream` carrying an `AgentChunk` union) on its existing event channel; it stays stateless. The TUI (`@plyflow/tui`) owns all new statefulness: a pure run-model reducer, bounded scrollback buffers, the split-pane layout + keyboard navigation, the altscreen lifecycle, and the question modal.

**Tech Stack:** TypeScript (ESM, Node ≥24), Ink/React, `@anthropic-ai/claude-agent-sdk`, vitest, `ink-testing-library`, pnpm workspaces (post-Spec-A), tsdown.

## Global Constraints

- **Specs A & B are merged** (monorepo split + core features + plugin packs). This plan has been reconciled against the real `packages/core/src/**` and `packages/tui/src/**` code, so the paths are exact and the line numbers are real (captured post-merge). Still anchor each edit on the quoted surrounding code, not the bare line number, since unrelated changes may shift it.
- **Spec A additions already in the tree** that this plan respects (do not undo them): `buildDefaultRegistry(shellExec?)` now also registers the `sh` and `use` step types (`engine.ts:51`); `RunOptions`/`ExecScope`/`StepContext` already carry `dryRun`, `useChain`, `runDir`, `exec`; `runWorkflow` returns `{ runId, outputs, declaredOutputs }` (the extra field is irrelevant to the event-only tests here). None conflict with Spec C's additive changes.
- **ESM `.js` import extensions** on every relative import, even in `.ts`/`.tsx` (e.g. `import { x } from './run-model.js'`). Required by ESM resolution; omitting breaks the build.
- **Cross-package imports** resolve through package exports. Engine **types** (`EngineEvent`, `UiRequest`, `PromptRequest`, `WorkflowFile`, and the new `AgentChunk`/`StepKind`) import from `@plyflow/core`. The module loader (`createLoader`, `DEFAULT_PROVIDED`) imports from the **subpath** `@plyflow/core/module-loader` (this is how the existing `App.tsx` reaches it — NOT the main index). Intra-package imports stay relative with `.js`.
- **`packages/core/src/index.ts` is the public type surface for the TUI.** It does NOT currently export `AgentChunk` or `StepKind`. Task 1 adds `StepKind` and Task 2 adds `AgentChunk` to the `export type { EngineEvent, RunOptions } from './core/engine.js';` line (`index.ts:6`) — without this the `@plyflow/core` type imports in the TUI fail to resolve.
- **TDD:** failing test first → watch it fail → minimal implementation → watch it pass → commit. Tests live beside source as `*.test.ts(x)`; fixtures in a sibling `__fixtures__/`.
- **Test gate is vitest** (`pnpm -r test`), NOT `tsc --noEmit` (the repo has pre-existing type errors). Do not introduce NEW tsc errors; ignore pre-existing ones.
- **Conventional Commits** for every commit.
- **Inject side effects** (stdout, clock, SDK query) as params with real defaults so tests never touch the real terminal/network.

---

## File Structure

**`@plyflow/core` (engine — minimal, additive):**
- `packages/core/src/core/engine.ts` — extend `EngineEvent`; add `StepKind`, `AgentChunk` (Tasks 1–2)
- `packages/core/src/core/exec.ts` — emit `instanceId`/`parentId`/`kind`; translate `output` StepEvent → `agent-stream` (Tasks 1–2)
- `packages/core/src/steps/types.ts` — `StepEvent` `output.chunk` becomes `AgentChunk` (Task 2)
- `packages/core/src/providers/types.ts` — add `onChunk?` to `AICompleteRequest` (Task 3)
- `packages/core/src/providers/agent-sdk-chunks.ts` *(new)* — `messageToChunk()` pure mapping (Task 3)
- `packages/core/src/providers/claude.ts` — call `onChunk` in the agent-sdk loop (Task 3)
- `packages/core/src/steps/agent.ts` — pass `onChunk` that emits an `output` StepEvent (Task 3)

**`@plyflow/tui` (all new statefulness):**
- `packages/tui/src/run-model.ts` *(new)* — `AgentInstance`, `RunModel`, `applyEvent()`, `deriveLabel()`, ring-cap (Task 5)
- `packages/tui/src/status.ts` *(new)* — shared `glyph`/`color` maps extracted from ProgressTree (Task 6)
- `packages/tui/src/chunk-renderers.tsx` *(new)* — `<ChunkLine>` one render per `AgentChunk.t` (Task 6)
- `packages/tui/src/RunView.tsx` *(new)* — split-pane selector + detail (Tasks 6–7)
- `packages/tui/src/use-altscreen.ts` *(new)* — altscreen enter/restore/resize hook (Task 8)
- `packages/tui/src/QuestionModal.tsx` *(new)* — centered modal wrapping Prompt/WidgetHost (Task 9)
- `packages/tui/src/App.tsx` — rewire to `useRunModel` + `RunView` + modal + altscreen (Task 10)
- `packages/tui/src/logger.ts` — `LineLogger` handles `agent-stream` (Task 4)

---

## Task 1: Stable identity on engine events

**Files:**
- Modify: `packages/core/src/core/engine.ts` (the `EngineEvent` union, lines 23–29)
- Modify: `packages/core/src/core/exec.ts` (emit sites at lines 168, 210, 215, 266, 277)
- Modify: `packages/core/src/index.ts` (re-export `StepKind`)
- Test: `packages/core/src/core/identity.test.ts` *(new)*

**Interfaces:**
- Produces: `StepKind` (string union); every `EngineEvent` variant except `phase-start` gains `instanceId: string`; `step-start` additionally gains `parentId: string | null` and `kind: StepKind`. `instanceId` = `${scope.journalPath}/${step.id}` (the existing `journalKey`); `parentId` = `scope.journalPath`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/core/identity.test.ts`. It runs a tiny `foreach` workflow through the engine with a fake provider and captures events, asserting nested instances get distinct hierarchical `instanceId`s and correct `parentId`/`kind`.

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow, type EngineEvent } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function writeWorkflow(yaml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plyflow-id-'));
  const p = join(dir, 'wf.yaml');
  await writeFile(p, yaml);
  return p;
}

describe('engine event identity', () => {
  it('emits hierarchical instanceId + parentId + kind for foreach children', async () => {
    const wfPath = await writeWorkflow(`
name: idtest
phases:
  - name: Build
    steps:
      - id: build
        foreach: "\${{ ['a', 'b'] }}"
        steps:
          - id: work
            run: "return 1"
`);
    const events: EngineEvent[] = [];
    await runWorkflow(wfPath, {
      provider: new FakeProvider({}),
      isTty: false,
      runDir: join(tmpdir(), 'plyflow-id-runs'),
      onEvent: (e) => events.push(e),
    });

    const starts = events.filter((e) => e.type === 'step-start') as Extract<EngineEvent, { type: 'step-start' }>[];
    const workStarts = starts.filter((s) => s.stepId === 'work');
    expect(workStarts.map((s) => s.instanceId).sort()).toEqual([
      'phase:Build/build/foreach:a/work',
      'phase:Build/build/foreach:b/work',
    ]);
    for (const s of workStarts) {
      expect(s.kind).toBe('run');
      expect(s.parentId).toBe(s.instanceId.slice(0, s.instanceId.lastIndexOf('/')));
    }
  });
});
```

> Verified against the real engine: the foreach `subPath` is `${cfg.stepId}/foreach:${safeKey}` (`steps/foreach.ts:129`), and `makeRunChildren` joins it to the parent `journalPath` once (`exec.ts:90`), so a `work` step inside foreach step `build` gets `instanceId = phase:Build/build/foreach:a/work` (single `build`). `parentId` is that string minus the trailing `/work`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @plyflow/core test -- identity`
Expected: FAIL — `step-start` events have no `instanceId`/`parentId`/`kind` (props are `undefined`).

- [ ] **Step 3: Extend the `EngineEvent` union**

In `packages/core/src/core/engine.ts`, replace the union (currently lines 23–29) with:

```ts
// Known core step kinds; plugin steps (e.g. 'git.worktree') carry arbitrary
// names, so the union stays open via `(string & {})` to accept any `type.name`
// without a cast error while keeping editor autocomplete for the common kinds.
export type StepKind =
  | 'agent' | 'sh' | 'run' | 'input' | 'widget'
  | 'parallel' | 'loop' | 'foreach' | 'use'
  | (string & {});

export type EngineEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'step-start'; stepId: string; instanceId: string; parentId: string | null; kind: StepKind }
  | { type: 'step-done'; stepId: string; instanceId: string; output: unknown; cached: boolean }
  | { type: 'step-error'; stepId: string; instanceId: string; error: string }
  | { type: 'step-log'; stepId: string; instanceId: string; message: string }
  | { type: 'step-skipped'; stepId: string; instanceId: string };
```

The `__env__` emit in `engine.ts` (line 81) must supply an `instanceId`; change it to:

```ts
    onLog: (msg) => emit({ type: 'step-log', stepId: '__env__', instanceId: '__env__', message: msg }),
```

Then re-export `StepKind` from the package's public surface so the TUI can import it. In `packages/core/src/index.ts`, change the engine type export (line 6) to:

```ts
export type { EngineEvent, RunOptions, StepKind } from './core/engine.js';
```

- [ ] **Step 4: Emit identity from `exec.ts`**

In `packages/core/src/core/exec.ts`, inside `runOneStep`, compute the instance id once at the top (so the skip branch has it too). Add immediately after the `runOneStep(step: StepDef)` signature line (line 162):

```ts
    const instanceId = `${scope.journalPath}/${step.id}`;
    const parentId = scope.journalPath;
    const kind = scope.registry.select(step).name as import('./engine.js').StepKind;
```

Then update each emit. Skip branch (line 168):

```ts
        scope.emit({ type: 'step-skipped', stepId: step.id, instanceId });
```

Cached done (line 210):

```ts
      scope.emit({ type: 'step-done', stepId: step.id, instanceId, output: cached.output, cached: true });
```

Start (line 215):

```ts
    scope.emit({ type: 'step-start', stepId: step.id, instanceId, parentId, kind });
```

Done (line 266):

```ts
      scope.emit({ type: 'step-done', stepId: step.id, instanceId, output: res.output, cached: false });
```

Error (line 277):

```ts
      scope.emit({ type: 'step-error', stepId: step.id, instanceId, error: message });
```

`journalKey` (line 203) is now redundant with `instanceId`; replace its declaration `const journalKey = \`${scope.journalPath}/${step.id}\`;` with `const journalKey = instanceId;` to keep the rest of the function unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/core test -- identity`
Expected: PASS.

- [ ] **Step 6: Run the full core suite to catch consumers**

Run: `pnpm --filter @plyflow/core test`
Expected: PASS. If any existing test constructs/asserts `EngineEvent` objects, add the new required fields there (mechanical).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/core/engine.ts packages/core/src/core/exec.ts packages/core/src/index.ts packages/core/src/core/identity.test.ts
git commit -m "feat(core): add instanceId/parentId/kind to engine events"
```

---

## Task 2: `AgentChunk` type + `agent-stream` event + exec translation

**Files:**
- Modify: `packages/core/src/core/engine.ts` (add `AgentChunk`, add `agent-stream` variant)
- Modify: `packages/core/src/steps/types.ts` (`StepEvent` `output.chunk` → `AgentChunk`)
- Modify: `packages/core/src/core/exec.ts` (`ctx.emit` handles `output`)
- Modify: `packages/core/src/index.ts` (re-export `AgentChunk`)
- Test: `packages/core/src/core/agent-stream.test.ts` *(new)*

**Interfaces:**
- Consumes: `instanceId` from Task 1.
- Produces: `AgentChunk` union; `EngineEvent` gains `{ type: 'agent-stream'; stepId; instanceId; chunk: AgentChunk }`; `StepEvent` `output` arm is `{ type: 'output'; chunk: AgentChunk }`. A step calling `ctx.emit({ type: 'output', chunk })` produces an `agent-stream` engine event for that step's `instanceId`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/core/agent-stream.test.ts`. Register a one-off step type that emits an `output` chunk, run it, and assert an `agent-stream` event with the right `instanceId` + chunk.

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow, type EngineEvent } from './engine.js';
import { buildDefaultRegistry } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import type { StepType } from '../steps/types.js';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const emittingStep: StepType<{ id: string }> = {
  name: 'emitter',
  match: (def) => (def as Record<string, unknown>).emitter !== undefined,
  parse: (def) => ({ id: def.id }),
  run: async (_cfg, ctx) => {
    ctx.emit({ type: 'output', chunk: { t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' } });
    ctx.emit({ type: 'output', chunk: { t: 'result', tokens: 42 } });
    return { output: 'ok' };
  },
};

describe('agent-stream translation', () => {
  it('turns ctx.emit output chunks into agent-stream engine events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plyflow-as-'));
    const wfPath = join(dir, 'wf.yaml');
    await writeFile(wfPath, `name: as\nphases:\n  - name: P\n    steps:\n      - id: e\n        emitter: true\n`);
    const reg = buildDefaultRegistry();
    reg.register(emittingStep);

    const events: EngineEvent[] = [];
    await runWorkflow(wfPath, {
      provider: new FakeProvider({}),
      registry: reg,
      isTty: false,
      runDir: join(dir, 'runs'),
      onEvent: (e) => events.push(e),
    });

    const streams = events.filter((e) => e.type === 'agent-stream') as Extract<EngineEvent, { type: 'agent-stream' }>[];
    expect(streams).toHaveLength(2);
    expect(streams[0].instanceId).toBe('phase:P/e');
    expect(streams[0].chunk).toEqual({ t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' });
    expect(streams[1].chunk).toEqual({ t: 'result', tokens: 42 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @plyflow/core test -- agent-stream`
Expected: FAIL — no `agent-stream` events are produced (and a TS error that `chunk` must be a `string`).

- [ ] **Step 3: Add `AgentChunk` + the `agent-stream` variant**

In `packages/core/src/core/engine.ts`, add above `EngineEvent`:

```ts
export type AgentChunk =
  | { t: 'tool_use'; name: string; summary: string }
  | { t: 'tool_result'; ok: boolean; summary: string }
  | { t: 'assistant'; text: string }
  | { t: 'thinking'; text: string }
  | { t: 'result'; tokens?: number }
  | { t: 'raw'; text: string };
```

Add this variant to the `EngineEvent` union:

```ts
  | { type: 'agent-stream'; stepId: string; instanceId: string; chunk: AgentChunk };
```

Then re-export `AgentChunk` from `packages/core/src/index.ts` (the TUI imports it as a type from `@plyflow/core`). Extend the engine type export line (already carries `StepKind` from Task 1):

```ts
export type { EngineEvent, RunOptions, StepKind, AgentChunk } from './core/engine.js';
```

- [ ] **Step 4: Update `StepEvent` to carry an `AgentChunk`**

In `packages/core/src/steps/types.ts`, change the `output` arm (line 8) and import the type:

```ts
import type { StepDef } from '../core/types.js';
import type { AIProvider } from '../providers/types.js';
import type { AgentChunk } from '../core/engine.js';

export type StepEvent =
  | { type: 'log'; message: string }
  | { type: 'output'; chunk: AgentChunk };
```

- [ ] **Step 5: Translate `output` events in `exec.ts`**

In `packages/core/src/core/exec.ts`, extend the `ctx.emit` handler (currently only handles `log`, lines 239–243):

```ts
      emit: (ev) => {
        if (ev.type === 'log') {
          scope.emit({ type: 'step-log', stepId: step.id, instanceId, message: ev.message });
        } else if (ev.type === 'output') {
          scope.emit({ type: 'agent-stream', stepId: step.id, instanceId, chunk: ev.chunk });
        }
      },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/core test -- agent-stream`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/core/engine.ts packages/core/src/steps/types.ts packages/core/src/core/exec.ts packages/core/src/index.ts packages/core/src/core/agent-stream.test.ts
git commit -m "feat(core): add AgentChunk + agent-stream event translation"
```

---

## Task 3: Provider streaming (`onChunk`) + agent-sdk mapping

**Files:**
- Modify: `packages/core/src/providers/types.ts` (`AICompleteRequest.onChunk?`)
- Create: `packages/core/src/providers/agent-sdk-chunks.ts` (`messageToChunk`)
- Test: `packages/core/src/providers/agent-sdk-chunks.test.ts` *(new)*
- Modify: `packages/core/src/providers/claude.ts` (call `onChunk` in the agent-sdk loop)
- Modify: `packages/core/src/steps/agent.ts` (pass `onChunk` → `ctx.emit({ type: 'output' })`)

**Interfaces:**
- Consumes: `AgentChunk` (Task 2), `ctx.emit` output (Task 2).
- Produces: `AICompleteRequest.onChunk?: (c: AgentChunk) => void`; `messageToChunk(message: SDKMessage): AgentChunk | null` (returns `null` for messages with no user-visible chunk). The agent step passes `onChunk: (c) => ctx.emit({ type: 'output', chunk: c })`.

- [ ] **Step 1: Write the failing test for the pure mapping**

Create `packages/core/src/providers/agent-sdk-chunks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { messageToChunk } from './agent-sdk-chunks.js';

describe('messageToChunk', () => {
  it('maps an assistant tool_use block to a tool_use chunk', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/scheduler.ts' } }] } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'tool_use', name: 'Edit', summary: 'src/scheduler.ts' });
  });

  it('maps assistant text to an assistant chunk', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'text', text: 'fixed the bug' }] } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'assistant', text: 'fixed the bug' });
  });

  it('maps a user tool_result block to a tool_result chunk', () => {
    const msg = { type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: '41 passed' }] } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'tool_result', ok: true, summary: '41 passed' });
  });

  it('maps a result message to a result chunk with tokens', () => {
    const msg = { type: 'result', usage: { output_tokens: 1240 } };
    expect(messageToChunk(msg as never)).toEqual({ t: 'result', tokens: 1240 });
  });

  it('returns null for system/unknown messages', () => {
    expect(messageToChunk({ type: 'system' } as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @plyflow/core test -- agent-sdk-chunks`
Expected: FAIL — `messageToChunk` does not exist.

- [ ] **Step 3: Implement `messageToChunk`**

Create `packages/core/src/providers/agent-sdk-chunks.ts`:

```ts
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentChunk } from '../core/engine.js';

/** Short, human-readable summary of a tool_use input (file path or first arg). */
function summarizeToolInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['file_path', 'path', 'command', 'pattern', 'query']) {
      if (typeof o[k] === 'string') return o[k] as string;
    }
  }
  return '';
}

/** Truncate multi-line/long tool results to a single short line. */
function summarizeResult(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const firstLine = text.split('\n', 1)[0] ?? '';
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
}

/**
 * Map one agent-sdk message to a single display chunk, or null when the message
 * carries nothing user-visible. Only the first relevant content block is mapped;
 * the SDK emits one logical action per assistant/user message in practice.
 */
export function messageToChunk(message: SDKMessage): AgentChunk | null {
  const m = message as unknown as { type: string; message?: { content?: unknown[] }; usage?: { output_tokens?: number } };

  if (m.type === 'assistant') {
    const blocks = m.message?.content ?? [];
    const tool = blocks.find((b) => (b as { type?: string }).type === 'tool_use') as { name?: string; input?: unknown } | undefined;
    if (tool) return { t: 'tool_use', name: tool.name ?? 'tool', summary: summarizeToolInput(tool.input) };
    const text = blocks.find((b) => (b as { type?: string }).type === 'text') as { text?: string } | undefined;
    if (text?.text) return { t: 'assistant', text: text.text };
    return null;
  }

  if (m.type === 'user') {
    const blocks = m.message?.content ?? [];
    const tr = blocks.find((b) => (b as { type?: string }).type === 'tool_result') as { is_error?: boolean; content?: unknown } | undefined;
    if (tr) return { t: 'tool_result', ok: !tr.is_error, summary: summarizeResult(tr.content) };
    return null;
  }

  if (m.type === 'result') {
    return { t: 'result', tokens: m.usage?.output_tokens };
  }

  return null;
}
```

- [ ] **Step 4: Run the mapping test to verify it passes**

Run: `pnpm --filter @plyflow/core test -- agent-sdk-chunks`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `onChunk` wiring**

Append to `packages/core/src/providers/agent-sdk-chunks.test.ts` (drives a fake agent-sdk stream through the provider and asserts `onChunk` fires):

```ts
import { ClaudeProvider } from './claude.js';

describe('ClaudeProvider onChunk (agent-sdk mode)', () => {
  it('calls onChunk for each streamed message that maps to a chunk', async () => {
    async function* fakeQuery() {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } } as never;
      yield { type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: '41 passed' }] } } as never;
      yield { type: 'result', result: 'done', usage: { output_tokens: 7 } } as never;
    }
    const provider = new ClaudeProvider({ mode: 'agent-sdk', agentQuery: fakeQuery as never });
    const chunks: unknown[] = [];
    const res = await provider.complete({
      system: 's', prompt: 'p', model: 'm',
      onChunk: (c) => chunks.push(c),
    });
    expect(chunks).toEqual([
      { t: 'tool_use', name: 'Bash', summary: 'npm test' },
      { t: 'tool_result', ok: true, summary: '41 passed' },
      { t: 'result', tokens: 7 },
    ]);
    expect(res.text).toBe('done');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @plyflow/core test -- agent-sdk-chunks`
Expected: FAIL — `onChunk` is not a known property / not invoked.

- [ ] **Step 7: Add `onChunk` to the request type**

In `packages/core/src/providers/types.ts`, import `AgentChunk` and add the field:

```ts
import type { AgentChunk } from '../core/engine.js';

export interface AICompleteRequest {
  system: string;
  prompt: string;
  model: string;
  mode?: string;
  params?: Record<string, unknown>;
  outputSchema?: JsonSchema;
  /** Optional live-streaming callback; called per agent message that maps to a chunk. */
  onChunk?: (chunk: AgentChunk) => void;
}
```

- [ ] **Step 8: Call `onChunk` in the agent-sdk loop**

In `packages/core/src/providers/claude.ts`, add the import and call `messageToChunk` inside the existing `for await` loop (~lines 127–133):

```ts
import { messageToChunk } from './agent-sdk-chunks.js';
```

```ts
    for await (const message of stream) {
      if (req.onChunk) {
        const chunk = messageToChunk(message);
        if (chunk) req.onChunk(chunk);
      }
      if (message.type === 'assistant') {
        lastAssistantMessage = message;
      } else if (message.type === 'result') {
        resultMessage = message as SDKMessage & { type: 'result' };
      }
    }
```

- [ ] **Step 9: Wire `onChunk` from the agent step**

In `packages/core/src/steps/agent.ts`, add `onChunk` to the `ctx.provider.complete({...})` call (~line 32):

```ts
    const result = await ctx.provider.complete({
      system: agent.systemPrompt,
      prompt: cfg.prompt,
      model: cfg.model ?? agent.config.model,
      mode: cfg.mode ?? agent.config.mode,
      params: {
        temperature: agent.config.temperature,
        ...cfg.params,
      },
      outputSchema: schema?.jsonSchema,
      onChunk: (chunk) => ctx.emit({ type: 'output', chunk }),
    });
```

- [ ] **Step 10: Run the provider + agent suites to verify they pass**

Run: `pnpm --filter @plyflow/core test -- agent-sdk-chunks claude agent`
Expected: PASS (existing claude/agent tests unaffected — `onChunk` is optional).

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/providers/types.ts packages/core/src/providers/agent-sdk-chunks.ts packages/core/src/providers/agent-sdk-chunks.test.ts packages/core/src/providers/claude.ts packages/core/src/steps/agent.ts
git commit -m "feat(core): stream agent-sdk messages as AgentChunks via onChunk"
```

---

## Task 4: Non-TTY `LineLogger` streams activity

**Files:**
- Modify: `packages/tui/src/logger.ts`
- Test: `packages/tui/src/logger.test.ts` (extend existing)

**Interfaces:**
- Consumes: `EngineEvent` (now with `instanceId` + `agent-stream`).
- Produces: no new exports; `LineLogger.handle` additionally renders `agent-stream` and uses `instanceId` (trimmed of the leading `phase:` segment) as the line prefix.

- [ ] **Step 1: Write the failing test**

Add to `packages/tui/src/logger.test.ts`:

```ts
it('renders agent-stream chunks as instance-prefixed lines', () => {
  const lines: string[] = [];
  const logger = new LineLogger((l) => lines.push(l));
  logger.handle({ type: 'agent-stream', stepId: 'implement', instanceId: 'phase:Build/build/foreach:a/implement', chunk: { t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' } });
  logger.handle({ type: 'agent-stream', stepId: 'implement', instanceId: 'phase:Build/build/foreach:a/implement', chunk: { t: 'result', tokens: 1240 } });
  expect(lines).toEqual([
    '  Build/build/foreach:a/implement › Edit scheduler.ts',
    '  Build/build/foreach:a/implement ✓ done (1240 tok)',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @plyflow/tui test -- logger`
Expected: FAIL — `agent-stream` is unhandled; no lines pushed.

- [ ] **Step 3: Implement the `agent-stream` case**

In `packages/tui/src/logger.ts`, import `AgentChunk` and add a case + a formatter. Replace the file body with:

```ts
import type { EngineEvent, AgentChunk } from '@plyflow/core';

function trimPhase(instanceId: string): string {
  return instanceId.replace(/^phase:/, '');
}

function formatChunk(c: AgentChunk): string | null {
  switch (c.t) {
    case 'tool_use': return `› ${c.name} ${c.summary}`.trimEnd();
    case 'tool_result': return `${c.ok ? '✓' : '✗'} ${c.summary}`;
    case 'assistant': return `▸ ${c.text}`;
    case 'thinking': return null; // not surfaced in flat logs
    case 'result': return `✓ done${c.tokens !== undefined ? ` (${c.tokens} tok)` : ''}`;
    case 'raw': return c.text;
  }
}

export class LineLogger {
  constructor(private readonly write: (line: string) => void) {}

  handle(e: EngineEvent): void {
    switch (e.type) {
      case 'phase-start':
        this.write(`\n# ${e.phase}`);
        break;
      case 'step-start':
        this.write(`  → ${e.stepId}`);
        break;
      case 'step-done':
        this.write(`  ✓ ${e.stepId}${e.cached ? ' (cached)' : ''}`);
        break;
      case 'step-error':
        this.write(`  ✗ ${e.stepId}: ${e.error}`);
        break;
      case 'step-log':
        this.write(`    ${e.stepId}: ${e.message}`);
        break;
      case 'agent-stream': {
        const line = formatChunk(e.chunk);
        if (line !== null) this.write(`  ${trimPhase(e.instanceId)} ${line}`);
        break;
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/tui test -- logger`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/logger.ts packages/tui/src/logger.test.ts
git commit -m "feat(tui): stream agent activity in non-TTY LineLogger"
```

---

## Task 5: Run-model reducer

**Files:**
- Create: `packages/tui/src/run-model.ts`
- Test: `packages/tui/src/run-model.test.ts` *(new)*

**Interfaces:**
- Consumes: `EngineEvent`, `AgentChunk`, `StepKind` from `@plyflow/core`.
- Produces:
  - `interface AgentInstance { instanceId; parentId; stepId; kind; status; label; depth; buffer: AgentChunk[]; trimmed: boolean; output?: unknown; tokens?: number }`
  - `interface RunModel { order: string[]; byId: Map<string, AgentInstance>; phases: string[] }`
  - `createRunModel(): RunModel`
  - `applyEvent(model: RunModel, e: EngineEvent): RunModel` (returns a new model; pure)
  - `deriveLabel(instanceId: string, stepId: string): string`
  - `const MAX_BUFFER = 500`

- [ ] **Step 1: Write the failing tests**

Create `packages/tui/src/run-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRunModel, applyEvent, deriveLabel, MAX_BUFFER } from './run-model.js';
import type { EngineEvent } from '@plyflow/core';

function apply(events: EngineEvent[]) {
  return events.reduce(applyEvent, createRunModel());
}

describe('deriveLabel', () => {
  it('uses the stepId alone when there is no foreach/loop key', () => {
    expect(deriveLabel('phase:Build/build', 'build')).toBe('build');
  });
  it('appends the nearest foreach key in brackets', () => {
    expect(deriveLabel('phase:Build/build/foreach:task_2/implement', 'implement')).toBe('implement[task_2]');
  });
  it('appends the nearest loop iteration', () => {
    expect(deriveLabel('phase:Build/x/loop:1/verify', 'verify')).toBe('verify[1]');
  });
});

describe('applyEvent', () => {
  it('inserts a running instance on step-start with derived label, kind, depth', () => {
    const m = apply([
      { type: 'phase-start', phase: 'Build' },
      { type: 'step-start', stepId: 'implement', instanceId: 'phase:Build/build/foreach:task_2/implement', parentId: 'phase:Build/build/foreach:task_2', kind: 'agent' },
    ]);
    const inst = m.byId.get('phase:Build/build/foreach:task_2/implement')!;
    expect(inst.status).toBe('running');
    expect(inst.kind).toBe('agent');
    expect(inst.label).toBe('implement[task_2]');
    expect(inst.depth).toBe(3); // segments after the phase root
    expect(m.phases).toEqual(['Build']);
    expect(m.order).toContain(inst.instanceId);
  });

  it('appends agent-stream chunks to the matching instance buffer', () => {
    const id = 'phase:P/a';
    const m = apply([
      { type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'agent' },
      { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'tool_use', name: 'Edit', summary: 'x.ts' } },
      { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'assistant', text: 'done' } },
    ]);
    expect(m.byId.get(id)!.buffer).toEqual([
      { t: 'tool_use', name: 'Edit', summary: 'x.ts' },
      { t: 'assistant', text: 'done' },
    ]);
  });

  it('retains the buffer and sets terminal status + tokens on step-done', () => {
    const id = 'phase:P/a';
    const m = apply([
      { type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'agent' },
      { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'result', tokens: 99 } },
      { type: 'step-done', stepId: 'a', instanceId: id, output: 'r', cached: false },
    ]);
    const inst = m.byId.get(id)!;
    expect(inst.status).toBe('done');
    expect(inst.output).toBe('r');
    expect(inst.tokens).toBe(99);
    expect(inst.buffer).toHaveLength(1); // retained, not cleared
  });

  it('marks error status on step-error', () => {
    const id = 'phase:P/a';
    const m = apply([
      { type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'sh' },
      { type: 'step-error', stepId: 'a', instanceId: id, error: 'boom' },
    ]);
    expect(m.byId.get(id)!.status).toBe('error');
  });

  it('ring-caps the buffer at MAX_BUFFER and sets trimmed', () => {
    const id = 'phase:P/a';
    let m = apply([{ type: 'step-start', stepId: 'a', instanceId: id, parentId: 'phase:P', kind: 'agent' }]);
    for (let i = 0; i < MAX_BUFFER + 10; i++) {
      m = applyEvent(m, { type: 'agent-stream', stepId: 'a', instanceId: id, chunk: { t: 'raw', text: `line ${i}` } });
    }
    const inst = m.byId.get(id)!;
    expect(inst.buffer).toHaveLength(MAX_BUFFER);
    expect(inst.trimmed).toBe(true);
    expect((inst.buffer[inst.buffer.length - 1] as { text: string }).text).toBe(`line ${MAX_BUFFER + 9}`);
  });

  it('orders foreach children immediately after their parent step', () => {
    const m = apply([
      { type: 'phase-start', phase: 'P' },
      { type: 'step-start', stepId: 'build', instanceId: 'phase:P/build', parentId: 'phase:P', kind: 'foreach' },
      { type: 'step-start', stepId: 'after', instanceId: 'phase:P/after', parentId: 'phase:P', kind: 'run' },
      { type: 'step-start', stepId: 'work', instanceId: 'phase:P/build/foreach:a/work', parentId: 'phase:P/build/foreach:a', kind: 'agent' },
    ]);
    // 'work' (descendant of build) must sort before 'after', not at the end.
    expect(m.order).toEqual(['phase:P/build', 'phase:P/build/foreach:a/work', 'phase:P/after']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @plyflow/tui test -- run-model`
Expected: FAIL — `./run-model.js` does not exist.

- [ ] **Step 3: Implement the reducer**

Create `packages/tui/src/run-model.ts`:

```ts
import type { EngineEvent, AgentChunk, StepKind } from '@plyflow/core';

export const MAX_BUFFER = 500;

export interface AgentInstance {
  instanceId: string;
  parentId: string | null;
  stepId: string;
  kind: StepKind;
  status: 'pending' | 'running' | 'done' | 'error';
  label: string;
  depth: number;
  buffer: AgentChunk[];
  trimmed: boolean;
  output?: unknown;
  tokens?: number;
}

export interface RunModel {
  order: string[];
  byId: Map<string, AgentInstance>;
  phases: string[];
}

export function createRunModel(): RunModel {
  return { order: [], byId: new Map(), phases: [] };
}

/** Path depth relative to the `phase:<name>` root (the phase segment is depth 0). */
function depthOf(instanceId: string): number {
  return instanceId.split('/').length - 1;
}

/** Label = stepId, with the nearest enclosing foreach/loop key in brackets. */
export function deriveLabel(instanceId: string, stepId: string): string {
  const segs = instanceId.split('/');
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.startsWith('foreach:')) return `${stepId}[${s.slice('foreach:'.length)}]`;
    if (s.startsWith('loop:')) return `${stepId}[${s.slice('loop:'.length)}]`;
  }
  return stepId;
}

/** Insert id so descendants cluster directly after their nearest ancestor already in `order`. */
function insertOrdered(order: string[], id: string): string[] {
  // Find the deepest existing entry that is a prefix-ancestor of id; insert after its subtree.
  let insertAt = order.length;
  let bestAncestorIdx = -1;
  for (let i = 0; i < order.length; i++) {
    if (id.startsWith(order[i] + '/')) bestAncestorIdx = i;
  }
  if (bestAncestorIdx >= 0) {
    const ancestor = order[bestAncestorIdx];
    insertAt = bestAncestorIdx + 1;
    while (insertAt < order.length && order[insertAt].startsWith(ancestor + '/')) insertAt++;
  }
  return [...order.slice(0, insertAt), id, ...order.slice(insertAt)];
}

function cloneModel(m: RunModel): RunModel {
  return { order: m.order, byId: new Map(m.byId), phases: m.phases };
}

function upsert(m: RunModel, id: string, patch: Partial<AgentInstance>, base?: AgentInstance): RunModel {
  const next = cloneModel(m);
  const existing = next.byId.get(id) ?? base;
  if (!existing) return m; // event for an unknown instance with no base; ignore
  next.byId.set(id, { ...existing, ...patch });
  return next;
}

export function applyEvent(model: RunModel, e: EngineEvent): RunModel {
  switch (e.type) {
    case 'phase-start': {
      if (model.phases.includes(e.phase)) return model;
      return { ...cloneModel(model), phases: [...model.phases, e.phase] };
    }
    case 'step-start': {
      const inst: AgentInstance = {
        instanceId: e.instanceId,
        parentId: e.parentId,
        stepId: e.stepId,
        kind: e.kind,
        status: 'running',
        label: deriveLabel(e.instanceId, e.stepId),
        depth: depthOf(e.instanceId),
        buffer: [],
        trimmed: false,
      };
      const next = cloneModel(model);
      next.byId = new Map(model.byId);
      next.byId.set(e.instanceId, inst);
      next.order = model.byId.has(e.instanceId) ? model.order : insertOrdered(model.order, e.instanceId);
      return next;
    }
    case 'agent-stream': {
      const existing = model.byId.get(e.instanceId);
      if (!existing) return model;
      let buffer = [...existing.buffer, e.chunk];
      let trimmed = existing.trimmed;
      if (buffer.length > MAX_BUFFER) {
        buffer = buffer.slice(buffer.length - MAX_BUFFER);
        trimmed = true;
      }
      const tokens = e.chunk.t === 'result' && e.chunk.tokens !== undefined ? e.chunk.tokens : existing.tokens;
      return upsert(model, e.instanceId, { buffer, trimmed, tokens });
    }
    case 'step-done':
      return upsert(model, e.instanceId, { status: 'done', output: e.output });
    case 'step-error':
      return upsert(model, e.instanceId, { status: 'error' });
    case 'step-skipped':
      return model;
    case 'step-log':
      return model;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @plyflow/tui test -- run-model`
Expected: PASS (all cases, including ordering and ring-cap).

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/run-model.ts packages/tui/src/run-model.test.ts
git commit -m "feat(tui): pure run-model reducer with retained bounded buffers"
```

---

## Task 6: Shared status maps, chunk renderers, split-pane render

**Files:**
- Create: `packages/tui/src/status.ts`
- Create: `packages/tui/src/chunk-renderers.tsx`
- Create: `packages/tui/src/RunView.tsx`
- Modify: `packages/tui/src/ProgressTree.tsx` (import shared maps)
- Test: `packages/tui/src/chunk-renderers.test.tsx` *(new)*, `packages/tui/src/RunView.test.tsx` *(new)*

**Interfaces:**
- Consumes: `RunModel`, `AgentInstance` (Task 5), `AgentChunk` (core).
- Produces:
  - `status.ts`: `export const glyph: Record<Status, string>`, `export const color: Record<Status, string>`, `export type Status = 'pending'|'running'|'done'|'error'`.
  - `chunk-renderers.tsx`: `export function ChunkLine({ chunk }: { chunk: AgentChunk }): React.ReactElement`.
  - `RunView.tsx`: `export function RunView({ model, cursorId, focus, scrollOffset, width }: RunViewProps): React.ReactElement` (pure presentational; navigation state passed in — Task 7 owns the state).

- [ ] **Step 1: Write the failing chunk-renderer test**

Create `packages/tui/src/chunk-renderers.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ChunkLine } from './chunk-renderers.js';

describe('ChunkLine', () => {
  it('renders a tool_use as "> name summary"', () => {
    const { lastFrame } = render(<ChunkLine chunk={{ t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' }} />);
    expect(lastFrame()).toContain('> Edit scheduler.ts');
  });
  it('renders a result with token count', () => {
    const { lastFrame } = render(<ChunkLine chunk={{ t: 'result', tokens: 1240 }} />);
    expect(lastFrame()).toContain('✓ done (1240 tok)');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @plyflow/tui test -- chunk-renderers`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `status.ts` and `chunk-renderers.tsx`**

Create `packages/tui/src/status.ts`:

```ts
export type Status = 'pending' | 'running' | 'done' | 'error';

export const glyph: Record<Status, string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  error: '✗',
};

export const color: Record<Status, string> = {
  pending: 'gray',
  running: 'cyan',
  done: 'green',
  error: 'red',
};
```

Create `packages/tui/src/chunk-renderers.tsx`:

```tsx
import React from 'react';
import { Text } from 'ink';
import type { AgentChunk } from '@plyflow/core';

export function ChunkLine({ chunk: c }: { chunk: AgentChunk }): React.ReactElement {
  switch (c.t) {
    case 'tool_use':
      return <Text color="cyan">{`> ${c.name} ${c.summary}`.trimEnd()}</Text>;
    case 'tool_result':
      return <Text color={c.ok ? 'green' : 'red'}>{`  ${c.ok ? '✓' : '✗'} ${c.summary}`}</Text>;
    case 'assistant':
      return <Text>{`▸ ${c.text}`}</Text>;
    case 'thinking':
      return <Text dimColor>{`· ${c.text}`}</Text>;
    case 'result':
      return <Text color="green">{`✓ done${c.tokens !== undefined ? ` (${c.tokens} tok)` : ''}`}</Text>;
    case 'raw':
      return <Text>{c.text}</Text>;
  }
}
```

- [ ] **Step 4: Update `ProgressTree.tsx` to use shared maps**

In `packages/tui/src/ProgressTree.tsx`, delete its local `glyph`/`color` consts (lines 14–27) and import them:

```tsx
import { glyph, color } from './status.js';
```

(Keep `StepView`/`PhaseView` exports and the JSX unchanged.)

- [ ] **Step 5: Run chunk-renderer test to verify it passes**

Run: `pnpm --filter @plyflow/tui test -- chunk-renderers`
Expected: PASS.

- [ ] **Step 6: Write the failing RunView test**

Create `packages/tui/src/RunView.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { RunView } from './RunView.js';
import { createRunModel, applyEvent } from './run-model.js';
import type { EngineEvent } from '@plyflow/core';

function build(events: EngineEvent[]) {
  return events.reduce(applyEvent, createRunModel());
}

describe('RunView', () => {
  const model = build([
    { type: 'phase-start', phase: 'Build' },
    { type: 'step-start', stepId: 'task', instanceId: 'phase:Build/task', parentId: 'phase:Build', kind: 'agent' },
    { type: 'agent-stream', stepId: 'task', instanceId: 'phase:Build/task', chunk: { t: 'tool_use', name: 'Edit', summary: 'a.ts' } },
  ]);

  it('lists steps in the selector with the phase header and a cursor marker', () => {
    const { lastFrame } = render(
      <RunView model={model} cursorId="phase:Build/task" focus="selector" scrollOffset={0} width={100} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Build');
    expect(frame).toContain('› ◐ task');
  });

  it('streams the focused instance buffer in the detail pane', () => {
    const { lastFrame } = render(
      <RunView model={model} cursorId="phase:Build/task" focus="detail" scrollOffset={0} width={100} />,
    );
    expect(lastFrame()).toContain('> Edit a.ts');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @plyflow/tui test -- RunView`
Expected: FAIL — `./RunView.js` missing.

- [ ] **Step 8: Implement `RunView.tsx`**

Create `packages/tui/src/RunView.tsx`:

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { glyph, color } from './status.js';
import { ChunkLine } from './chunk-renderers.js';
import type { RunModel, AgentInstance } from './run-model.js';

export interface RunViewProps {
  model: RunModel;
  cursorId: string | null;
  focus: 'selector' | 'detail';
  scrollOffset: number;
  width: number;
  /** Below this width the detail column is hidden (narrow-terminal collapse). */
  narrowWidth?: number;
}

const DETAIL_ROWS = 20;

function Selector({ model, cursorId }: { model: RunModel; cursorId: string | null }): React.ReactElement {
  // Render phase headers interleaved with their steps, in `order`.
  const rows: React.ReactElement[] = [];
  let lastPhase: string | null = null;
  for (const id of model.order) {
    const inst = model.byId.get(id);
    if (!inst) continue;
    const phase = id.replace(/^phase:/, '').split('/')[0];
    if (phase !== lastPhase) {
      rows.push(<Text key={`ph:${phase}`} bold>{phase}</Text>);
      lastPhase = phase;
    }
    const marker = id === cursorId ? '›' : ' ';
    const indent = '  '.repeat(inst.depth);
    rows.push(
      <Text key={id} color={color[inst.status]}>
        {`${marker} ${indent}${glyph[inst.status]} ${inst.label}`}
      </Text>,
    );
  }
  return <Box flexDirection="column">{rows}</Box>;
}

function Detail({ inst, scrollOffset }: { inst: AgentInstance | undefined; scrollOffset: number }): React.ReactElement {
  if (!inst) return <Text dimColor>no selection</Text>;
  const header = (
    <Text bold>
      {inst.label} {glyph[inst.status]}
    </Text>
  );
  if (inst.kind !== 'agent' && inst.buffer.length === 0) {
    return (
      <Box flexDirection="column">
        {header}
        <Text>{typeof inst.output === 'string' ? inst.output : JSON.stringify(inst.output ?? '', null, 2)}</Text>
      </Box>
    );
  }
  const start = Math.max(0, inst.buffer.length - DETAIL_ROWS - scrollOffset);
  const visible = inst.buffer.slice(start, start + DETAIL_ROWS);
  return (
    <Box flexDirection="column">
      {header}
      {inst.trimmed && start === 0 ? <Text dimColor>…earlier output trimmed</Text> : null}
      {visible.map((c, i) => <ChunkLine key={start + i} chunk={c} />)}
    </Box>
  );
}

export function RunView({ model, cursorId, scrollOffset, width, narrowWidth = 80 }: RunViewProps): React.ReactElement {
  const inst = cursorId ? model.byId.get(cursorId) : undefined;
  if (width < narrowWidth) {
    // Narrow: selector only (detail opens as overlay — handled by App in Task 10).
    return <Selector model={model} cursorId={cursorId} />;
  }
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={Math.floor(width * 0.4)} marginRight={1}>
        <Selector model={model} cursorId={cursorId} />
      </Box>
      <Box flexDirection="column" flexGrow={1} borderStyle="single" borderLeft borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
        <Detail inst={inst} scrollOffset={scrollOffset} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 9: Run the RunView test to verify it passes**

Run: `pnpm --filter @plyflow/tui test -- RunView`
Expected: PASS. (If the border props render unexpected characters in `ink-testing-library`, simplify the detail `<Box>` to `paddingLeft={2}` with no border and assert again — the text-content assertions are what matter.)

- [ ] **Step 10: Commit**

```bash
git add packages/tui/src/status.ts packages/tui/src/chunk-renderers.tsx packages/tui/src/chunk-renderers.test.tsx packages/tui/src/RunView.tsx packages/tui/src/RunView.test.tsx packages/tui/src/ProgressTree.tsx
git commit -m "feat(tui): split-pane RunView with shared status maps + chunk renderers"
```

---

## Task 7: Navigation & focus state

**Files:**
- Create: `packages/tui/src/use-run-nav.ts`
- Test: `packages/tui/src/use-run-nav.test.tsx` *(new)*

**Interfaces:**
- Consumes: `RunModel` (Task 5).
- Produces: `useRunNav(model: RunModel, opts?: { onInput?: boolean }): { cursorId: string | null; focus: 'selector' | 'detail'; scrollOffset: number }`. The hook registers an Ink `useInput` handler: `↑/↓` move the cursor over `model.order` (selector focus) or change `scrollOffset` (detail focus); `Tab` toggles focus; `Enter` from selector switches focus to detail; `Esc` returns to selector. The cursor defaults to the first running instance, else the first instance.

- [ ] **Step 1: Write the failing test**

Create `packages/tui/src/use-run-nav.test.tsx`. A tiny harness component surfaces the hook's state as text so `ink-testing-library`'s `stdin.write` can drive keys.

```tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text } from 'ink';
import { useRunNav } from './use-run-nav.js';
import { createRunModel, applyEvent } from './run-model.js';
import type { EngineEvent } from '@plyflow/core';

const model = ([
  { type: 'phase-start', phase: 'P' },
  { type: 'step-start', stepId: 'a', instanceId: 'phase:P/a', parentId: 'phase:P', kind: 'agent' },
  { type: 'step-start', stepId: 'b', instanceId: 'phase:P/b', parentId: 'phase:P', kind: 'agent' },
] as EngineEvent[]).reduce(applyEvent, createRunModel());

function Harness(): React.ReactElement {
  const nav = useRunNav(model);
  return <Text>{`${nav.focus}:${nav.cursorId}:${nav.scrollOffset}`}</Text>;
}

const ARROW_DOWN = '[B';
const TAB = '\t';

describe('useRunNav', () => {
  it('starts on the first instance in selector focus', () => {
    const { lastFrame } = render(<Harness />);
    expect(lastFrame()).toBe('selector:phase:P/a:0');
  });

  it('moves the cursor down with the down arrow', async () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write(ARROW_DOWN);
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()).toBe('selector:phase:P/b:0');
  });

  it('Tab switches to detail focus', async () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write(TAB);
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()).toBe('detail:phase:P/a:0');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @plyflow/tui test -- use-run-nav`
Expected: FAIL — hook missing.

- [ ] **Step 3: Implement `useRunNav`**

Create `packages/tui/src/use-run-nav.ts`:

```ts
import { useState, useMemo } from 'react';
import { useInput } from 'ink';
import type { RunModel } from './run-model.js';

export interface RunNav {
  cursorId: string | null;
  focus: 'selector' | 'detail';
  scrollOffset: number;
}

export function useRunNav(model: RunModel): RunNav {
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [focus, setFocus] = useState<'selector' | 'detail'>('selector');
  const [scrollOffset, setScrollOffset] = useState(0);

  // Default cursor: first running instance, else first instance.
  const defaultId = useMemo(() => {
    const running = model.order.find((id) => model.byId.get(id)?.status === 'running');
    return running ?? model.order[0] ?? null;
  }, [model]);

  const effectiveCursor = cursorId ?? defaultId;

  useInput((_input, key) => {
    if (key.tab) {
      setFocus((f) => (f === 'selector' ? 'detail' : 'selector'));
      return;
    }
    if (key.escape) {
      setFocus('selector');
      return;
    }
    if (focus === 'selector') {
      if (key.return) { setFocus('detail'); return; }
      if (key.upArrow || key.downArrow) {
        const order = model.order;
        const idx = Math.max(0, order.indexOf(effectiveCursor ?? ''));
        const nextIdx = key.upArrow ? Math.max(0, idx - 1) : Math.min(order.length - 1, idx + 1);
        setCursorId(order[nextIdx] ?? null);
        setScrollOffset(0);
      }
    } else {
      if (key.upArrow) setScrollOffset((s) => s + 1);
      else if (key.downArrow) setScrollOffset((s) => Math.max(0, s - 1));
    }
  });

  return { cursorId: effectiveCursor, focus, scrollOffset };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/tui test -- use-run-nav`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/use-run-nav.ts packages/tui/src/use-run-nav.test.tsx
git commit -m "feat(tui): keyboard navigation + focus state for the run view"
```

---

## Task 8: Alternate screen buffer lifecycle

**Files:**
- Create: `packages/tui/src/use-altscreen.ts`
- Test: `packages/tui/src/use-altscreen.test.tsx` *(new)*

**Interfaces:**
- Produces: `useAltscreen(out?: { write(s: string): void; rows?: number; columns?: number; on?(ev: 'resize', cb: () => void): void; off?(ev: 'resize', cb: () => void): void }): { rows: number; columns: number }`. Defaults to `process.stdout`. On mount writes `\x1b[?1049h` (enter altscreen) + `\x1b[2J\x1b[H` (clear); on unmount writes `\x1b[?1049l` (restore). Subscribes to `resize` and returns current `{ rows, columns }`.

- [ ] **Step 1: Write the failing test**

Create `packages/tui/src/use-altscreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text } from 'ink';
import { useAltscreen } from './use-altscreen.js';

function makeFakeOut() {
  const writes: string[] = [];
  let resizeCb: (() => void) | null = null;
  return {
    writes,
    setSize(rows: number, columns: number) { this.rows = rows; this.columns = columns; },
    triggerResize() { resizeCb?.(); },
    rows: 24,
    columns: 100,
    write(s: string) { writes.push(s); },
    on(_ev: 'resize', cb: () => void) { resizeCb = cb; },
    off() { resizeCb = null; },
  };
}

function Harness({ out }: { out: ReturnType<typeof makeFakeOut> }): React.ReactElement {
  const { rows } = useAltscreen(out);
  return <Text>{`rows=${rows}`}</Text>;
}

describe('useAltscreen', () => {
  it('enters altscreen on mount and restores on unmount', () => {
    const out = makeFakeOut();
    const { unmount } = render(<Harness out={out} />);
    expect(out.writes.some((w) => w.includes('[?1049h'))).toBe(true);
    unmount();
    expect(out.writes.some((w) => w.includes('[?1049l'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @plyflow/tui test -- use-altscreen`
Expected: FAIL — hook missing.

- [ ] **Step 3: Implement `use-altscreen.ts`**

Create `packages/tui/src/use-altscreen.ts`:

```ts
import { useEffect, useState } from 'react';

interface OutLike {
  write(s: string): void;
  rows?: number;
  columns?: number;
  on?(ev: 'resize', cb: () => void): void;
  off?(ev: 'resize', cb: () => void): void;
}

const ENTER = '[?1049h[2J[H';
const RESTORE = '[?1049l';

export function useAltscreen(out: OutLike = process.stdout): { rows: number; columns: number } {
  const [size, setSize] = useState({ rows: out.rows ?? 24, columns: out.columns ?? 80 });

  useEffect(() => {
    out.write(ENTER);
    const onResize = () => setSize({ rows: out.rows ?? 24, columns: out.columns ?? 80 });
    out.on?.('resize', onResize);

    // Restore on hard exits too, so a crash never strands the user in altscreen.
    const restore = () => out.write(RESTORE);
    process.once('SIGINT', restore);
    process.once('exit', restore);

    return () => {
      out.off?.('resize', onResize);
      process.removeListener('SIGINT', restore);
      process.removeListener('exit', restore);
      out.write(RESTORE);
    };
  }, [out]);

  return size;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @plyflow/tui test -- use-altscreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/use-altscreen.ts packages/tui/src/use-altscreen.test.tsx
git commit -m "feat(tui): alternate screen buffer lifecycle hook"
```

---

## Task 9: Question modal

**Files:**
- Create: `packages/tui/src/QuestionModal.tsx`
- Test: `packages/tui/src/QuestionModal.test.tsx` *(new)*

**Interfaces:**
- Consumes: existing `Prompt` (`./prompts.js`) and `WidgetHost` — extract `WidgetHost` from `App.tsx` into its own file `packages/tui/src/WidgetHost.tsx` (move the component + `widgetCache` + `__clearWidgetCache` verbatim) so both `App` and `QuestionModal` can import it. `PendingUi` interface (`{ stepId; request: UiRequest; resolve }`) moves to `QuestionModal.tsx` and is exported.
- Produces: `export interface PendingUi { stepId: string; request: UiRequest; resolve: (v: unknown) => void }`; `export function QuestionModal({ pending }: { pending: PendingUi }): React.ReactElement` — renders the prompt/widget centered in a bordered box.

- [ ] **Step 1: Extract `WidgetHost` into its own module**

Create `packages/tui/src/WidgetHost.tsx` and move the `WidgetComponent` type, `widgetCache`, `__clearWidgetCache`, `WidgetHostProps`, and `WidgetHost` function out of `App.tsx` verbatim (keep the same exports). The imports at the top are exactly the loader/type imports the current `App.tsx` already uses — note `createLoader`/`DEFAULT_PROVIDED` come from the `@plyflow/core/module-loader` **subpath**, not the main index:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'ink';
import { createLoader, DEFAULT_PROVIDED } from '@plyflow/core/module-loader';
import type { UiRequest } from '@plyflow/core';
```

Export both `WidgetHost` and `__clearWidgetCache`. Then check `packages/tui/src/widget.test.tsx` — it currently imports `__clearWidgetCache` from `./App.js`; repoint that import to `./WidgetHost.js`. (Grep: `grep -rn __clearWidgetCache packages/tui/src` to catch every reference.)

- [ ] **Step 2: Write the failing modal test**

Create `packages/tui/src/QuestionModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { QuestionModal, type PendingUi } from './QuestionModal.js';

describe('QuestionModal', () => {
  it('renders a confirm prompt message inside the modal', () => {
    const pending: PendingUi = {
      stepId: 'ready',
      request: { kind: 'prompt', type: 'confirm', message: 'Proceed to liftoff?' },
      resolve: vi.fn(),
    };
    const { lastFrame } = render(<QuestionModal pending={pending} />);
    expect(lastFrame()).toContain('Proceed to liftoff?');
  });

  it('resolves with true when the user presses y', async () => {
    const resolve = vi.fn();
    const pending: PendingUi = {
      stepId: 'ready',
      request: { kind: 'prompt', type: 'confirm', message: 'ok?' },
      resolve,
    };
    const { stdin } = render(<QuestionModal pending={pending} />);
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 10));
    expect(resolve).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @plyflow/tui test -- QuestionModal`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `QuestionModal.tsx`**

Create `packages/tui/src/QuestionModal.tsx`:

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Prompt } from './prompts.js';
import { WidgetHost } from './WidgetHost.js';
import type { UiRequest, PromptRequest } from '@plyflow/core';

export interface PendingUi {
  stepId: string;
  request: UiRequest;
  resolve: (value: unknown) => void;
}

export function QuestionModal({ pending }: { pending: PendingUi }): React.ReactElement {
  const body =
    pending.request.kind === 'prompt' ? (
      <Prompt request={pending.request as PromptRequest} onResolve={pending.resolve} />
    ) : (
      <WidgetHost request={pending.request} onResolve={pending.resolve} />
    );
  return (
    <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1} flexDirection="column">
      <Text dimColor>question</Text>
      {body}
    </Box>
  );
}
```

> The widget/prompt components own their own `useInput`, so while the modal is mounted it captures keys — satisfying "modal captures focus." Background streaming continues because the engine never paused other branches; `App` (Task 10) keeps folding `agent-stream` events while the modal is up.

- [ ] **Step 5: Run the modal test to verify it passes**

Run: `pnpm --filter @plyflow/tui test -- QuestionModal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/WidgetHost.tsx packages/tui/src/QuestionModal.tsx packages/tui/src/QuestionModal.test.tsx
git commit -m "feat(tui): extract WidgetHost + add centered question modal"
```

---

## Task 10: Wire the App together

**Files:**
- Modify: `packages/tui/src/App.tsx`
- Test: `packages/tui/src/App.test.tsx` (extend existing)

**Interfaces:**
- Consumes: `applyEvent`/`createRunModel` (Task 5), `RunView` (Task 6), `useRunNav` (Task 7), `useAltscreen` (Task 8), `QuestionModal`/`PendingUi` (Task 9).
- Produces: the new `App` renders, inside an altscreen full-height box: `RunView` driven by the folded `RunModel` + `useRunNav` state, with a `QuestionModal` overlay when a question is pending. A `pending` **queue** (FIFO) renders one modal at a time. `App` exits when the event stream ends.

- [ ] **Step 1: Update the existing test's events, then add the streaming+modal test**

`App.test.tsx` already has one test ("calls onDone and renders done glyph") whose inline `async function* events()` yields hand-written events **without** `instanceId`/`parentId`/`kind`. After this task `App` renders `RunView`, which keys steps by `instanceId` — so those events must be updated or the step won't render. Change the two yields in that test to:

```tsx
      yield { type: 'step-start', stepId: 's', instanceId: 'phase:P/s', parentId: 'phase:P', kind: 'run' };
      await new Promise((r) => setTimeout(r, 5));
      yield { type: 'step-done', stepId: 's', instanceId: 'phase:P/s', output: 1, cached: false };
```

(The existing assertions `frame.toContain('s')` and `frame.toMatch(/✓/)` still hold — `RunView`'s selector renders `✓ s` for the done step.)

Add `UiRequest` to the file's type import:

```tsx
import type { EngineEvent, WorkflowFile, UiRequest } from '@plyflow/core';
```

Then add the new test. It mirrors the file's existing harness (inline `async function*` for `events`, `render(<App .../>)`, read `lastFrame`), and captures the `registerPrompt` handler so it can fire a between-stage question while agents stream:

```tsx
it('shows streaming agents in the split-pane and a modal when a question is pending', async () => {
  const wf: WorkflowFile = { name: 'demo', phases: [{ name: 'Build', steps: [{ id: 'astro', agent: 'a.md' }] }] };

  // Long-lived stream: emit the build events, then stay open so App does not
  // exit() before we assert (the generator ending triggers onDone()+exit()).
  async function* events(): AsyncGenerator<EngineEvent> {
    yield { type: 'phase-start', phase: 'Build' };
    yield { type: 'step-start', stepId: 'astro', instanceId: 'phase:Build/astro', parentId: 'phase:Build', kind: 'agent' };
    yield { type: 'agent-stream', stepId: 'astro', instanceId: 'phase:Build/astro', chunk: { t: 'tool_use', name: 'Edit', summary: 'scheduler.ts' } };
    await new Promise((r) => setTimeout(r, 300));
  }

  // Capture the handler App registers so we can trigger a question on demand.
  let handler: ((stepId: string, req: UiRequest) => Promise<unknown>) | null = null;
  const { lastFrame } = render(
    <App workflow={wf} events={events()} registerPrompt={(h) => { handler = h; }} onDone={() => {}} />,
  );

  await new Promise((r) => setTimeout(r, 30)); // let events fold in + handler register
  let resolved = false;
  handler!('ready', { kind: 'prompt', type: 'confirm', message: 'Proceed to liftoff?' }).then(() => { resolved = true; });
  await new Promise((r) => setTimeout(r, 30));

  const frame = lastFrame()!;
  expect(frame).toContain('astro');               // selector lists the streaming agent
  expect(frame).toContain('Proceed to liftoff?'); // modal overlaid while it streams
  expect(resolved).toBe(false);                    // still waiting on the user
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @plyflow/tui test -- App`
Expected: FAIL — the current `App` renders `ProgressTree`, not `RunView`/modal, and has no run-model.

- [ ] **Step 3: Rewrite `App.tsx`**

Replace `packages/tui/src/App.tsx` with:

```tsx
import React, { useEffect, useReducer, useState } from 'react';
import { Box, useApp } from 'ink';
import { RunView } from './RunView.js';
import { useRunNav } from './use-run-nav.js';
import { useAltscreen } from './use-altscreen.js';
import { QuestionModal, type PendingUi } from './QuestionModal.js';
import { applyEvent, createRunModel, type RunModel } from './run-model.js';
import type { EngineEvent, UiRequest } from '@plyflow/core';
import type { WorkflowFile } from '@plyflow/core';

export interface AppProps {
  workflow: WorkflowFile;
  events: AsyncIterable<EngineEvent>;
  registerPrompt: (handler: (stepId: string, req: UiRequest) => Promise<unknown>) => void;
  onDone: () => void;
}

export function App({ events, registerPrompt, onDone }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { rows, columns } = useAltscreen();
  const [model, dispatch] = useReducer(applyEvent, undefined, createRunModel) as [RunModel, (e: EngineEvent) => void];
  const [queue, setQueue] = useState<PendingUi[]>([]);
  const nav = useRunNav(model);

  useEffect(() => {
    registerPrompt(
      (stepId, request) =>
        new Promise((resolve) => {
          const entry: PendingUi = {
            stepId,
            request,
            resolve: (v) => {
              setQueue((q) => q.filter((e) => e !== entry));
              resolve(v);
            },
          };
          setQueue((q) => [...q, entry]);
        }),
    );
    (async () => {
      for await (const e of events) dispatch(e);
      onDone();
      exit();
    })();
  }, []);

  const pending = queue[0] ?? null;

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <RunView model={model} cursorId={nav.cursorId} focus={nav.focus} scrollOffset={nav.scrollOffset} width={columns} />
      {pending && <QuestionModal pending={pending} />}
    </Box>
  );
}
```

> `useReducer(applyEvent, …)` reuses the pure reducer directly — every event re-folds the model, and React re-renders `RunView`. Note `workflow` is no longer needed to seed a static tree (the tree is built live from events); the prop stays in `AppProps` for compatibility with the CLI caller.

- [ ] **Step 4: Run the App + full TUI suite to verify they pass**

Run: `pnpm --filter @plyflow/tui test`
Expected: PASS — including the existing "done glyph" test (its events were updated in Step 1 and it now reads `RunView` output) and the new streaming+modal test.

- [ ] **Step 5: Run the whole workspace gate**

Run: `pnpm -r test`
Expected: PASS across `@plyflow/core` and `@plyflow/tui`.

- [ ] **Step 6: Build to confirm no new type/bundling errors**

Run: `pnpm -r build`
Expected: SUCCESS (tsdown emits `dist/` for each package).

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/App.tsx packages/tui/src/App.test.tsx
git commit -m "feat(tui): live split-pane agent view with altscreen + question modal"
```

---

## Self-Review

**Spec coverage:**
- Core `instanceId`/`parentId`/`kind` → Task 1 ✓
- `agent-stream` + `AgentChunk` → Task 2 ✓
- Provider `onChunk` + agent-sdk mapping + raw fallback (`raw` arm rendered everywhere) → Task 3 ✓
- Non-TTY `LineLogger` enrichment → Task 4 ✓
- Run-model with retained bounded buffers + label derivation → Task 5 ✓
- Split-pane master/detail + structured feed + shared status maps → Task 6 ✓
- Keyboard nav/focus + responsive collapse (`narrowWidth` in RunView, selector-only branch) → Tasks 6–7 ✓
- Alternate screen buffer + robust teardown → Task 8 ✓
- Centered question modal reusing widget/prompt path + FIFO queue + background streaming → Tasks 9–10 ✓
- "No post-quit summary / replay out of scope" → honored (no summary printer in any task) ✓
- Cross-package type plumbing (`StepKind`/`AgentChunk` re-exported from core `index.ts`; loader via the `@plyflow/core/module-loader` subpath) → Tasks 1, 2, 9 ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code against the real merged tree.

**Type consistency:** `AgentChunk` shape identical across core (Task 2), provider mapping (Task 3), logger (Task 4), reducer (Task 5), renderers (Task 6). `RunModel`/`AgentInstance` field names (`order`, `byId`, `phases`, `buffer`, `trimmed`, `depth`, `label`, `tokens`) consistent across Tasks 5–7, 10. `useRunNav` return shape (`cursorId`/`focus`/`scrollOffset`) matches `RunView` props (Task 6) and App wiring (Task 10). `PendingUi` defined once (Task 9), imported by App (Task 10).

**Reconciliation (post Specs A & B merge) — both previously-flagged risks resolved:** the `instanceId` format `phase:<p>/<step>/foreach:<key>/<child>` is verified against `foreach.ts:129` + `exec.ts:90`; the `App.test.tsx` harness is matched to the real file (inline `async function*` + `lastFrame`, no `renderApp`/`tick` helpers); the `createLoader`/`DEFAULT_PROVIDED` import is corrected to the `@plyflow/core/module-loader` subpath; `StepKind`/`AgentChunk` re-exports are added to `index.ts:6`; and the pre-existing `App.test.tsx` events plus `widget.test.tsx`'s `__clearWidgetCache` import are updated for the new required fields/module. No predicted or unresolved anchors remain.
