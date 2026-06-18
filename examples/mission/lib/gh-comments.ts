import { defaultExec, type Exec } from './exec.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchCommentsInput {
  repo?: string;
  pr: number;
  since?: string;
}

export interface FetchCommentsOutput {
  merged: boolean;
  ci_passing: boolean;
  comments: unknown[];
  [key: string]: unknown;
}

export interface ResolveThreadInput {
  repo?: string;
  thread_id: string;
}

export interface PostCommentInput {
  repo?: string;
  pr: number;
  body: string;
}

export interface PostCommentOutput {
  body: string;
}

export interface ReRequestReviewInput {
  repo?: string;
  pr: number;
  reviewers: string[];
}

// ---------------------------------------------------------------------------
// fetchComments
// ---------------------------------------------------------------------------

const PR_JSON_FIELDS = [
  'number',
  'merged',
  'statusCheckRollup',
  'reviewThreads',
  'comments',
  'reviews',
  'url',
  'headRefName',
  'baseRefName',
  'title',
].join(',');

export async function fetchComments(
  input: FetchCommentsInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<FetchCommentsOutput> {
  const { pr, repo, since } = input;

  const args = ['pr', 'view', String(pr), '--json', PR_JSON_FIELDS];
  if (repo) {
    args.push('--repo', repo);
  }

  const { stdout, stderr, code } = await exec('gh', args);
  if (code !== 0) {
    throw new Error(`gh pr view failed (code ${code}): ${stderr}`);
  }

  const data = JSON.parse(stdout) as Record<string, unknown>;

  // Determine CI passing from statusCheckRollup
  const checks = (data.statusCheckRollup as Array<{ state: string }> | undefined) ?? [];
  const ci_passing = checks.length === 0 || checks.every((c) => c.state === 'SUCCESS');

  // Filter comments by since if provided
  let comments = (data.comments as unknown[]) ?? [];
  if (since) {
    const sinceDate = new Date(since).getTime();
    comments = comments.filter((c) => {
      const comment = c as { createdAt?: string };
      if (!comment.createdAt) return true;
      return new Date(comment.createdAt).getTime() > sinceDate;
    });
  }

  return {
    ...data,
    merged: Boolean(data.merged),
    ci_passing,
    comments,
  };
}

// ---------------------------------------------------------------------------
// resolveThread — mark a review thread as resolved via GraphQL
// ---------------------------------------------------------------------------

export async function resolveThread(
  input: ResolveThreadInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<{ resolved: boolean }> {
  const { thread_id } = input;

  const mutation = `mutation { resolveReviewThread(input: { threadId: "${thread_id}" }) { thread { id isResolved } } }`;

  const args = ['api', 'graphql', '-f', `query=${mutation}`];

  const { code, stderr } = await exec('gh', args);
  if (code !== 0) {
    throw new Error(`gh api resolveThread failed (code ${code}): ${stderr}`);
  }

  return { resolved: true };
}

// ---------------------------------------------------------------------------
// postComment
// ---------------------------------------------------------------------------

export async function postComment(
  input: PostCommentInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<PostCommentOutput> {
  const { pr, body, repo } = input;

  const args = ['pr', 'comment', String(pr), '--body', body];
  if (repo) {
    args.push('--repo', repo);
  }

  const { code, stderr } = await exec('gh', args);
  if (code !== 0) {
    throw new Error(`gh pr comment failed (code ${code}): ${stderr}`);
  }

  return { body };
}

// ---------------------------------------------------------------------------
// reRequestReview
// ---------------------------------------------------------------------------

export async function reRequestReview(
  input: ReRequestReviewInput,
  _ctx?: unknown,
  exec: Exec = defaultExec,
): Promise<{ requested: boolean }> {
  const { pr, reviewers, repo } = input;

  const args = ['pr', 'request-reviews', String(pr)];
  if (repo) {
    args.push('--repo', repo);
  }
  for (const reviewer of reviewers) {
    args.push('--reviewer', reviewer);
  }

  const { code, stderr } = await exec('gh', args);
  if (code !== 0) {
    throw new Error(`gh pr request-reviews failed (code ${code}): ${stderr}`);
  }

  return { requested: true };
}

// ---------------------------------------------------------------------------
// Default export: fetchComments (the primary uses: entry)
// ---------------------------------------------------------------------------

export default fetchComments;
