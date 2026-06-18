import { describe, it, expect } from 'vitest';
import type { Exec } from './exec.js';

// ---------------------------------------------------------------------------
// Fake Exec factory
// ---------------------------------------------------------------------------
type Call = { cmd: string; args: string[]; cwd?: string };

function makeFakeExec(
  handler: (cmd: string, args: string[]) => { stdout: string; stderr: string; code: number },
): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    return Promise.resolve(handler(cmd, args));
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// findingsFilter tests
// ---------------------------------------------------------------------------

describe('findingsFilter', () => {
  it('dedupes identical file+summary', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/foo.ts', severity: 'major', confidence: 80, summary: 'Unused var', suggestion: 'Remove it' },
      { file: 'src/foo.ts', severity: 'major', confidence: 80, summary: 'Unused var', suggestion: 'Remove it' },
      { file: 'src/foo.ts', severity: 'minor', confidence: 60, summary: 'Missing semicolon', suggestion: 'Add it' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/foo.ts'],
    });

    // Should dedupe the two identical findings into one
    const allFindings = [...result.actionable, ...result.deferred];
    const unusedVarMatches = allFindings.filter(
      (f) => f.file === 'src/foo.ts' && f.summary === 'Unused var',
    );
    expect(unusedVarMatches).toHaveLength(1);
  });

  it('drops a finding on a file NOT in changed_files (cascade guard)', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/changed.ts', severity: 'major', confidence: 80, summary: 'Issue in changed', suggestion: 'Fix it' },
      { file: 'src/unchanged.ts', severity: 'blocker', confidence: 95, summary: 'Issue in unchanged', suggestion: 'Fix it' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/changed.ts'],
    });

    const allFindings = [...result.actionable, ...result.deferred];
    expect(allFindings.every((f) => f.file !== 'src/unchanged.ts')).toBe(true);
    expect(allFindings.some((f) => f.file === 'src/changed.ts')).toBe(true);
  });

  it('puts confidence 80 in actionable and confidence 30 in deferred with default threshold (50)', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/a.ts', severity: 'major', confidence: 80, summary: 'High confidence', suggestion: 'Fix' },
      { file: 'src/a.ts', severity: 'minor', confidence: 30, summary: 'Low confidence', suggestion: 'Maybe' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/a.ts'],
    });

    expect(result.actionable).toHaveLength(1);
    expect(result.actionable[0].summary).toBe('High confidence');
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0].summary).toBe('Low confidence');
  });

  it('respects a custom confidence_threshold', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/a.ts', severity: 'major', confidence: 70, summary: 'Above custom threshold', suggestion: 'Fix' },
      { file: 'src/a.ts', severity: 'minor', confidence: 55, summary: 'Below custom threshold', suggestion: 'Maybe' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/a.ts'],
      confidence_threshold: 60,
    });

    // confidence > 60 → actionable; confidence <= 60 → deferred
    expect(result.actionable).toHaveLength(1);
    expect(result.actionable[0].summary).toBe('Above custom threshold');
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0].summary).toBe('Below custom threshold');
  });

  it('returns empty arrays when no findings remain after cascade guard', async () => {
    const { default: findingsFilter } = await import('./findings-filter.js');

    const findings = [
      { file: 'src/other.ts', severity: 'major', confidence: 90, summary: 'Dropped', suggestion: 'Fix' },
    ];

    const result = findingsFilter({
      findings,
      changed_files: ['src/changed.ts'],
    });

    expect(result.actionable).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveModels tests
// ---------------------------------------------------------------------------

describe('resolveModels', () => {
  it('returns defaults when no overrides provided', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({});

    expect(result.director).toBe('fable');
    expect(result.astronaut).toBe('sonnet');
    expect(result.controller).toBe('sonnet');
    expect(result.inspector).toBe('fable');
    expect(result.capcom).toBe('sonnet');
    expect(result.docking).toBe('sonnet');
    expect(result.utility).toBe('haiku');
  });

  it('parses string overrides "director=opus,inspector=sonnet" and applies them', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({ overrides: 'director=opus,inspector=sonnet' });

    expect(result.director).toBe('opus');
    expect(result.inspector).toBe('sonnet');
    // Others remain at defaults
    expect(result.astronaut).toBe('sonnet');
    expect(result.utility).toBe('haiku');
  });

  it('accepts object overrides and applies them', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({ overrides: { director: 'haiku', utility: 'opus' } });

    expect(result.director).toBe('haiku');
    expect(result.utility).toBe('opus');
    // Others remain at defaults
    expect(result.controller).toBe('sonnet');
  });

  it('applies fable fallback when fableAvailable is false: director→opus, inspector→sonnet', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    const result = resolveModels({ fableAvailable: false });

    // director defaults to fable → should become opus
    expect(result.director).toBe('opus');
    // inspector defaults to fable → should become sonnet
    expect(result.inspector).toBe('sonnet');
    // roles that were already sonnet/haiku should be unchanged
    expect(result.astronaut).toBe('sonnet');
    expect(result.utility).toBe('haiku');
  });

  it('fable fallback applies after overrides: explicitly set fable→opus/sonnet', async () => {
    const { default: resolveModels } = await import('./resolve-models.js');

    // Set all to fable via overrides, then apply fallback
    const result = resolveModels({
      overrides: { director: 'fable', astronaut: 'fable', capcom: 'fable' },
      fableAvailable: false,
    });

    // director fable → opus
    expect(result.director).toBe('opus');
    // non-director/inspector fable → sonnet
    expect(result.astronaut).toBe('sonnet');
    expect(result.capcom).toBe('sonnet');
  });
});

// ---------------------------------------------------------------------------
// gh-comments tests
// ---------------------------------------------------------------------------

describe('gh-comments fetchComments', () => {
  it('calls gh pr view with the right json fields and parses the result', async () => {
    const prViewPayload = {
      number: 5,
      merged: false,
      statusCheckRollup: [{ state: 'SUCCESS' }],
      reviewThreads: [],
      comments: [{ id: 'c1', body: 'Looks good', author: { login: 'alice' }, createdAt: '2026-01-01T00:00:00Z' }],
      reviews: [],
      url: 'https://github.com/owner/repo/pull/5',
      headRefName: 'feat/thing',
      baseRefName: 'main',
      title: 'My PR',
    };

    const { exec, calls } = makeFakeExec((cmd, args) => {
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify(prViewPayload), stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    });

    const { fetchComments } = await import('./gh-comments.js');
    const result = await fetchComments({ pr: 5 }, undefined, exec);

    // Should have called gh pr view
    const viewCall = calls.find((c) => c.cmd === 'gh' && c.args[1] === 'view');
    expect(viewCall).toBeDefined();
    expect(viewCall!.args).toContain('5');
    expect(viewCall!.args).toContain('--json');

    // Should parse merged and comments
    expect(result.merged).toBe(false);
    expect(Array.isArray(result.comments)).toBe(true);
  });

  it('includes --repo when provided', async () => {
    const { exec, calls } = makeFakeExec(() => ({
      stdout: JSON.stringify({ number: 3, merged: true, statusCheckRollup: [], reviewThreads: [], comments: [], reviews: [] }),
      stderr: '',
      code: 0,
    }));

    const { fetchComments } = await import('./gh-comments.js');
    await fetchComments({ pr: 3, repo: 'owner/myrepo' }, undefined, exec);

    const viewCall = calls.find((c) => c.cmd === 'gh' && c.args[1] === 'view');
    expect(viewCall).toBeDefined();
    expect(viewCall!.args).toContain('--repo');
    expect(viewCall!.args).toContain('owner/myrepo');
  });

  it('detects ci_passing from statusCheckRollup', async () => {
    const { exec } = makeFakeExec(() => ({
      stdout: JSON.stringify({
        number: 7,
        merged: false,
        statusCheckRollup: [{ state: 'FAILURE' }, { state: 'SUCCESS' }],
        reviewThreads: [],
        comments: [],
        reviews: [],
      }),
      stderr: '',
      code: 0,
    }));

    const { fetchComments } = await import('./gh-comments.js');
    const result = await fetchComments({ pr: 7 }, undefined, exec);

    // Has a FAILURE state → ci_passing should be false
    expect(result.ci_passing).toBe(false);
  });
});

describe('gh-comments postComment', () => {
  it('calls gh pr comment with --body and returns the body', async () => {
    const { exec, calls } = makeFakeExec(() => ({ stdout: '', stderr: '', code: 0 }));

    const { postComment } = await import('./gh-comments.js');
    const result = await postComment({ pr: 5, body: 'LGTM!' }, undefined, exec);

    const commentCall = calls.find((c) => c.cmd === 'gh' && c.args[1] === 'comment');
    expect(commentCall).toBeDefined();
    expect(commentCall!.args).toContain('5');
    expect(commentCall!.args).toContain('--body');
    expect(commentCall!.args).toContain('LGTM!');
    expect(result.body).toBe('LGTM!');
  });

  it('includes --repo when provided', async () => {
    const { exec, calls } = makeFakeExec(() => ({ stdout: '', stderr: '', code: 0 }));

    const { postComment } = await import('./gh-comments.js');
    await postComment({ pr: 9, body: 'Hello', repo: 'owner/repo' }, undefined, exec);

    const commentCall = calls.find((c) => c.cmd === 'gh' && c.args[1] === 'comment');
    expect(commentCall!.args).toContain('--repo');
    expect(commentCall!.args).toContain('owner/repo');
  });
});

describe('gh-comments resolveThread', () => {
  it('calls gh api to resolve a review thread', async () => {
    const { exec, calls } = makeFakeExec(() => ({ stdout: '{}', stderr: '', code: 0 }));

    const { resolveThread } = await import('./gh-comments.js');
    await resolveThread({ thread_id: 'PRRT_abc123' }, undefined, exec);

    // Should call gh api with a GraphQL mutation
    const apiCall = calls.find((c) => c.cmd === 'gh' && c.args[0] === 'api');
    expect(apiCall).toBeDefined();
    expect(apiCall!.args.join(' ')).toContain('PRRT_abc123');
  });
});

describe('gh-comments reRequestReview', () => {
  it('calls gh pr review request with the listed reviewers', async () => {
    const { exec, calls } = makeFakeExec(() => ({ stdout: '', stderr: '', code: 0 }));

    const { reRequestReview } = await import('./gh-comments.js');
    await reRequestReview({ pr: 10, reviewers: ['alice', 'bob'] }, undefined, exec);

    const requestCall = calls.find(
      (c) => c.cmd === 'gh' && c.args[0] === 'pr' && c.args[1] === 'request-reviews',
    );
    expect(requestCall).toBeDefined();
    expect(requestCall!.args).toContain('10');
    expect(requestCall!.args).toContain('--reviewer');
    expect(requestCall!.args).toContain('alice');
  });
});
