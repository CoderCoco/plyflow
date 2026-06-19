// src/core/remote/ref.test.ts
import { describe, it, expect } from 'vitest';
import { parseWorkflowRef } from './ref.js';
import { RemoteFetchError } from './errors.js';

describe('parseWorkflowRef', () => {
  it('returns null for a plain local path', () => {
    expect(parseWorkflowRef('./examples/summarize.yaml')).toBeNull();
    expect(parseWorkflowRef('/abs/wf.yaml')).toBeNull();
    expect(parseWorkflowRef('wf.yaml')).toBeNull();
  });

  it('parses shorthand without a ref', () => {
    expect(parseWorkflowRef('github:org/repo/examples/mission/mission.yaml')).toEqual({
      host: 'github',
      owner: 'org',
      repo: 'repo',
      ref: null,
      subPath: 'examples/mission/mission.yaml',
    });
  });

  it('parses shorthand with a ref after the last @', () => {
    expect(parseWorkflowRef('github:org/repo/path/wf.yaml@v1.2.0')).toEqual({
      host: 'github',
      owner: 'org',
      repo: 'repo',
      ref: 'v1.2.0',
      subPath: 'path/wf.yaml',
    });
  });

  it('parses a full github.com blob URL', () => {
    expect(
      parseWorkflowRef('https://github.com/org/repo/blob/main/examples/mission/mission.yaml'),
    ).toEqual({
      host: 'github',
      owner: 'org',
      repo: 'repo',
      ref: 'main',
      subPath: 'examples/mission/mission.yaml',
    });
  });

  it('parses a github.com tree URL the same way', () => {
    expect(parseWorkflowRef('https://github.com/o/r/tree/dev/a/b.yaml')?.ref).toBe('dev');
  });

  it('throws RemoteFetchError on a malformed github: ref', () => {
    expect(() => parseWorkflowRef('github:org/repo')).toThrow(RemoteFetchError);
    expect(() => parseWorkflowRef('github:org/repo')).toThrow(/github:owner\/repo\/path/);
  });

  it('throws RemoteFetchError on a github.com URL with no file path', () => {
    expect(() => parseWorkflowRef('https://github.com/org/repo')).toThrow(RemoteFetchError);
  });

  it('rejects literal and percent-encoded traversal segments in a shorthand subPath', () => {
    expect(() => parseWorkflowRef('github:o/r/../../etc/passwd@main')).toThrow(/unsafe path segment/);
    // %2e%2e decodes to ".." — caught after decoding in normalizeSubPath.
    expect(() => parseWorkflowRef('github:o/r/%2e%2e/%2e%2e/etc/passwd@main')).toThrow(
      /unsafe path segment/,
    );
  });

  it('cannot express traversal via a github.com URL (WHATWG URL normalizes dot-segments)', () => {
    // Both `..` and `%2e%2e` are collapsed by the URL parser before we parse it,
    // so a traversal degenerates into a (rejected) too-short path, never an escape.
    expect(() =>
      parseWorkflowRef('https://github.com/o/r/blob/main/%2e%2e/secret.yaml'),
    ).toThrow(RemoteFetchError);
  });

  it('still parses a normal nested subPath', () => {
    expect(parseWorkflowRef('github:o/r/a/b/c/wf.yaml@main')?.subPath).toBe('a/b/c/wf.yaml');
  });
});
