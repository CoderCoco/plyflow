import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import Plan from './Plan.js';
import AstronautReport from './AstronautReport.js';
import ControllerVerdict from './ControllerVerdict.js';
import InspectorFindings from './InspectorFindings.js';
import CapcomTriage from './CapcomTriage.js';
import FetchResult from './FetchResult.js';
import PrResult from './PrResult.js';

describe('Plan', () => {
  const validPlan = {
    issue_title: 'Add login',
    branch: 'claude/issue-1-add-login',
    worktree_path: '.claude/worktrees/issue-1',
    tasks: [
      {
        name: 'task-1',
        title: 'Scaffold auth module',
        files: ['src/auth.ts'],
        depends_on: [],
        acceptance: 'Auth module exports a login function',
      },
    ],
    open_questions: [],
  };

  it('parses a valid Plan', () => {
    expect(() => Plan.parse(validPlan)).not.toThrow();
  });

  it('rejects a task missing acceptance', () => {
    const bad = {
      ...validPlan,
      tasks: [{ name: 'task-1', title: 'Scaffold', files: [], depends_on: [] }],
    };
    expect(() => Plan.parse(bad)).toThrow();
  });

  it('z.toJSONSchema(Plan) has properties.tasks', () => {
    const jsonSchema = z.toJSONSchema(Plan);
    expect((jsonSchema as { properties?: { tasks?: unknown } }).properties?.tasks).toBeDefined();
  });
});

describe('AstronautReport', () => {
  it('parses a valid done report', () => {
    expect(() =>
      AstronautReport.parse({
        task_name: 'task-1',
        status: 'done',
        files_modified: ['src/auth.ts'],
        summary: 'Implemented login',
      }),
    ).not.toThrow();
  });

  it('parses a plan_problem report with optional description', () => {
    expect(() =>
      AstronautReport.parse({
        task_name: 'task-1',
        status: 'plan_problem',
        files_modified: [],
        summary: 'Cannot proceed',
        plan_problem_description: 'The file listed does not exist',
      }),
    ).not.toThrow();
  });

  it('rejects an invalid status', () => {
    expect(() =>
      AstronautReport.parse({
        task_name: 'task-1',
        status: 'skipped',
        files_modified: [],
        summary: 'nope',
      }),
    ).toThrow();
  });
});

describe('ControllerVerdict', () => {
  it('parses a valid PASS verdict', () => {
    expect(() =>
      ControllerVerdict.parse({
        task_name: 'task-1',
        verdict: 'PASS',
        fixes_needed: [],
      }),
    ).not.toThrow();
  });

  it('rejects verdict MAYBE', () => {
    expect(() =>
      ControllerVerdict.parse({
        task_name: 'task-1',
        verdict: 'MAYBE',
        fixes_needed: [],
      }),
    ).toThrow();
  });
});

describe('InspectorFindings', () => {
  it('parses valid findings', () => {
    expect(() =>
      InspectorFindings.parse({
        findings: [
          {
            file: 'src/auth.ts',
            line: 42,
            severity: 'major',
            confidence: 80,
            summary: 'Unused import',
            suggestion: 'Remove the import',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('parses with optional line omitted', () => {
    expect(() =>
      InspectorFindings.parse({
        findings: [
          {
            file: 'src/auth.ts',
            severity: 'nit',
            confidence: 60,
            summary: 'Trailing space',
            suggestion: 'Remove trailing space',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects severity huge', () => {
    expect(() =>
      InspectorFindings.parse({
        findings: [
          {
            file: 'src/auth.ts',
            severity: 'huge',
            confidence: 90,
            summary: 'Bad',
            suggestion: 'Fix it',
          },
        ],
      }),
    ).toThrow();
  });
});

describe('CapcomTriage', () => {
  it('parses valid triage', () => {
    expect(() =>
      CapcomTriage.parse({
        comments: [
          {
            id: 'comment-1',
            category: 'actionable',
            fix_hint: 'Add a null check',
            reply_draft: 'Good catch, fixed.',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('parses with optional fields omitted', () => {
    expect(() =>
      CapcomTriage.parse({
        comments: [{ id: 'comment-2', category: 'ignore' }],
      }),
    ).not.toThrow();
  });

  it('rejects invalid category', () => {
    expect(() =>
      CapcomTriage.parse({
        comments: [{ id: 'comment-3', category: 'dismiss' }],
      }),
    ).toThrow();
  });
});

describe('FetchResult', () => {
  it('parses a valid fetch result', () => {
    expect(() =>
      FetchResult.parse({
        merged: false,
        ci_passing: true,
        all_threads_resolved: false,
        new_comments: [{ id: 1 }],
        open_threads: [],
        viewer_login: 'octocat',
      }),
    ).not.toThrow();
  });

  it('rejects missing viewer_login', () => {
    expect(() =>
      FetchResult.parse({
        merged: false,
        ci_passing: true,
        all_threads_resolved: false,
        new_comments: [],
        open_threads: [],
      }),
    ).toThrow();
  });
});

describe('PrResult', () => {
  it('parses a valid PR result', () => {
    expect(() =>
      PrResult.parse({ pr_number: 42, pr_url: 'https://github.com/owner/repo/pull/42' }),
    ).not.toThrow();
  });

  it('rejects non-numeric pr_number', () => {
    expect(() =>
      PrResult.parse({ pr_number: 'forty-two', pr_url: 'https://github.com/owner/repo/pull/42' }),
    ).toThrow();
  });
});
