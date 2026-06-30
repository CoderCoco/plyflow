import { describe, it, expect, vi } from 'vitest';
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

function makeFakeProc() {
  const handlers: Record<string, (() => void)[]> = {};
  return {
    pid: 42,
    kill: vi.fn(),
    once(ev: string, cb: () => void) {
      handlers[ev] = handlers[ev] ?? [];
      handlers[ev].push(cb);
    },
    removeListener(ev: string, cb: () => void) {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== cb);
    },
    trigger(ev: string) {
      for (const cb of handlers[ev] ?? []) cb();
    },
  };
}

function Harness({ out, proc }: { out: ReturnType<typeof makeFakeOut>; proc?: ReturnType<typeof makeFakeProc> }): React.ReactElement {
  const { rows } = useAltscreen(out, proc as never);
  return <Text>{`rows=${rows}`}</Text>;
}

describe('useAltscreen', () => {
  it('enters altscreen on mount and restores on unmount', () => {
    const out = makeFakeOut();
    const { unmount } = render(<Harness out={out} />);
    expect(out.writes.some((w) => w.includes('[?1049h'))).toBe(true);
    unmount();
    expect(out.writes.some((w) => w.includes('[?1049l'))).toBe(true);
  });

  it('updates rendered rows after a resize event', async () => {
    const out = makeFakeOut();
    const { lastFrame } = render(<Harness out={out} />);
    out.setSize(40, 120);
    out.triggerResize();
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()).toContain('rows=40');
  });

  it('restores terminal and re-raises SIGINT when Ctrl-C is pressed', () => {
    const out = makeFakeOut();
    const proc = makeFakeProc();
    render(<Harness out={out} proc={proc} />);
    proc.trigger('SIGINT');
    expect(out.writes.some((w) => w.includes('[?1049l'))).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith(42, 'SIGINT');
  });
});
