export interface Finding {
  file: string;
  line?: number;
  severity: string;
  confidence: number;
  summary: string;
  suggestion: string;
}

export interface FindingsFilterInput {
  findings: Finding[];
  changed_files: string[];
  confidence_threshold?: number;
}

export interface FindingsFilterOutput {
  actionable: Finding[];
  deferred: Finding[];
}

export default function findingsFilter(
  input: FindingsFilterInput,
  _ctx?: unknown,
): FindingsFilterOutput {
  const { findings, changed_files, confidence_threshold } = input;
  const threshold = confidence_threshold ?? 50;
  const changedSet = new Set(changed_files);

  // Step 1: dedupe by file + '\n' + summary
  const seen = new Set<string>();
  const deduped: Finding[] = [];
  for (const finding of findings) {
    const key = finding.file + '\n' + finding.summary;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(finding);
    }
  }

  // Step 2: cascade guard — drop findings whose file is not in changed_files
  const inScope = deduped.filter((f) => changedSet.has(f.file));

  // Step 3: split by confidence
  const actionable: Finding[] = [];
  const deferred: Finding[] = [];
  for (const finding of inScope) {
    if (finding.confidence > threshold) {
      actionable.push(finding);
    } else {
      deferred.push(finding);
    }
  }

  return { actionable, deferred };
}
