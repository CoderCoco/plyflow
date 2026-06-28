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

  it('defaults refresh and yes to false', () => {
    const a = parseArgs(['run', './wf.yaml']);
    expect(a.refresh).toBe(false);
    expect(a.yes).toBe(false);
  });

  it('parses --refresh, --yes and -y', () => {
    const a = parseArgs(['run', 'github:o/r/wf.yaml@main', '--refresh', '--yes']);
    expect(a.workflow).toBe('github:o/r/wf.yaml@main');
    expect(a.refresh).toBe(true);
    expect(a.yes).toBe(true);
    expect(parseArgs(['run', './wf.yaml', '-y']).yes).toBe(true);
  });
});
