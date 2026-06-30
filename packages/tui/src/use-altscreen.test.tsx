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
    expect(out.writes.some((w) => w.includes('[?1049h'))).toBe(true);
    unmount();
    expect(out.writes.some((w) => w.includes('[?1049l'))).toBe(true);
  });
});
