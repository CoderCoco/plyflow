import type { z } from 'zod';
import CapcomTriageSchema from '../schemas/CapcomTriage.js';

type CapcomTriage = z.infer<typeof CapcomTriageSchema>;
type Comment = CapcomTriage['comments'][number];

export interface ActionableCommentsInput {
  triage: { comments: Comment[] };
}

export interface ActionableCommentsOutput {
  actionable: Comment[];
}

/**
 * Filter a CapcomTriage result to only comments with category === 'actionable'.
 * Pure function — no exec, no side effects.
 */
export default function actionableComments(
  input: ActionableCommentsInput,
): ActionableCommentsOutput {
  const actionable = input.triage.comments.filter((c) => c.category === 'actionable');
  return { actionable };
}
