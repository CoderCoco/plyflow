import { defaultExec } from './exec.js';
import type { Exec } from './exec.js';

export interface GhPrInput {
  repo?: string;
  branch: string;
  title: string;
  body: string;
}

export interface GhPrResult {
  pr_number: number;
  pr_url: string;
}

export interface BuildPrBodyInput {
  summary_bullets: string[];
  diffstat: string;
  test_plan: string[];
  issue: number;
}

/**
 * Build a standard PR body with Summary, Changes, Test plan sections
 * and a trailing "Closes #<issue>".
 */
export function buildPrBody(input: BuildPrBodyInput): string {
  const bullets = input.summary_bullets.map((b) => `- ${b}`).join('\n');
  const checklist = input.test_plan.map((t) => `- [ ] ${t}`).join('\n');

  return [
    '## Summary',
    bullets,
    '',
    '## Changes',
    input.diffstat,
    '',
    '## Test plan',
    checklist,
    '',
    `Closes #${input.issue}`,
  ].join('\n');
}

/**
 * Check for an existing PR for the branch; reuse it if found,
 * otherwise create a new one via `gh pr create`.
 */
export default async function ghPr(
  input: GhPrInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<GhPrResult> {
  // Check for an existing PR
  const listArgs = [
    'pr',
    'list',
    '--head',
    input.branch,
    '--json',
    'number,url',
  ];
  if (input.repo) {
    listArgs.push('--repo', input.repo);
  }

  const listResult = await exec('gh', listArgs);
  if (listResult.code !== 0) {
    throw new Error(`gh pr list failed (code ${listResult.code}): ${listResult.stderr}`);
  }

  const existing = JSON.parse(listResult.stdout) as Array<{ number: number; url: string }>;
  if (existing.length > 0) {
    const pr = existing[0];
    return { pr_number: pr.number, pr_url: pr.url };
  }

  // No existing PR — create one
  const createArgs = [
    'pr',
    'create',
    '--title',
    input.title,
    '--body',
    input.body,
    '--base',
    'main',
    '--head',
    input.branch,
  ];
  if (input.repo) {
    createArgs.push('--repo', input.repo);
  }

  const createResult = await exec('gh', createArgs);
  if (createResult.code !== 0) {
    throw new Error(`gh pr create failed (code ${createResult.code}): ${createResult.stderr}`);
  }

  const prUrl = createResult.stdout.trim();
  const match = prUrl.match(/\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse PR number from gh pr create output: ${prUrl}`);
  }
  const pr_number = parseInt(match[1], 10);

  return { pr_number, pr_url: prUrl };
}
