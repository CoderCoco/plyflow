import { describe, it, expect } from 'vitest';
import flattenFindings from './flatten-findings.js';
import type { Finding } from './flatten-findings.js';

const makeFindings = (prefix: string): Finding[] => [
  {
    file: `src/${prefix}/a.ts`,
    severity: 'major',
    confidence: 80,
    summary: `${prefix} issue A`,
    suggestion: `Fix ${prefix} A`,
  },
  {
    file: `src/${prefix}/b.ts`,
    line: 10,
    severity: 'minor',
    confidence: 60,
    summary: `${prefix} issue B`,
    suggestion: `Fix ${prefix} B`,
  },
];

describe('flattenFindings', () => {
  it('concatenates findings from all buckets', () => {
    const jsFindings = makeFindings('js');
    const pyFindings = makeFindings('py');
    const result = flattenFindings({
      inspect: {
        javascript: { 'review-bucket': { findings: jsFindings } },
        python: { 'review-bucket': { findings: pyFindings } },
      },
    });
    expect(result.findings).toHaveLength(4);
    expect(result.findings).toEqual([...jsFindings, ...pyFindings]);
  });

  it('returns empty array for empty inspect map', () => {
    const result = flattenFindings({ inspect: {} });
    expect(result.findings).toEqual([]);
  });

  it('handles a bucket with no review-bucket key', () => {
    const jsFindings = makeFindings('js');
    const result = flattenFindings({
      inspect: {
        javascript: { 'review-bucket': { findings: jsFindings } },
        go: {},
      },
    });
    expect(result.findings).toHaveLength(2);
    expect(result.findings).toEqual(jsFindings);
  });

  it('handles a bucket with empty findings array', () => {
    const result = flattenFindings({
      inspect: {
        javascript: { 'review-bucket': { findings: [] } },
        python: { 'review-bucket': { findings: makeFindings('py') } },
      },
    });
    expect(result.findings).toHaveLength(2);
  });

  it('handles undefined review-bucket gracefully', () => {
    const result = flattenFindings({
      inspect: {
        javascript: { 'review-bucket': undefined },
      },
    });
    expect(result.findings).toEqual([]);
  });
});
