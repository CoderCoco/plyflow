# Live Agent View & Interactive TUI — Design (Spec C)

**Date:** 2026-06-28
**Status:** Approved (design); implementation plan pending
**Depends on:** Spec A — `2026-06-28-monorepo-and-core-features-design.md`
(package split into `@plyflow/core` / `@plyflow/tui` / `@plyflow/cli`; and the
journal-key namespace that A3 sub-workflows extend). Built **after** the Spec A
monorepo split lands.

## Summary

Add a **live agent view** to the plyflow TUI: a split-pane master/detail screen
that lists every step in the run (the full phase/step tree), streams each agent's
structured activity into a detail pane as it works, retains finished agents'
output for in-app review, and renders between-stage questions as a centered modal
that captures keyboard focus while background agents keep streaming. The whole
view runs in the terminal's alternate screen buffer so it never clobbers the
user's scrollback or shell prompt.

The work splits cleanly across the post-Spec-A package seam:

- **`@plyflow/core`** gains two things on its existing event channel — a stable
  per-instance identity and a structured streaming variant — and otherwise stays
  the stateless, event-emitting engine it is today.
- **`@plyflow/tui`** owns all new statefulness: a live run-model folded from the
  event stream, bounded scrollback buffers, the split-pane layout + keyboard
  navigation, the alternate-screen lifecycle, and the question modal.
- **`@plyflow/cli`** is unchanged wiring — it already streams engine events into
  the Ink `App` and registers the prompt handler; it just passes the richer
  events through.

## Motivation

Running an advanced workflow like `examples/mission/` today shows only a static
phase → step tree with status glyphs:

```
Build
  ◐ build
Review
  ○ review
```

The mission's Build phase runs up to **5 astronaut agents concurrently** (a
`foreach … concurrency: 5`), and its Review phase runs **N inspector agents** in
parallel — but the user sees a single `◐ build` step and no output. The reported
pain, verbatim: *"it doesn't seem like it's doing a bunch of work and I can't see
the output."*

Three concrete facts in the current code block any fix:

1. **Agent output never leaves the provider.** Even agent-sdk mode iterates the
   full message generator internally (`providers/claude.ts:121`) and returns only
   the final text. The engine receives `{ output }`; there is no live output to
   show yet — it must be produced.
2. **Concurrent agents are indistinguishable in events.** `exec.ts` emits events
   with `stepId: step.id` — the *bare* id (`exec.ts:189,235`) — while the
   hierarchical path (`phase:build/foreach:task_2/implement`) is computed as
   `journalKey` (`exec.ts:177`) and used **only** for caching/resume, never in
   events. Five concurrent astronauts all emit `step-start{ stepId: 'implement' }`
   — the TUI cannot tell them apart, and foreach/loop children have no slot in the
   static tree at all.
3. **The widget host is single-slot and modal-less.** `pending` is one
   `PendingUi | null` (`App.tsx:120`); rendering is a flat `<ProgressTree/> +
   {pending}` with no focus management (`useFocus`/`useFocusManager` are unused),
   no scrollback, no view layering.

The load-bearing insight: the engine **already computes** the per-instance
hierarchical path it needs — it just discards it before emitting events. Spec C
surfaces that one existing primitive as `instanceId`, so identity, nesting
topology, resume, and the new UI all key off the same string. No parallel
identity scheme.

## Goals

- Surface a stable `instanceId` (the hierarchical journal path) plus `parentId`
  and `kind` on every engine event, so concurrent/nested steps are
  distinguishable and the dynamic tree (foreach/loop children) is reconstructable.
- Add one `agent-stream` engine event carrying a typed `AgentChunk` union, and an
  `onChunk` provider callback that streams agent-sdk messages live; CLI/API modes
  degrade to a raw-text arm.
- Keep `@plyflow/core` stateless and all existing event consumers
  (`LineLogger`, journal, current `App` handlers) working untouched (additive
  changes only).
- Render a split-pane master/detail TUI in the alternate screen buffer: full
  step tree on the left, focused agent's structured activity feed on the right,
  with keyboard navigation and scrollback.
- Retain finished agents' output for in-app review (bounded per-instance buffers).
- Present between-stage `input`/`widget` questions as a centered focus-capturing
  modal that reuses the existing prompt/widget engine path, while background
  agents keep streaming.
- Enrich `LineLogger` (non-TTY) to print streamed activity as flat,
  instance-prefixed lines.
- Preserve the ESM `.js`-extension convention, the vitest gate, and TDD workflow.

## Non-Goals (this spec)

- Replaying or browsing **past** runs after the app quits. The engine already
  persists run state to `.plyflow/runs/<runId>.json`; a "replay a past run"
  feature is explicitly future work. After-the-fact review in this spec means
  *in-app* review while the live view is open.
- Printing a post-quit summary to the normal terminal buffer. Review happens in
  the app; on exit we restore the user's terminal cleanly and print nothing.
- New provider modes or changes to provider auth.
- Changes to the DAG scheduler or the journal beyond reusing the path it already
  computes (and aligning with the Spec A3 sub-workflow namespace).
- A web UI or any non-terminal renderer (the stateless-core boundary keeps that
  option open later, but it is not built here).
- Mouse interaction; this is a keyboard-driven TUI.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sequencing vs Spec A | **Design now, build after the monorepo split** | Streaming crosses the `core`→`tui` package seam; born in the right packages avoids migration rework |
| Engine→TUI data model | **Evolve the existing `EngineEvent` union** (additive `instanceId`/`parentId`/`kind` + one `agent-stream` variant) | Least invasive to a stateless engine that already has the identity primitive; existing consumers ignore new field/variant; one channel, `instanceId` self-correlates |
| Where state lives | **TUI owns the run-model + buffers; core stays stateless** | Matches the repo's stateless-core convention; buffering only needed in the TTY consumer |
| Step identity | **`instanceId` = the hierarchical journal path** | Reuses the string the engine already computes for caching/resume; identity, nesting, resume, UI all agree |
| Interaction model | **Split-pane master/detail** | Always-visible output, scales to many concurrent agents, "more in-depth than Claude CLI's workflow view" |
| Stream content | **Structured activity feed** with a `raw` fallback arm | Legible tool-call/result/assistant feed in agent-sdk mode; CLI/API degrade to typewriter text in the same pane |
| Question UX | **Centered modal overlay; background agents keep streaming** | Clear "answer me now" semantics; reuses the existing widget/prompt path; engine never pauses other branches |
| Selector scope + history | **Full tree; retain finished output** in-app | Keeps the overview; directly fixes "I can't see what it did" via retained, selectable scrollback |
| Terminal hygiene | **Alternate screen buffer** (altscreen), clean restore on every exit path | Full-screen scrollable view must not clobber the user's shell scrollback/prompt |

---

## Part 1 — Core changes (`@plyflow/core`)

Two additive, backward-compatible changes to the event channel. Existing
consumers keep working by ignoring the new field/variant.

### C1. Stable identity on every event

Today `EngineEvent` carries `stepId: step.id` (bare, collision-prone). Add
`instanceId` — the hierarchical path the engine already computes as `journalKey`
— plus `parentId` and `kind` on `step-start` so the TUI can build the dynamic
tree without re-parsing path strings.

```ts
type StepKind =
  | 'agent' | 'sh' | 'run' | 'uses' | 'input'
  | 'widget' | 'parallel' | 'loop' | 'foreach' | 'step' | 'use';

type EngineEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'step-start';   instanceId: string; stepId: string; parentId: string | null; kind: StepKind }
  | { type: 'step-done';    instanceId: string; stepId: string; output: unknown; cached: boolean }
  | { type: 'step-error';   instanceId: string; stepId: string; error: string }
  | { type: 'step-log';     instanceId: string; stepId: string; message: string }
  | { type: 'step-skipped'; instanceId: string; stepId: string }
  | { type: 'agent-stream'; instanceId: string; stepId: string; chunk: AgentChunk }; // NEW
```

- `instanceId` is `${scope.journalPath}/${step.id}` — exactly the `journalKey`
  already computed at `exec.ts:177`. `parentId` is `scope.journalPath` (or `null`
  at the top level). Both are already in scope at every emit site, so the change
  is mechanical.
- `stepId` (bare) stays for back-compat and as the display-label base.
- This work must be **co-designed with the Spec A3 sub-workflow namespace**
  (`…/use:<id>/<child-step>`) so resume keying and the UI tree agree on one
  scheme.

### C2. Structured activity chunk + provider streaming

A new `agent-stream` variant carries a typed union mirroring agent-sdk's message
shapes, with a `raw` arm for degraded modes:

```ts
type AgentChunk =
  | { t: 'tool_use';    name: string; summary: string }   // "> Edit scheduler.ts"
  | { t: 'tool_result'; ok: boolean; summary: string }    // "  ✓ 41 passed"
  | { t: 'assistant';   text: string }                    // streamed assistant text
  | { t: 'thinking';    text: string }                    // streamed reasoning
  | { t: 'result';      tokens?: number }                 // terminal: "✓ done (1,240 tok)"
  | { t: 'raw';         text: string };                   // CLI/API typewriter fallback
```

- **Provider.** `AICompleteRequest` gains optional `onChunk?: (c: AgentChunk) =>
  void`. In agent-sdk mode the provider's existing `for await (const message of
  stream)` loop (`claude.ts:121`) maps each message to an `AgentChunk` and calls
  `onChunk` — it already iterates these messages and discards the intermediates
  today. CLI/API modes emit a single `{ t: 'raw' }` (or nothing) and rely on the
  final `result`.
- **Step → engine.** The agent step passes
  `onChunk: (c) => ctx.emit({ type: 'output', chunk: c })`, extending the
  **already-defined-but-unused** `StepEvent` `output` arm (`steps/types.ts:4`).
  `exec.ts` translates that `StepEvent` into an `agent-stream` `EngineEvent`
  (sibling to the existing `step-log` translation at `exec.ts:208–213`).

**Core footprint:** event-type edits, mechanical `exec.ts` emit changes, one
provider message→chunk mapping, one `StepEvent`→`EngineEvent` translation. No
store, no scheduler/journal redesign.

---

## Part 2 — TUI changes (`@plyflow/tui`)

Three independently testable units, plus the altscreen lifecycle.

### T1. The run-model (`useRunModel` reducer)

A pure reducer folds the `EngineEvent` stream into a normalized tree:

```ts
interface AgentInstance {
  instanceId: string;          // key
  parentId: string | null;
  stepId: string;              // display-label base
  kind: StepKind;
  status: 'pending' | 'running' | 'done' | 'error';
  label: string;               // derived, e.g. "astronaut[task_2]"
  buffer: AgentChunk[];        // bounded scrollback; meaningful for kind:'agent'
  output?: unknown;            // non-agent steps: shown on select
  tokens?: number;
}
type RunModel = { order: string[]; byId: Map<string, AgentInstance> };
```

- `step-start` inserts/links an instance under `parentId`; `agent-stream` appends
  to that instance's `buffer`; `step-done`/`step-error` set terminal status and
  `output`/`tokens`. Buffers are **retained** after completion.
- **Bounded memory:** each `buffer` is a ring capped at `N` chunks (default
  `N ≈ 500`) with an "…earlier output trimmed" marker. Tunable; documented. This
  is the only guard against a runaway agent flooding memory.
- **Label derivation:** a pure function maps the path's parent segment to a
  disambiguator — `phase:build/foreach:task_2/implement` → `astronaut[task_2]`
  (base from `stepId`, key from the enclosing `foreach`/`loop` segment).

### T2. The split-pane (`<RunView>`)

Two `<Box>` columns under the existing header:

- **Left (selector):** the full tree from `RunModel.order`, indented by depth;
  each row is `glyph + label` using the existing status colors. A `cursor` index
  marks the focused row with `›`.
- **Right (detail):** the focused instance's `buffer` rendered as a structured
  feed (one small renderer per `AgentChunk.t`), or its `output` for non-agent
  steps. A `scrollOffset` pages through retained scrollback with `↑↓` when the
  detail pane holds focus.
- The status `glyph`/`color` maps are extracted from `ProgressTree` and shared.
  `ProgressTree` remains the non-interactive fallback (final disposition decided
  in the implementation plan, not here).
- **Responsive width:** below a documented width threshold the split collapses to
  selector-only; `Enter` opens the detail as a transient overlay so narrow
  terminals stay usable.

### T3. Navigation (`useFocusManager`)

The TUI has no focus management today; add the minimum:

- Focus zones: **selector**, **detail**, and (when active) **modal**. `Tab`
  toggles selector/detail; `↑↓` drive the cursor (selector) or scroll (detail);
  `Enter` from the selector moves focus into detail. A small `useInput` handler —
  no third-party navigation library.

### T4. Alternate screen buffer

The live view runs in the terminal's alternate screen buffer, not inline.

- **Mount:** `useStdout().write('\x1b[?1049h')`; render into a fixed-height root
  `<Box height={rows} width={columns}>` so Ink fills the viewport instead of
  growing it (also avoids normal-buffer redraw flicker).
- **Unmount / exit:** restore with `'\x1b[?1049l'` on **every** exit path — clean
  completion, `Ctrl-C`/SIGINT, and uncaught error — via `waitUntilExit` plus a
  `process.on('SIGINT'/'exit')` guard, so a crash can never strand the user in
  altscreen.
- **Resize:** subscribe to `stdout.on('resize')` (SIGWINCH); re-read
  `rows`/`columns` and re-render; this also drives the responsive collapse.
- The view stays interactive until the user dismisses it (e.g. `q`/`Esc` once the
  run completes), so retained buffers are reviewable the whole time the app is up.
  On restore we print **nothing** to the normal buffer; the user's prior
  scrollback and prompt reappear untouched.

### T5. The question modal

When an `input`/`widget` step fires, it renders as a centered modal over the
dimmed split-pane.

- **Reuses the existing engine path unchanged:** the step calls
  `ctx.prompt(req)`, resolved via the registered handler, blocking *that step*
  only (not the engine's other branches). The existing `WidgetHost` (jiti loader,
  `widgetCache`, `{ data, resolve }` contract, `App.tsx:61`) and built-in
  `prompts.tsx` (confirm/text/select) render **inside** the modal frame instead
  of inline. The widget contract, loader, and non-TTY fallback are unchanged.
- **New is only placement + focus:** while `pending` is non-null the modal is the
  top focus zone and captures input; selector/detail go inert and dim. On
  `resolve()`, `pending` clears and focus returns to the selector.
- **Background streaming continues** — the engine never paused other branches;
  `agent-stream` events keep folding into their buffers behind the modal.
- **Concurrent questions:** `pending` becomes a small FIFO queue rendered one
  modal at a time, so a second prompt waits rather than races.

---

## Part 3 — Non-TTY (`LineLogger`)

Unaffected in spirit, lightly enriched. It already handles status events; it now
also consumes `agent-stream` to print activity as flat, instance-prefixed lines,
so piped/CI runs show agent progress instead of silence:

```
  build/foreach:task_2/implement › Edit scheduler.ts
  build/foreach:task_2/implement ✓ done (1,240 tok)
```

It uses `instanceId` as the line prefix (disambiguating concurrent agents in a
flat log) and ignores chunk types it does not render. No altscreen, no layout.
Questions still error in non-TTY unless a `default:` is set, exactly as today.

---

## Testing strategy

TDD throughout (repo convention): failing test first, `*.test.ts` beside source,
fixtures in `__fixtures__/`.

- **Core** — `exec.ts` emits correct `instanceId`/`parentId`/`kind` for nested
  `foreach`/`loop` (table-driven over a fixture workflow); provider maps agent-sdk
  messages → `AgentChunk` (via `fakeProvider` extended to drive `onChunk`);
  `StepEvent.output` → `agent-stream` translation.
- **TUI run-model reducer** — pure, table-driven: event sequences → expected
  `RunModel`; ring-cap trimming; label derivation
  (`foreach:task_2` → `astronaut[task_2]`); finished-buffer retention.
- **TUI rendering** — `ink-testing-library` (already used in `App.test.tsx` /
  `widget.test.tsx`): split-pane renders the tree; `Tab`/arrows move focus and
  scroll; modal captures focus while background buffers keep updating;
  narrow-width collapse.
- **Altscreen lifecycle** — assert enter/restore sequences emitted on
  mount/unmount/SIGINT via a write-spy on a fake stdout.
- **Gate:** `pnpm -r test` (vitest), `pnpm -r build` (tsdown), eslint per package.

## Risks & open questions

- **agent-sdk message → `AgentChunk` fidelity** — the exact mapping of
  `tool_use`/`tool_result`/`thinking` shapes must be verified against the
  installed SDK version at implementation time; the `raw` arm is the safety net.
- **Buffer cap default (`N ≈ 500`)** — sanity-check against a long real mission
  run; keep tunable.
- **Ink full-viewport flicker** — fixed-height root + altscreen should handle it,
  but validate on a real terminal during build; fallback is inline
  (non-altscreen) if a platform misbehaves.
- **Spec A coupling** — `instanceId` must align with the final journal-key scheme
  that A3 sub-workflows land (`…/use:<id>/…`); co-design the event-identity work
  with that namespace so resume and the UI agree.

## Out of scope (future work)

- Replaying or browsing past runs from `.plyflow/runs/<runId>.json`.
- A non-terminal (web) renderer — kept possible by the stateless-core boundary,
  but not built here.
- Mouse interaction.
