import { defaultShellExec, type ShellExec, type StepRegistry } from '@plyflow/core';
import { makeGithubIssueStep } from './issue.js';
import { makeGithubPrStep } from './pr.js';
import { makeGithubCommentsStep } from './comments.js';
import { makeGithubReviewStep } from './review.js';

/** Register all github.* steps wired to a specific ShellExec (tests inject mockExec). */
export function registerWith(registry: StepRegistry, exec: ShellExec): void {
  registry.register(makeGithubIssueStep(exec));
  registry.register(makeGithubPrStep(exec));
  registry.register(makeGithubCommentsStep(exec));
  registry.register(makeGithubReviewStep(exec));
}

/** Plugin entry: plyflow calls this with the run's step registry. */
export default function register(registry: StepRegistry): void {
  registerWith(registry, defaultShellExec);
}
