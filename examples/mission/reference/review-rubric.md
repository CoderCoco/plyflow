# Systems Inspector's Review Rubric

This file is the Systems Inspector's living checklist. It is updated via
`/mission-debrief` when new pitfalls are discovered. Add entries; remove
only by direct edit.

## What this covers

Semantic and quality concerns the Flight Controller's mechanical checks
(tests/lint/types/build) CANNOT catch. Do not re-flag things the
Flight Controller already checks.

---

## 1. Semantic correctness

Logic that looks right but is wrong:

- Shared format/config objects applied to the wrong target.
  Example: ANSI colorize format passed to a file logger transport —
  results in escape codes in the log file.
- State machine that reaches an unreachable or never-cleared branch.
- Promise/async chains that swallow errors silently (empty catch, `.catch(() => {})`).
- Event handlers registered in a loop without being cleaned up on unmount.

## 2. Cross-platform portability

- Hard-coded POSIX path separators (`'/'`) in tests or runtime code.
  Fix: use `node:path` (`path.join()`, `path.dirname()`), or Python's
  `pathlib`, or Go's `filepath` package.
- Line-ending assumptions (`'\n'` vs `'\r\n'`).
- Case-sensitive filename assumptions (matters on macOS/Linux vs Windows).
- Hard-coded `/tmp` or `~` paths instead of `os.tmpdir()` / `os.homedir()`.

## 3. Boundary & off-by-one

- Binary buffer slicing at exact boundaries. Example: reading a tail window
  from a file — validate at the exact boundary where the read offset lands
  on a newline. A peek-back-by-one-byte pattern safely drops the first
  partial line without discarding a complete one.
- Inclusive vs exclusive range handling (`< N` vs `<= N`).
- Empty-collection edge cases (empty array passed where at-least-one assumed).
- Integer overflow in size/offset calculations.

## 4. Code hygiene

- Empty `beforeEach`/`afterEach`/`setUp`/`tearDown` hooks with stale
  comments claiming they do something (e.g., `// reset state` in an empty
  body). Either implement the reset or delete the hook.
- Dead variables assigned but never read.
- Dead branches (`if (false)`, unreachable `else` after early return).
- Dead imports.
- TODO/FIXME/HACK comments without an owner or ticket reference.

## 5. Unnecessary complexity

- One-off boolean flags (e.g., `isFirstFetch`) that duplicate control flow
  already expressible as sequential awaits in an async IIFE.
- Premature abstraction — a Strategy pattern, interface, or factory for
  exactly two implementations.
- Wrapping a framework primitive in a thin no-op wrapper class/function.
- Re-implementing what a standard library already provides.

## 6. Test quality

- Tests that assert implementation details (private methods, internal state)
  rather than observable behaviour.
- Tests that share mutable state across cases without reset — creates
  ordering dependence.
- Mocked boundaries that diverge from the real interface, masking bugs that
  would surface in production.
- Test description and assertion mismatched (description says "returns 404",
  assertion checks status code 200).

---

## Declined / Out-of-scope

Findings that have been explicitly declined for this project. Systems Inspector
must NOT raise these. Populated via `/mission-debrief`.

<!-- example entry:
- summary: Vitest hoisting concern
  declined: 2026-05-23
  reason: vi.mock IS hoisted by Vitest's transform; finding was incorrect
-->
