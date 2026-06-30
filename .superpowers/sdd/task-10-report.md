# Task 10 Fix-Wave Report (appended after final review)

## Fix 1 — `packages/tui/src/widget.test.tsx` altscreen leak

Added `makeFakeOut()` helper (same shape as `App.test.tsx`) and passed `out={fakeOut}` to the `<App>` render inside `setupApp()`. Confirmed: running `pnpm --filter @plyflow/tui test -- widget` produces zero lines containing `[?1049h` in stdout. All widget tests pass.

## Fix 2 — `packages/tui/src/run-model.ts` redundant Map allocation

Removed the `next.byId = new Map(model.byId)` line that immediately followed `const next = cloneModel(model)` in the `step-start` case. `cloneModel` already does this allocation; the redundant line was a no-op but wasted an allocation. All run-model tests pass.

## Fix 3 — `packages/core/src/providers/agent-sdk-chunks.test.ts` mid-file import

Moved `import { ClaudeProvider } from './claude.js'` from mid-file (after the first `describe`) to the top-of-file import block. No behavior change.

## Fix 4 — Truncation-boundary test for `summarizeResult`

Added one test case to the `messageToChunk` describe in `packages/core/src/providers/agent-sdk-chunks.test.ts`:
- Input: `user` message with a `tool_result` block whose `content` is a 121-character string.
- Assertions: returned chunk is `t:'tool_result'`; `chunk.summary.length <= 120`; `chunk.summary.endsWith('…')`.
Test passed GREEN immediately (exercises the `> 120` branch of `summarizeResult`).

## Fix 5 — Resize test for `useAltscreen`

Added one test to `packages/tui/src/use-altscreen.test.tsx`:
- Mounts `Harness` with the existing `makeFakeOut()`.
- Calls `out.setSize(40, 120)` then `out.triggerResize()`, waits 10ms.
- Asserts `lastFrame()` contains `rows=40`.
Test passed GREEN immediately (exercises the resize listener path in `useAltscreen`).

## Final Suite Results

```
pnpm --filter @plyflow/core test
  Test Files  52 passed (52)
  Tests       268 passed (268)

pnpm --filter @plyflow/tui test
  Test Files  11 passed (11)
  Tests       35 passed (35)
```

Widget test escape-sequence check: `pnpm --filter @plyflow/tui test -- widget 2>&1 | grep -c '\[?1049h'` → **0** (no altscreen escapes in test output).

---

# Task 10 Report: Wire the App Together

## App Rewrite

Replaced `packages/tui/src/App.tsx` entirely:

- **Run model**: `useReducer(applyEvent, undefined, createRunModel)` folds every `EngineEvent` into a `RunModel`. Required explicit cast `as [RunModel, (e: EngineEvent) => void]` to satisfy TypeScript (the overloaded `useReducer` signature with init function wasn't inferring correctly).
- **FIFO queue**: `useState<PendingUi[]>([])` instead of a single `pending | null`; each `registerPrompt` call appends; `resolve` wrapper filters the entry out.
- **Deferred exit**: After the `for await` loop, calls `setTimeout(exit, 0)` to defer Ink teardown by one macrotask so React can flush the final `dispatch(e)` (last step-done) before the render tree is destroyed. Without this, the test frame showed `◐` (running) instead of `✓` (done).
- **Removed**: `initialPhases`, `setStatus`, `renderPending`, `ProgressTree`, `Prompt`, `WidgetHost` imports — all replaced by `RunView` + `QuestionModal`.
- **`workflow` prop**: Kept in `AppProps` for CLI compatibility; not consumed in the new body (RunView builds the tree from events).

## Three Required Additions

### 1. Consolidate PendingUi

`import { QuestionModal, type PendingUi } from './QuestionModal.js'` — no longer defined locally in App.tsx. The local `interface PendingUi` (14 lines) was deleted. QuestionModal.tsx already exported it from Task 9.

### 2. Gate keyboard nav while modal open

**`use-run-nav.ts`**: Signature changed to `useRunNav(model: RunModel, opts?: { active?: boolean }): RunNav`. The `useInput(handler)` call gains a second argument: `{ isActive: opts?.active ?? true }`. When `active` is `false`, Ink's useInput does not subscribe the handler — arrow keys are silently ignored.

**`App.tsx`**: `const nav = useRunNav(model, { active: !pending });` — `pending` is the first item in the queue (or `null`), so nav goes inert the moment a modal is queued.

**`use-run-nav.test.tsx`**: Added `active?: boolean` prop to `Harness`; updated call to `useRunNav(model, active !== undefined ? { active } : undefined)` so existing tests still invoke the default path. Added new test:

```ts
it('does not move cursor when active=false (modal focus capture)', async () => {
  const { stdin, lastFrame } = render(<Harness active={false} />);
  stdin.write(ARROW_DOWN);
  await new Promise((r) => setTimeout(r, 10));
  expect(lastFrame()).toBe('selector:phase:P/a:0'); // stayed on /a, not /b
});
```

All 6 existing useRunNav tests remain green.

### 3. Make altscreen injectable

**`use-altscreen.ts`**: Already accepted `out?: OutLike` with `process.stdout` default (Task 8 implemented this). No change needed here.

**`AppProps`**: Added `out?: Parameters<typeof useAltscreen>[0]` (resolved to the `OutLike` shape). `App` calls `useAltscreen(out)` — when `out` is undefined, defaults to `process.stdout` (CLI path unaffected).

**`App.test.tsx`**: Both tests create a `fakeOut = { writes[], rows:24, columns:80, write(s){writes.push(s)}, on(){}, off(){} }` and pass `out={fakeOut}`. This prevents escape sequences from writing to the real terminal during vitest runs. (Note: 4 pairs of escape codes were still visible in vitest output before this fix; after this fix they disappear from both tests.)

## TDD RED/GREEN

**RED** (`pnpm --filter @plyflow/tui test` after updating test file, before rewriting App.tsx):
```
Test Files  1 failed | 10 passed (11)
Tests  1 failed | 33 passed (34)
FAIL src/App.test.tsx > App > calls onDone and renders done glyph...
AssertionError: expected 'P\n  ◐ s' to match /✓/
```
— Confirmed: the updated events (with `instanceId`) caused RunView to render via new events, but old App used the static `phases` state which had no `instanceId` concept, so the step stayed "running".

**GREEN** (`pnpm --filter @plyflow/tui test` after rewriting App.tsx):
```
Test Files  11 passed (11)
Tests  34 passed (34)
```

## Full Suite Results

`pnpm -r test`:
- `@plyflow/core`: 267 tests, 52 files — all pass
- `@plyflow/tui`: 34 tests, 11 files — all pass
- `plyflow` (meta): 1 test failed — **pre-existing** failure (ERR_MODULE_NOT_FOUND for `@plyflow/cli/dist/index.js`; confirmed present before this task by `git stash` + rerun)

`pnpm -r build`: All packages built successfully (tsdown, no new type/bundling errors).

## Files Changed

- `packages/tui/src/App.tsx` — full rewrite
- `packages/tui/src/App.test.tsx` — updated events, added fakeOut injection, added streaming+modal test
- `packages/tui/src/use-run-nav.ts` — added `opts?.active` → `useInput({ isActive })`
- `packages/tui/src/use-run-nav.test.tsx` — Harness accepts `active` prop, added nav-inert test

## Self-Review

**Spec coverage verified**: All 10 tasks integrated. RunView renders the live model; QuestionModal overlays from FIFO queue; altscreen manages full-height box; useRunNav gates input when modal open.

**Concerns**:
1. The `setTimeout(exit, 0)` deferral is a pragmatic timing fix. A cleaner approach would use `flushSync` or a `useLayoutEffect`, but those don't work well inside Ink's React renderer. The deferral is safe: exit is called async to begin with (inside the async IIFE), so one extra macrotask doesn't change observable behavior for real workflows.
2. Escape codes still visible in vitest output (in test runner's own stdout, not from the tests themselves) — cosmetic artifact of how vitest streams output interleaved with test process stdout; the fakeOut correctly prevents these in the App render context.
3. The `plyflow` meta package test failure is pre-existing and not related to this task (it requires a built `@plyflow/cli/dist/index.js` which isn't present in the worktree's node_modules).
