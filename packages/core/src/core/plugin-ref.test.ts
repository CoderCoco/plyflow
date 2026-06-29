import { describe, it, expect } from 'vitest';
import { resolvePluginRef } from './plugin-ref.js';
import { isAbsolute, resolve } from 'node:path';

describe('resolvePluginRef', () => {
  it('resolves relative refs against the dir', () => {
    const out = resolvePluginRef('/wf', './steps/up.ts');
    expect(isAbsolute(out)).toBe(true);
    expect(out).toBe(resolve('/wf', './steps/up.ts'));
  });
  it('resolves ../ refs against the dir', () => {
    expect(resolvePluginRef('/wf/sub', '../p.ts')).toBe(resolve('/wf/sub', '../p.ts'));
  });
  it('passes a bare package specifier through unchanged', () => {
    expect(resolvePluginRef('/wf', '@plyflow/git')).toBe('@plyflow/git');
    expect(resolvePluginRef('/wf', 'some-plugin')).toBe('some-plugin');
    expect(resolvePluginRef('/wf', '@scope/pkg/sub')).toBe('@scope/pkg/sub');
  });
  it('leaves an absolute path unchanged', () => {
    expect(resolvePluginRef('/wf', '/abs/p.ts')).toBe('/abs/p.ts');
  });
});
