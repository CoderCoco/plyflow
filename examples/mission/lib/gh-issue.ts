import { defaultExec } from './exec.js';
import type { Exec } from './exec.js';

export interface GhIssueInput {
  issue: number;
  repo?: string;
}

export interface GhIssueResult {
  number: number;
  title: string;
  body: string;
  repo: string | undefined;
}

export default async function ghIssue(
  input: GhIssueInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<GhIssueResult> {
  // Dry-run: return canned issue data without calling gh.
  if (process.env.MISSION_DRYRUN === '1') {
    return {
      number: Number(input.issue),
      title: 'dry-run issue',
      body: 'Dry-run placeholder issue body.',
      repo: input.repo,
    };
  }

  const args = ['issue', 'view', String(input.issue), '--json', 'number,title,body'];
  if (input.repo) {
    args.push('--repo', input.repo);
  }

  const { stdout, stderr, code } = await exec('gh', args);
  if (code !== 0) {
    throw new Error(`gh issue view failed (code ${code}): ${stderr}`);
  }

  const data = JSON.parse(stdout) as { number: number; title: string; body: string };
  return { number: data.number, title: data.title, body: data.body, repo: input.repo };
}
