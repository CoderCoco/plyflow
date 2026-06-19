// src/core/remote/ref.ts
import { RemoteFetchError } from './errors.js';

export interface WorkflowRef {
  host: 'github';
  owner: string;
  repo: string;
  /** null means the repo default branch. */
  ref: string | null;
  /** Path to the workflow file within the repo, e.g. "examples/mission/mission.yaml". */
  subPath: string;
}

const SHORTHAND = 'github:';

const FORMS =
  'expected "github:owner/repo/path/to/workflow.yaml@ref" ' +
  'or "https://github.com/owner/repo/blob/<ref>/path/to/workflow.yaml"';

export function parseWorkflowRef(arg: string): WorkflowRef | null {
  if (arg.startsWith(SHORTHAND)) return parseShorthand(arg.slice(SHORTHAND.length));
  if (arg.startsWith('https://github.com/') || arg.startsWith('http://github.com/')) {
    return parseUrl(arg);
  }
  return null; // plain local path — preserve current behaviour
}

function parseShorthand(body: string): WorkflowRef {
  // Split the optional "@ref" off the end (last '@' wins).
  let ref: string | null = null;
  const at = body.lastIndexOf('@');
  if (at !== -1) {
    ref = body.slice(at + 1) || null;
    body = body.slice(0, at);
  }
  const parts = body.split('/').filter((p) => p.length > 0);
  if (parts.length < 3) {
    throw new RemoteFetchError(`could not parse remote workflow "${SHORTHAND}${body}"; ${FORMS}`);
  }
  const [owner, repo, ...sub] = parts;
  return { host: 'github', owner: owner!, repo: repo!, ref, subPath: sub.join('/') };
}

function parseUrl(arg: string): WorkflowRef {
  let url: URL;
  try {
    url = new URL(arg);
  } catch {
    throw new RemoteFetchError(`could not parse remote workflow URL "${arg}"; ${FORMS}`);
  }
  // /owner/repo/(blob|tree|raw)/<ref>/<sub...>
  const seg = url.pathname.split('/').filter((p) => p.length > 0);
  const kind = seg[2];
  if (seg.length < 5 || (kind !== 'blob' && kind !== 'tree' && kind !== 'raw')) {
    throw new RemoteFetchError(`could not parse remote workflow URL "${arg}"; ${FORMS}`);
  }
  return {
    host: 'github',
    owner: seg[0]!,
    repo: seg[1]!,
    ref: seg[3]!,
    subPath: seg.slice(4).join('/'),
  };
}
