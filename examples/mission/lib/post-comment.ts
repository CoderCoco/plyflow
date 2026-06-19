import { postComment } from './gh-comments.js';
import type { Exec } from './exec.js';

export interface PostCommentInput {
  repo?: string;
  pr: number;
  body: string;
}

export interface PostCommentOutput {
  body: string;
}

/**
 * Default export for use as a workflow step (`uses: ./lib/post-comment.ts`).
 * Posts a comment on a GitHub PR via `gh pr comment`.
 */
export default async function postCommentDefault(
  input: PostCommentInput,
  ctx?: unknown,
  exec?: Exec,
): Promise<PostCommentOutput> {
  return postComment(input, ctx, exec);
}
