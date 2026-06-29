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
  it('treats a bare filename with a .ts/.js extension as a local file', () => {
    expect(resolvePluginRef('/wf', 'echo-plugin.ts')).toBe(resolve('/wf', 'echo-plugin.ts'));
    expect(resolvePluginRef('/wf', 'p.js')).toBe(resolve('/wf', 'p.js'));
  });

  it('treats an extension-bearing package SUBPATH (has a slash) as a bare specifier', () => {
    // A slash means it's a package subpath that must resolve from node_modules,
    // NOT a local file — only a bare filename (no slash) is a local file.
    expect(resolvePluginRef('/wf', '@scope/pkg/plugin.js')).toBe('@scope/pkg/plugin.js');
    expect(resolvePluginRef('/wf', 'some-pkg/dist/index.js')).toBe('some-pkg/dist/index.js');
  });
});
