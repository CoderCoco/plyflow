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

function Harness({ active }: { active?: boolean } = {}): React.ReactElement {
  const nav = useRunNav(model, active !== undefined ? { active } : undefined);
  return <Text>{`${nav.focus}:${nav.cursorId}:${nav.scrollOffset}`}</Text>;
}

const ARROW_DOWN = '[B';
const ARROW_UP = '[A';
const TAB = '\t';
const ESC = '';

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

  it('up arrow in detail focus increments scrollOffset', async () => {
    const { stdin, lastFrame } = render(<Harness />);
    // Switch to detail first
    stdin.write(TAB);
    await new Promise((r) => setTimeout(r, 10));
    // Scroll up
    stdin.write(ARROW_UP);
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()).toBe('detail:phase:P/a:1');
  });

  it('down arrow in detail focus decrements scrollOffset (floor 0)', async () => {
    const { stdin, lastFrame } = render(<Harness />);
    // Switch to detail first, scroll up to have offset > 0
    stdin.write(TAB);
    await new Promise((r) => setTimeout(r, 10));
    stdin.write(ARROW_UP);
    await new Promise((r) => setTimeout(r, 10));
    stdin.write(ARROW_DOWN);
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()).toBe('detail:phase:P/a:0');
  });

  it('Esc returns to selector focus', async () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write(TAB);
    await new Promise((r) => setTimeout(r, 10));
    // ESC alone is held as "pending" by ink for ~20ms before flushing.
    stdin.write(ESC);
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toBe('selector:phase:P/a:0');
  });

  it('does not move cursor when active=false (modal focus capture)', async () => {
    // When a modal is open, nav input must be inert — arrow keys must not move cursor.
    const { stdin, lastFrame } = render(<Harness active={false} />);
    stdin.write(ARROW_DOWN);
    await new Promise((r) => setTimeout(r, 10));
    // Cursor stays on the first item (phase:P/a); it did NOT advance to phase:P/b.
    expect(lastFrame()).toBe('selector:phase:P/a:0');
  });
});
