import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Prompt } from './prompts.js';

describe('Prompt', () => {
  it('resolves true when confirming with "y"', async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<Prompt request={{ type: 'confirm', message: 'ok?' }} onResolve={onResolve} />);
    // Wait for component to mount and be ready to receive input
    await new Promise((r) => setImmediate(r));
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 10));
    expect(onResolve).toHaveBeenCalledWith(true);
  });

  it('renders the message for a text prompt', () => {
    const { lastFrame } = render(<Prompt request={{ type: 'text', message: 'name?' }} onResolve={() => {}} />);
    expect(lastFrame()).toContain('name?');
  });
});
