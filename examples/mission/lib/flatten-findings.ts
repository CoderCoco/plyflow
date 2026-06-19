export interface Finding {
  file: string;
  line?: number;
  severity: string;
  confidence: number;
  summary: string;
  suggestion: string;
}

export interface FlattenFindingsInput {
  inspect: Record<string, { 'review-bucket'?: { findings?: Finding[] }; [key: string]: unknown }>;
}

export interface FlattenFindingsOutput {
  findings: Finding[];
}

/**
 * Given the `inspect` foreach output map
 * (bucket key → { 'review-bucket': InspectorFindings }),
 * concatenate all buckets' `.findings` arrays into one flat list.
 */
export default function flattenFindings(
  input: FlattenFindingsInput,
  _ctx?: unknown,
): FlattenFindingsOutput {
  const findings: Finding[] = [];

  for (const bucketOutput of Object.values(input.inspect)) {
    const inspectorResult = bucketOutput?.['review-bucket'] as { findings?: Finding[] } | undefined;
    if (inspectorResult?.findings && Array.isArray(inspectorResult.findings)) {
      findings.push(...inspectorResult.findings);
    }
  }

  return { findings };
}
