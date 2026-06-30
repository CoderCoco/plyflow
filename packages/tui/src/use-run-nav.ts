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
      if (key.return) {
        setFocus('detail');
        return;
      }
      if (key.upArrow || key.downArrow) {
        const order = model.order;
        const idx = Math.max(0, order.indexOf(effectiveCursor ?? ''));
        const nextIdx = key.upArrow
          ? Math.max(0, idx - 1)
          : Math.min(order.length - 1, idx + 1);
        setCursorId(order[nextIdx] ?? null);
        setScrollOffset(0);
      }
    } else {
      // detail focus: ↑ = older content (increment offset), ↓ = newer (decrement, floor 0)
      if (key.upArrow) setScrollOffset((s) => s + 1);
      else if (key.downArrow) setScrollOffset((s) => Math.max(0, s - 1));
    }
  });

  return { cursorId: effectiveCursor, focus, scrollOffset };
}
