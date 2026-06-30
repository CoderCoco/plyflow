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
