import { describe, it, expect } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses run with file, inputs, and resume', () => {
    const a = parseArgs(['run', './wf.yaml', '--input', 'n=5', '--input', 'name=x', '--resume', 'run-1']);
    expect(a.workflow).toBe('./wf.yaml');
    expect(a.inputs).toEqual({ n: '5', name: 'x' });
    expect(a.resume).toBe('run-1');
  });

  it('throws when no workflow file is given', () => {
    expect(() => parseArgs(['run'])).toThrow(/workflow/i);
  });
});
