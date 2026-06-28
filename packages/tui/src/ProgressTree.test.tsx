import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ProgressTree } from './ProgressTree.js';

describe('ProgressTree', () => {
  it('renders phases and steps with status glyphs', () => {
    const { lastFrame } = render(
      <ProgressTree phases={[{ name: 'Compute', steps: [
        { id: 'double', status: 'done' },
        { id: 'label', status: 'running' },
      ] }]} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Compute');
    expect(frame).toContain('double');
    expect(frame).toContain('label');
    expect(frame).toMatch(/✓|✔/);
  });
});
