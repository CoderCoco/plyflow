import { describe, it, expectTypeOf } from 'vitest';
import type { WorkflowFile, StepDef } from './types.js';

describe('core types', () => {
  it('models a workflow with phases and steps', () => {
    const wf: WorkflowFile = {
      name: 'demo',
      phases: [{ name: 'P', steps: [{ id: 's', run: 'return 1;' }] }],
    };
    expectTypeOf(wf.phases[0]!.steps[0]!).toMatchTypeOf<StepDef>();
  });
});
