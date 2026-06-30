import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { QuestionModal, type PendingUi } from './QuestionModal.js';

describe('QuestionModal', () => {
  it('renders a confirm prompt message inside the modal', () => {
    const pending: PendingUi = {
      stepId: 'ready',
      request: { kind: 'prompt', type: 'confirm', message: 'Proceed to liftoff?' },
      resolve: vi.fn(),
    };
    const { lastFrame } = render(<QuestionModal pending={pending} />);
    expect(lastFrame()).toContain('Proceed to liftoff?');
  });

  it('resolves with true when the user presses y', async () => {
    const resolve = vi.fn();
    const pending: PendingUi = {
      stepId: 'ready',
      request: { kind: 'prompt', type: 'confirm', message: 'ok?' },
      resolve,
    };
    const { stdin } = render(<QuestionModal pending={pending} />);
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 10));
    expect(resolve).toHaveBeenCalledWith(true);
  });
});
